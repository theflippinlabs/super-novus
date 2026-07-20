/* Accounting — treasury balance + financial ledger for the admin console.
   Reads the live on-chain CRO balance of the treasury and reconciles it against
   the recorded money-in (Big Bang sales) and money-out (prizes paid), so the
   owner has a clean "bilan" and a CSV export for their accountant.
   All figures come from the real backend + chain; fails soft (null/0) offline. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL_DEFAULT, SUPABASE_ANON_KEY_DEFAULT, TREASURY_ADDRESS, CRONOS_PARAMS } from "../config";
import { monthStartUTC } from "./Leaderboard";
import { PrizePool } from "./PrizePool";

export interface AcctTx {
  date: string;              // ISO
  type: "in" | "out";
  label: string;
  wallet: string;
  amountCRO: number;
  tx: string | null;
}
export interface AccountingSummary {
  balanceCRO: number | null;     // live on-chain treasury balance
  croUsd: number | null;
  revenueTotalCRO: number;       // all-time Big Bang sales
  revenueMonthCRO: number;       // this month's Big Bang sales
  revenueCount: number;
  paidTotalCRO: number;          // all-time prizes paid
  paidCount: number;
  pendingCount: number;
  netCRO: number;                // revenueTotal - paidTotal (theoretical treasury gain)
  txs: AcctTx[];                 // merged, newest first
}

export class Accounting {
  private client: SupabaseClient | null = null;

  constructor(private prizePool: PrizePool) {
    const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || SUPABASE_URL_DEFAULT;
    const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || SUPABASE_ANON_KEY_DEFAULT;
    if (url && key) this.client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  get available(): boolean { return this.client !== null; }

  /** Live CRO balance of the treasury, read straight from the Cronos node. */
  async balanceCRO(): Promise<number | null> {
    try {
      const res = await fetch(CRONOS_PARAMS.rpcUrls[0], {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [TREASURY_ADDRESS, "latest"] }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (j.error || typeof j.result !== "string") throw new Error(j.error?.message ?? "bad result");
      return Number(BigInt(j.result)) / 1e18;
    } catch (e) {
      console.warn("[Accounting] treasury balance read failed:", e);
      return null;
    }
  }

  /** Full financial summary: balance, revenue in, prizes out, net, and a merged
      transaction ledger (newest first) for display + CSV. */
  async summary(): Promise<AccountingSummary> {
    const month = monthStartUTC();
    const [balanceCRO, croUsd, purchases, payouts] = await Promise.all([
      this.balanceCRO(),
      this.prizePool.croUsd().catch(() => null),
      this.fetchPurchases(),
      this.fetchPayouts(),
    ]);

    let revenueTotalCRO = 0, revenueMonthCRO = 0;
    for (const p of purchases) {
      revenueTotalCRO += p.amount_cro;
      if (p.period_month === month) revenueMonthCRO += p.amount_cro;
    }
    const paid = payouts.filter((p) => p.status === "paid");
    const paidTotalCRO = paid.reduce((s, p) => s + (p.amount_cro ?? 0), 0);
    const pendingCount = payouts.filter((p) => p.status === "pending").length;

    const txs: AcctTx[] = [
      ...purchases.map((p): AcctTx => ({
        date: p.created_at, type: "in", label: "Vente Big Bang", wallet: p.wallet, amountCRO: p.amount_cro, tx: p.tx_hash,
      })),
      ...paid.map((p): AcctTx => ({
        date: p.paid_at ?? p.period_start, type: "out",
        label: p.period_type === "weekly" ? "Prix semaine" : "Prix mois",
        wallet: p.wallet, amountCRO: p.amount_cro ?? 0, tx: p.tx_hash,
      })),
    ].sort((a, b) => (a.date < b.date ? 1 : -1));

    return {
      balanceCRO, croUsd,
      revenueTotalCRO, revenueMonthCRO, revenueCount: purchases.length,
      paidTotalCRO, paidCount: paid.length, pendingCount,
      netCRO: revenueTotalCRO - paidTotalCRO,
      txs,
    };
  }

  private async fetchPurchases(): Promise<Array<{ wallet: string; amount_cro: number; tx_hash: string; period_month: string; created_at: string }>> {
    if (!this.client) return [];
    const { data, error } = await this.client
      .from("sn_bigbang_purchases").select("wallet,amount_cro,tx_hash,period_month,created_at")
      .order("created_at", { ascending: false }).limit(2000);
    if (error) { console.error("[Accounting] purchases read failed:", error.message); return []; }
    return (data ?? []).map((r: any) => ({ ...r, amount_cro: Number(r.amount_cro) || 0 }));
  }
  private async fetchPayouts(): Promise<Array<{ period_type: "weekly" | "monthly"; period_start: string; wallet: string; amount_cro: number | null; status: string; tx_hash: string | null; paid_at: string | null }>> {
    if (!this.client) return [];
    const { data, error } = await this.client
      .from("sn_payouts").select("period_type,period_start,wallet,amount_cro,status,tx_hash,paid_at")
      .order("period_start", { ascending: false }).limit(2000);
    if (error) { console.error("[Accounting] payouts read failed:", error.message); return []; }
    return (data ?? []).map((r: any) => ({ ...r, amount_cro: r.amount_cro == null ? null : Number(r.amount_cro) }));
  }

  /** A spreadsheet-ready CSV of the whole ledger (for the accountant). */
  toCSV(txs: AcctTx[]): string {
    const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const head = ["Date", "Type", "Libellé", "Wallet", "Montant_CRO", "Tx"].join(",");
    const lines = txs.map((t) => [
      esc(t.date), t.type === "in" ? "Entrée" : "Sortie", esc(t.label), esc(t.wallet),
      (t.type === "in" ? "" : "-") + t.amountCRO.toFixed(6), esc(t.tx ?? ""),
    ].join(","));
    return [head, ...lines].join("\n");
  }
}
