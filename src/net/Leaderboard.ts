/* Leaderboard — real Supabase reads + signed submission via Edge Function.
   Offline-first local best (localStorage) that must never be lost.
   `available` is false without env config: UI hides boards, zero mock data. */
import { LOCAL_SAVE_KEY } from "../config";
import { WalletManager, shortAddr } from "./WalletManager";

export interface BoardRow { pseudo: string; wallet: string; score: number; dist: number; dust: number; }
export interface LocalBest { v: 1; score: number; dist: number; dust: number; }

export class Leaderboard {
  private wallet: WalletManager;
  private memBest: LocalBest = { v: 1, score: 0, dist: 0, dust: 0 }; // fallback if localStorage denied

  constructor(wallet: WalletManager) {
    this.wallet = wallet;
  }

  get url(): string { return (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ""; }
  get anonKey(): string { return (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? ""; }
  get available(): boolean { return Boolean(this.url && this.anonKey); }

  /** wallet address acts as identity; kept as `pseudo` for engine compatibility */
  get pseudo(): string | null { return this.wallet.getAddress(); }

  async loadProfile(): Promise<void> { /* identity comes from WalletManager */ }
  async logout(): Promise<void> { await this.wallet.disconnect(); }

  /* ---------- local best (never lost) ---------- */
  getLocalBest(): LocalBest {
    try {
      const raw = localStorage.getItem(LOCAL_SAVE_KEY);
      if (raw) {
        const p = JSON.parse(raw) as LocalBest;
        if (p && p.v === 1) return p;
      }
    } catch { /* Safari private mode */ }
    return this.memBest;
  }
  saveLocalBest(score: number, dist: number, dust: number): LocalBest {
    const cur = this.getLocalBest();
    const next: LocalBest = {
      v: 1,
      score: Math.max(cur.score, score),
      dist: Math.max(cur.dist, dist),
      dust: Math.max(cur.dust, dust),
    };
    this.memBest = next;
    try { localStorage.setItem(LOCAL_SAVE_KEY, JSON.stringify(next)); } catch { /* keep memory */ }
    return next;
  }

  /* ---------- server ---------- */
  async top(n = 10): Promise<BoardRow[]> {
    if (!this.available) return [];
    try {
      const r = await fetch(
        `${this.url}/rest/v1/sn_scores?select=wallet,best_score,best_dist,best_dust&order=best_score.desc&limit=${n}`,
        { headers: { apikey: this.anonKey, Authorization: `Bearer ${this.anonKey}` } },
      );
      if (!r.ok) return [];
      const rows = (await r.json()) as Array<{ wallet: string; best_score: number; best_dist: number; best_dust: number }>;
      return rows.map((x) => ({
        pseudo: shortAddr(x.wallet),
        wallet: x.wallet,
        score: x.best_score,
        dist: x.best_dist,
        dust: x.best_dust,
      }));
    } catch { return []; }
  }

  /** Signed submission through the Edge Function. Returns true if a new record was stored. */
  async submit(score: number, dist: number, dust: number): Promise<boolean> {
    const address = this.wallet.getAddress();
    if (!this.available || !address) return false;
    try {
      const ts = Date.now();
      const message = `SUPER NOVUS score:${score} dist:${dist} dust:${dust} ts:${ts}`;
      const signature = await this.wallet.signMessage(message);
      const r = await fetch(`${this.url}/functions/v1/submit-score`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: this.anonKey,
          Authorization: `Bearer ${this.anonKey}`,
        },
        body: JSON.stringify({ wallet: address, score, dist, dust, ts, signature }),
      });
      if (!r.ok) return false;
      const j = (await r.json()) as { ok?: boolean; saved?: boolean };
      return Boolean(j.ok);
    } catch { return false; }
  }
}
