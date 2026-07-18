/* PrizePool — live prize-pool math for SUPER NOVUS.
   Weekly : #1 wins the CRO equivalent of $WEEKLY_PRIZE_USD at the live price.
   Monthly: #1 wins the CRO equivalent of $MONTHLY_PRIZE_USD PLUS 30% of all CRO
            collected from Big Bang purchases that month (the Community Bonus).
   Every Big Bang purchase is recorded (on-chain-verified server-side) via the
   record-bigbang Edge Function; monthly revenue is read back through an RPC
   aggregate. The USD amounts are the guaranteed figures — CRO equivalents are
   always approximate ("≈") because they depend on the market price at award time.
   Fails soft: no Supabase / no price still yields a correct USD-only display. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  SUPABASE_URL_DEFAULT, SUPABASE_ANON_KEY_DEFAULT,
  WEEKLY_PRIZE_USD, MONTHLY_PRIZE_USD, MONTHLY_BONUS_PCT,
  CRO_PRICE_URL, CRO_PRICE_TTL_MS, CRO_PRICE_CACHE_KEY,
} from "../config";
import { monthStartUTC } from "./Leaderboard";

const LOG = "[PrizePool]";
const PENDING_KEY = "super-novus:bigbang-pending";
const MAX_ATTEMPTS = 6; // give up recording a purchase after this many transient failures

export interface PoolInfo {
  croUsd: number | null;              // live CRO/USD price, or null if unavailable
  weeklyUsd: number;                  // guaranteed weekly (USD)
  weeklyCRO: number | null;           // ≈ CRO equivalent
  monthlyUsd: number;                 // guaranteed monthly (USD)
  monthlyGuaranteedCRO: number | null;// ≈ CRO equivalent of the guaranteed part
  bonusCRO: number;                   // 30% of this month's Big Bang revenue (CRO)
  monthlyRevenueCRO: number;          // total Big Bang CRO collected this month
}

interface PendingRec { wallet: string; tx_hash: string; amount_cro: number; attempts?: number; }

export class PrizePool {
  private client: SupabaseClient | null = null;
  private price: { usd: number; at: number } | null = null;

  constructor() {
    const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || SUPABASE_URL_DEFAULT;
    const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || SUPABASE_ANON_KEY_DEFAULT;
    if (url && key) this.client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    // Warm the price cache from a previous session so the first paint isn't blank.
    try {
      const raw = localStorage.getItem(CRO_PRICE_CACHE_KEY);
      if (raw) { const p = JSON.parse(raw); if (p && typeof p.usd === "number") this.price = p; }
    } catch { /* private mode */ }
  }

  get available(): boolean { return this.client !== null; }

  /** Live CRO/USD price with a short cache + last-known fallback (null if never known). */
  async croUsd(): Promise<number | null> {
    if (this.price && (Date.now() - this.price.at) < CRO_PRICE_TTL_MS) return this.price.usd;
    try {
      const res = await fetch(CRO_PRICE_URL, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      const usd = j?.["crypto-com-chain"]?.usd;
      if (typeof usd !== "number" || !(usd > 0)) throw new Error("unexpected price payload");
      this.price = { usd, at: Date.now() };
      try { localStorage.setItem(CRO_PRICE_CACHE_KEY, JSON.stringify(this.price)); } catch { /* ignore */ }
      return usd;
    } catch (e) {
      console.warn(`${LOG} CRO/USD price fetch failed — using last known (${this.price?.usd ?? "none"}):`, e);
      return this.price?.usd ?? null; // last known, or null → USD-only display
    }
  }

  /** Total CRO collected from Big Bang purchases in a given month (default: current). */
  async monthlyRevenueCRO(month: string = monthStartUTC()): Promise<number> {
    if (!this.client) return 0;
    const { data, error } = await this.client.rpc("sn_monthly_bigbang_revenue", { p_month: month });
    if (error) { console.warn(`${LOG} monthly revenue read failed:`, error.message); return 0; }
    const n = Number(data);
    return Number.isFinite(n) ? n : 0;
  }

  /** Synchronous guaranteed-only pool (no live fetch) for an instant first paint.
      Uses the cached price if one is known; the Community Bonus fills in once the
      live compute() resolves. Guarantees the display is never a dead-end. */
  staticPool(): PoolInfo {
    const usd = this.price?.usd ?? null;
    return {
      croUsd: usd,
      weeklyUsd: WEEKLY_PRIZE_USD,
      weeklyCRO: usd ? WEEKLY_PRIZE_USD / usd : null,
      monthlyUsd: MONTHLY_PRIZE_USD,
      monthlyGuaranteedCRO: usd ? MONTHLY_PRIZE_USD / usd : null,
      bonusCRO: 0,
      monthlyRevenueCRO: 0,
    };
  }

  /** Compute the full live pool (weekly + monthly with community bonus). */
  async compute(month: string = monthStartUTC()): Promise<PoolInfo> {
    const [usd, revenue] = await Promise.all([this.croUsd(), this.monthlyRevenueCRO(month)]);
    const bonusCRO = Math.round(revenue * MONTHLY_BONUS_PCT * 1e6) / 1e6;
    return {
      croUsd: usd,
      weeklyUsd: WEEKLY_PRIZE_USD,
      weeklyCRO: usd ? WEEKLY_PRIZE_USD / usd : null,
      monthlyUsd: MONTHLY_PRIZE_USD,
      monthlyGuaranteedCRO: usd ? MONTHLY_PRIZE_USD / usd : null,
      bonusCRO,
      monthlyRevenueCRO: revenue,
    };
  }

  /** Record a Big Bang purchase (verified on-chain server-side). Queued in
      localStorage first so a transient failure never loses revenue, then flushed. */
  async recordPurchase(wallet: string, txHash: string, amountCRO: number): Promise<void> {
    this.enqueue({ wallet, tx_hash: txHash, amount_cro: amountCRO });
    await this.flushPending();
  }

  /** Try to submit any queued purchase records. Safe to call on boot. */
  async flushPending(): Promise<void> {
    if (!this.client) return;
    const list = this.readQueue();
    if (!list.length) return;
    const remaining: PendingRec[] = [];
    for (const item of list) {
      const { error } = await this.client.functions.invoke("record-bigbang", {
        body: { wallet: item.wallet, tx_hash: item.tx_hash, amount_cro: item.amount_cro },
      });
      if (!error) {
        console.info(`${LOG} Big Bang purchase recorded: ${item.amount_cro} CRO (${item.tx_hash.slice(0, 12)}…)`);
        continue;
      }
      const status = (error as any).context?.status as number | undefined;
      const attempts = (item.attempts ?? 0) + 1;
      // 4xx = genuine rejection (e.g. amount/recipient mismatch) → terminal, don't retry.
      // 5xx / network / propagation delay → retry, up to MAX_ATTEMPTS.
      if ((status && status >= 400 && status < 500) || attempts >= MAX_ATTEMPTS) {
        console.warn(`${LOG} dropping purchase record (status ${status ?? "?"}, attempt ${attempts}):`, error.message);
        continue;
      }
      console.warn(`${LOG} record-bigbang failed (status ${status ?? "?"}) — will retry:`, error.message);
      remaining.push({ ...item, attempts });
    }
    this.writeQueue(remaining);
  }

  private enqueue(item: PendingRec): void {
    const list = this.readQueue();
    if (list.some((x) => x.tx_hash.toLowerCase() === item.tx_hash.toLowerCase())) return;
    list.push(item);
    this.writeQueue(list);
  }
  private readQueue(): PendingRec[] {
    try { const raw = localStorage.getItem(PENDING_KEY); return raw ? (JSON.parse(raw) as PendingRec[]) : []; }
    catch { return []; }
  }
  private writeQueue(list: PendingRec[]): void {
    try {
      if (list.length) localStorage.setItem(PENDING_KEY, JSON.stringify(list));
      else localStorage.removeItem(PENDING_KEY);
    } catch { /* ignore */ }
  }
}
