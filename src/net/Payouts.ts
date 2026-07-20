/* Payouts — prize distribution client (owner-approved model).
   The winner is selected automatically server-side (sn_payouts ledger). Here
   the treasury owner lists pending payouts and sends each prize FROM THEIR OWN
   wallet; the tx is then recorded via the record-payout Edge Function.
   No private key is ever held by the app. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  SUPABASE_URL_DEFAULT, SUPABASE_ANON_KEY_DEFAULT,
  TREASURY_ADDRESS, WEEKLY_PRIZE_CRO, MONTHLY_PRIZE_CRO,
  WEEKLY_PRIZE_USD, MONTHLY_PRIZE_USD, MONTHLY_BONUS_PCT,
} from "../config";
import { WalletManager } from "./WalletManager";
import { PrizePool } from "./PrizePool";

export interface Payout {
  id: number;
  period_type: "weekly" | "monthly";
  period_start: string;
  wallet: string;
  best_score: number;
  status: string;
  tx_hash: string | null;
  amount_cro: number | null;
}

export class Payouts {
  private client: SupabaseClient | null = null;

  constructor(private wallet: WalletManager, private prizePool: PrizePool) {
    const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || SUPABASE_URL_DEFAULT;
    const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || SUPABASE_ANON_KEY_DEFAULT;
    if (url && key) this.client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  get available(): boolean { return this.client !== null; }

  isTreasury(): boolean {
    const a = this.wallet.getAddress();
    return !!a && a.toLowerCase() === TREASURY_ADDRESS.toLowerCase();
  }

  /** Manual override amount (0 = auto-compute from the live price). */
  defaultPrizeCRO(period: "weekly" | "monthly"): number {
    return period === "weekly" ? WEEKLY_PRIZE_CRO : MONTHLY_PRIZE_CRO;
  }

  /** Suggested CRO to pay the winner, from the live price + monthly Big Bang
      revenue: weekly = $25 in CRO; monthly = $50 in CRO + 30% of that month's
      Big Bang revenue. Returns 0 if the price is unavailable (owner enters it).
      A manual WEEKLY_/MONTHLY_PRIZE_CRO override, if set, always wins. */
  async suggestedPrizeCRO(period: "weekly" | "monthly", periodStart: string): Promise<number> {
    const override = this.defaultPrizeCRO(period);
    if (override > 0) return override;
    const usd = await this.prizePool.croUsd();
    if (period === "weekly") return usd ? Math.round(WEEKLY_PRIZE_USD / usd) : 0;
    const revenue = await this.prizePool.monthlyRevenueCRO(periodStart);
    const guaranteed = usd ? MONTHLY_PRIZE_USD / usd : 0;
    return Math.round(guaranteed + revenue * MONTHLY_BONUS_PCT);
  }

  async listPending(): Promise<Payout[]> {
    if (!this.client) return [];
    const { data, error } = await this.client
      .from("sn_payouts").select("*").eq("status", "pending")
      .order("period_start", { ascending: false });
    if (error) { console.error("[Payouts] read failed:", error.message, error); return []; }
    return (data ?? []) as Payout[];
  }

  /** Gift free Big Bang credits to a wallet (promo / ops). Owner-only, guarded by
      the admin secret (the endpoint is public). Returns the new grant id. */
  async grantBigBang(wallet: string, credits: number, note: string, secret: string): Promise<number> {
    if (!this.client) throw new Error("Supabase non configuré");
    const { data, error } = await this.client.functions.invoke("grant-bigbang", {
      body: { wallet, credits, note, secret },
    });
    if (error) {
      let detail = ""; try { detail = await (error as any).context?.text?.(); } catch { /* ignore */ }
      const status = (error as any).context?.status as number | undefined;
      const msg = status === 401 ? "Code admin incorrect"
        : status === 503 ? "ADMIN_SECRET non configuré côté serveur"
        : status === 400 ? `Données invalides : ${detail || "wallet/crédits"}`
        : `Échec (${status ?? "?"}) : ${detail || error.message}`;
      throw new Error(msg);
    }
    if (!(data as any)?.ok) throw new Error("Réponse serveur invalide");
    return Number((data as any).id);
  }

  /** Most recent payouts of ANY status (for the "recent winners" admin section). */
  async listRecent(limit = 8): Promise<Payout[]> {
    if (!this.client) return [];
    const { data, error } = await this.client
      .from("sn_payouts").select("*")
      .order("period_start", { ascending: false }).limit(limit);
    if (error) { console.error("[Payouts] recent read failed:", error.message, error); return []; }
    return (data ?? []) as Payout[];
  }

  /** Send the prize from the connected treasury wallet, then record the tx. */
  async pay(p: Payout, amountCRO: number): Promise<string> {
    if (!this.isTreasury()) throw new Error("Connecte le wallet trésorerie");
    const tx = await this.wallet.payCRO(p.wallet, amountCRO);
    await this.record(p, tx);
    return tx;
  }

  private async record(p: Payout, tx: string): Promise<void> {
    if (!this.client) return;
    // No signature: the record-payout function verifies the payment ON-CHAIN
    // (treasury -> winner) and reads the amount from the transaction itself, so
    // recording is reliable (never blocked by a wallet sign prompt that never
    // surfaces on mobile) and the amount is authoritative for the accounting.
    const { error } = await this.client.functions.invoke("record-payout", {
      body: { period_type: p.period_type, period_start: p.period_start, tx_hash: tx },
    });
    if (error) console.error("[Payouts] record failed (tx sent, status not updated):", error.message, error);
  }
}
