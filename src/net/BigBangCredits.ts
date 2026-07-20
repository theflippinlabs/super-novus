/* BigBangCredits — the player's Big Bang balance ("fuel for future missions").
   Packs are bought in advance with ONE on-chain CRO payment; the granted Big
   Bangs become credits. Dying then consumes a credit INSTANTLY — no wallet, no
   signature — as long as the per-run limit (3) allows it.

   Storage is per-wallet in localStorage (client-authoritative for the instant,
   frictionless revive). The pack PAYMENT is on-chain, so every purchase has a
   durable, recoverable receipt (tx hash kept in history) even though the balance
   itself currently lives on the device. The API is async and abstracted so a
   Supabase-backed balance can replace the store later without touching the UI. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { BB_CREDITS_PREFIX, SUPABASE_URL_DEFAULT, SUPABASE_ANON_KEY_DEFAULT, type BigBangPack } from "../config";
import { WalletManager } from "./WalletManager";

export interface BBPurchase {
  packId: BigBangPack["id"] | "gift";
  emoji: string;
  credits: number;
  cro: number;
  txHash: string;
  ts: number;        // epoch ms
}
interface Stored { purchased: number; consumed: number; history: BBPurchase[]; appliedGrants: number[]; }

const EMPTY: Stored = { purchased: 0, consumed: 0, history: [], appliedGrants: [] };

export class BigBangCredits {
  private client: SupabaseClient | null = null;

  constructor(private wallet: WalletManager) {
    const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || SUPABASE_URL_DEFAULT;
    const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || SUPABASE_ANON_KEY_DEFAULT;
    if (url && key) this.client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  /** Pull any free Big Bangs the owner gifted to the connected wallet and add the
      not-yet-applied ones to the local balance. Returns how many credits were
      newly added (0 if none / offline). Safe to call on every connect. */
  async syncGrants(now: number): Promise<number> {
    const addr = this.wallet.getAddress();
    if (!this.client || !addr) return 0;
    const { data, error } = await this.client
      .from("sn_bigbang_grants").select("id,credits,note,created_at")
      .eq("wallet", addr.toLowerCase()).order("id", { ascending: true });
    if (error) { console.warn("[BigBangCredits] grant sync failed:", error.message); return 0; }
    const s = this.read(addr);
    const applied = new Set(s.appliedGrants);
    let added = 0;
    for (const g of data ?? []) {
      const id = Number(g.id);
      if (applied.has(id)) continue;
      const credits = Math.max(0, Math.floor(Number(g.credits)) || 0);
      if (credits <= 0) { applied.add(id); continue; }
      s.purchased += credits;
      s.appliedGrants.push(id);
      applied.add(id);
      const ts = g.created_at ? Date.parse(g.created_at) || now : now;
      s.history.push({ packId: "gift", emoji: "🎁", credits, cro: 0, txHash: `grant#${id}`, ts });
      added += credits;
    }
    if (added > 0) this.write(addr, s);
    return added;
  }

  /** Big Bangs available to spend right now (never negative). */
  available(wallet?: string): number {
    const s = this.read(wallet);
    return Math.max(0, s.purchased - s.consumed);
  }

  /** Purchases, most recent first. */
  history(wallet?: string): BBPurchase[] {
    return [...this.read(wallet).history].sort((a, b) => b.ts - a.ts);
  }

  /** Credit a purchased pack after its CRO payment confirmed. `now` is passed in
      because Date.now() is unavailable in some sandboxed contexts; the caller
      stamps the time. */
  addPack(pack: BigBangPack, txHash: string, now: number): void {
    const addr = this.wallet.getAddress();
    if (!addr) return;
    const s = this.read(addr);
    s.purchased += pack.credits;
    s.history.push({ packId: pack.id, emoji: pack.emoji, credits: pack.credits, cro: pack.priceCRO, txHash, ts: now });
    this.write(addr, s);
  }

  /** Spend one credit (instant revive). Returns false if none available. */
  consume(): boolean {
    const addr = this.wallet.getAddress();
    if (!addr) return false;
    const s = this.read(addr);
    if (s.purchased - s.consumed <= 0) return false;
    s.consumed += 1;
    this.write(addr, s);
    return true;
  }

  /* ---------- storage ---------- */
  private key(wallet?: string): string | null {
    const addr = wallet ?? this.wallet.getAddress();
    return addr ? BB_CREDITS_PREFIX + addr.toLowerCase() : null;
  }
  private read(wallet?: string): Stored {
    const k = this.key(wallet);
    if (!k) return { ...EMPTY };
    try {
      const raw = localStorage.getItem(k);
      if (raw) {
        const p = JSON.parse(raw);
        return {
          purchased: Number(p.purchased) || 0,
          consumed: Number(p.consumed) || 0,
          history: Array.isArray(p.history) ? p.history : [],
          appliedGrants: Array.isArray(p.appliedGrants) ? p.appliedGrants.map((n: any) => Number(n)).filter((n: number) => Number.isFinite(n)) : [],
        };
      }
    } catch { /* private mode / bad json */ }
    return { ...EMPTY };
  }
  private write(wallet: string, s: Stored): void {
    const k = this.key(wallet);
    if (!k) return;
    try { localStorage.setItem(k, JSON.stringify(s)); } catch { /* ignore */ }
  }
}
