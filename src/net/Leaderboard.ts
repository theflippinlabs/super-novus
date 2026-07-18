/* Leaderboard — real Supabase reads + signed submission via Edge Function,
   built on the official @supabase/supabase-js client.
   Offline-first local best (localStorage) that must never be lost.
   Every failure is logged explicitly (prefix "[Supabase]") with the exact
   error + an actionable hint — never swallowed silently.
   `available` is false without env config: UI shows an explicit state, guest
   mode stays playable, zero mock data. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_SAVE_KEY, type LeaderboardPeriod } from "../config";
import { WalletManager, shortAddr } from "./WalletManager";

export interface BoardRow { pseudo: string; wallet: string; score: number; dist: number; dust: number; }
export interface LocalBest { v: 1; score: number; dist: number; dust: number; }

const LOG = "[Supabase]";

/** Current period boundaries in UTC — must match the Edge Function exactly.
    Monday 00:00 UTC for weekly, the 1st for monthly. */
export function weekStartUTC(d: Date = new Date()): string {
  const diff = (d.getUTCDay() + 6) % 7; // days since Monday
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff))
    .toISOString().slice(0, 10);
}
export function monthStartUTC(d: Date = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}
export function periodStartUTC(period: LeaderboardPeriod): string {
  return period === "weekly" ? weekStartUTC() : monthStartUTC();
}

export class Leaderboard {
  private wallet: WalletManager;
  private client: SupabaseClient | null = null;
  private memBest: LocalBest = { v: 1, score: 0, dist: 0, dust: 0 };
  /** Last human-readable failure, surfaced to the debug overlay. */
  lastError: string | null = null;
  private diagnosed = false;

  constructor(wallet: WalletManager) {
    this.wallet = wallet;
    this.initClient();
  }

  private get envUrl(): string { return (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? ""; }
  private get envKey(): string { return (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? ""; }

  /** Initialise the Supabase client. Logs whether each env var is present
      (values are never logged). */
  private initClient(): void {
    const hasUrl = Boolean(this.envUrl), hasKey = Boolean(this.envKey);
    if (!hasUrl || !hasKey) {
      this.lastError = "not configured";
      console.info(
        `${LOG} NOT configured — leaderboard offline (guest mode unaffected). ` +
        `VITE_SUPABASE_URL=${hasUrl ? "set" : "MISSING"}, VITE_SUPABASE_ANON_KEY=${hasKey ? "set" : "MISSING"}. ` +
        `Set both in Vercel → Settings → Environment Variables, then redeploy.`,
      );
      return;
    }
    try {
      this.client = createClient(this.envUrl, this.envKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      console.info(`${LOG} client initialised → ${this.envUrl}`);
    } catch (e) {
      this.lastError = "client init failed";
      console.error(`${LOG} client initialisation FAILED (check VITE_SUPABASE_URL format):`, e);
    }
  }

  get available(): boolean { return this.client !== null; }
  /** wallet address acts as identity; kept as `pseudo` for engine compatibility */
  get pseudo(): string | null { return this.wallet.getAddress(); }

  async loadProfile(): Promise<void> { /* identity comes from WalletManager */ }
  async logout(): Promise<void> { await this.wallet.disconnect(); }

  /** Map a PostgREST/Postgres error to an actionable hint. */
  private hint(err: { code?: string; message?: string } | null): string {
    const code = err?.code ?? "";
    const msg = (err?.message ?? "").toLowerCase();
    if (code === "42P01" || msg.includes("does not exist"))
      return "table sn_leaderboard missing → apply migrations (supabase db push / SQL editor 0002).";
    if (code === "42501" || msg.includes("permission") || msg.includes("rls"))
      return "RLS blocking SELECT → ensure the public read policy from 0002 exists.";
    if (msg.includes("jwt") || msg.includes("apikey") || msg.includes("invalid"))
      return "check VITE_SUPABASE_ANON_KEY.";
    if (msg.includes("failed to fetch") || msg.includes("networkerror"))
      return "cannot reach Supabase → verify VITE_SUPABASE_URL / network / CORS.";
    return "see error above.";
  }

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
  /** One-shot connectivity/health check; logs a precise status. Safe on boot. */
  async diagnose(): Promise<void> {
    if (this.diagnosed || !this.client) return;
    this.diagnosed = true;
    const { error } = await this.client
      .from("sn_leaderboard").select("wallet").limit(1);
    if (error) {
      this.lastError = error.message;
      console.error(`${LOG} health FAILED — ${this.hint(error)}\n`, error);
    } else {
      this.lastError = null;
      console.info(`${LOG} health OK — sn_leaderboard reachable, SELECT allowed.`);
    }
  }

  /** Top N of the CURRENT weekly or monthly period. Past periods stay in the
      table (archived) and can be read by passing a historical period_start. */
  async top(period: LeaderboardPeriod, n = 10, periodStart?: string): Promise<BoardRow[]> {
    if (!this.client) return [];
    const start = periodStart ?? periodStartUTC(period);
    const { data, error } = await this.client
      .from("sn_leaderboard")
      .select("wallet,best_score,best_dist,best_dust")
      .eq("period_type", period)
      .eq("period_start", start)
      .order("best_score", { ascending: false })
      .limit(n);
    if (error) {
      this.lastError = error.message;
      console.error(`${LOG} read failed (${period} ${start}) — ${this.hint(error)}\n`, error);
      return [];
    }
    this.lastError = null;
    return (data ?? []).map((x) => ({
      pseudo: shortAddr(x.wallet),
      wallet: x.wallet,
      score: x.best_score,
      dist: x.best_dist,
      dust: x.best_dust,
    }));
  }

  /** Signed submission through the Edge Function. Returns true if stored. */
  async submit(score: number, dist: number, dust: number): Promise<boolean> {
    if (!this.client) { console.warn(`${LOG} submit skipped — leaderboard not configured.`); return false; }
    const address = this.wallet.getAddress();
    if (!address) { console.warn(`${LOG} submit skipped — no wallet connected (guests can't rank).`); return false; }

    const ts = Date.now();
    const message = `SUPER NOVUS score:${score} dist:${dist} dust:${dust} ts:${ts}`;
    let signature: string;
    try {
      signature = await this.wallet.signMessage(message);
    } catch (e) {
      console.error(`${LOG} submit aborted — signature failed/rejected:`, e);
      return false;
    }

    const { data, error } = await this.client.functions.invoke("submit-score", {
      body: { wallet: address, score, dist, dust, ts, signature },
    });
    if (error) {
      this.lastError = error.message;
      // FunctionsHttpError carries the HTTP response; surface its body if present.
      let detail = "";
      try { detail = await (error as any).context?.text?.(); } catch { /* ignore */ }
      const status = (error as any).context?.status;
      const hint = status === 404
        ? "Edge Function 'submit-score' not deployed → supabase functions deploy submit-score --no-verify-jwt"
        : status === 401
        ? "deploy the function with --no-verify-jwt, or check the anon key"
        : "check the function logs (supabase functions logs submit-score)";
      console.error(`${LOG} submit-score failed (status ${status ?? "?"}) — ${hint}\n${detail || error.message}`);
      return false;
    }
    const ok = Boolean((data as { ok?: boolean } | null)?.ok);
    if (!ok) console.warn(`${LOG} submit-score returned not-ok:`, data);
    else this.lastError = null;
    return ok;
  }
}
