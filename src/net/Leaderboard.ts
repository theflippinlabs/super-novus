/* Leaderboard — real Supabase reads + signed submission via Edge Function,
   built on the official @supabase/supabase-js client.
   Offline-first local best (localStorage) that must never be lost.
   Every failure is logged explicitly (prefix "[Supabase]") with the exact
   error + an actionable hint — never swallowed silently.
   `available` is false without env config: UI shows an explicit state, guest
   mode stays playable, zero mock data. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { LOCAL_SAVE_KEY, SUPABASE_URL_DEFAULT, SUPABASE_ANON_KEY_DEFAULT, type LeaderboardPeriod } from "../config";
import { WalletManager, shortAddr } from "./WalletManager";
import { DeviceSession, delegationMessage, DELEGATION_TTL_MS, type Delegation } from "./DeviceSession";

export interface BoardRow { pseudo: string; wallet: string; score: number; dist: number; dust: number; bigBangs: number; nickname: string | null; avatar: string | null; }
export interface LocalBest { v: 1; score: number; dist: number; dust: number; }

const LOG = "[Supabase]";

/** Pull a readable message out of an Edge Function JSON error body. */
function extractErr(detail: string): string {
  if (!detail) return "";
  try {
    const j = JSON.parse(detail);
    if (j && j.error) return j.detail ? `${j.error} — ${j.detail}` : String(j.error);
  } catch { /* not JSON */ }
  return detail.slice(0, 140);
}

/** When the server rejects a signature it returns the recovered vs expected
    address — surface a short, non-sensitive hint so a mismatch is obvious. */
function recoveredHint(detail: string): string {
  try {
    const j = JSON.parse(detail);
    if (j && j.recovered && j.expected) return ` (récupéré ${shortAddr(j.recovered)} ≠ attendu ${shortAddr(j.expected)})`;
  } catch { /* not JSON */ }
  return "";
}

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
  private device = new DeviceSession();
  private client: SupabaseClient | null = null;
  private memBest: LocalBest = { v: 1, score: 0, dist: 0, dust: 0 };
  /** Last human-readable failure, surfaced to the debug overlay. */
  lastError: string | null = null;
  /** Precise reason the last submit() failed — shown on the Game Over screen. */
  lastSubmitReason: string | null = null;
  /** Fired right before the ONE-TIME wallet authorization popup, so the UI can show
      "one-time activation" copy instead of "Saving…". Never fired on silent saves. */
  onAuthorizing: (() => void) | null = null;
  private diagnosed = false;

  constructor(wallet: WalletManager) {
    this.wallet = wallet;
    this.initClient();
  }

  /** True when this device already holds a valid, silent-save authorization for the
      connected wallet (no wallet popup needed to save). */
  hasDeviceAuthorization(): boolean {
    const addr = this.wallet.getAddress();
    return Boolean(addr && this.device.getValid(addr));
  }
  /** Drop the device authorization (used when the wallet disconnects / switches). */
  clearDeviceAuthorization(): void { this.device.clearDelegation(); }

  private get envUrl(): string { return (import.meta.env.VITE_SUPABASE_URL as string | undefined) || SUPABASE_URL_DEFAULT; }
  private get envKey(): string { return (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || SUPABASE_ANON_KEY_DEFAULT; }

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

  /** Read-check sn_leaderboard (tests the table exists + the RLS SELECT policy). */
  async tableCheck(): Promise<{ ok: boolean; code?: string; message?: string; hint?: string }> {
    if (!this.client) return { ok: false, message: "client non configuré" };
    const { error } = await this.client.from("sn_leaderboard").select("wallet").limit(1);
    if (error) return { ok: false, code: (error as any).code, message: error.message, hint: this.hint(error) };
    return { ok: true };
  }

  /** Which URL/key the client is actually using (env override vs baked default). */
  configInfo(): { url: string; keyMasked: string; usingEnvUrl: boolean; usingEnvKey: boolean } {
    const usingEnvUrl = Boolean(import.meta.env.VITE_SUPABASE_URL);
    const usingEnvKey = Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY);
    const key = this.envKey;
    return { url: this.envUrl, keyMasked: key ? key.slice(0, 16) + "…" : "(aucune)", usingEnvUrl, usingEnvKey };
  }

  /** Top N of the CURRENT weekly or monthly period. Past periods stay in the
      table (archived) and can be read by passing a historical period_start. */
  async top(period: LeaderboardPeriod, n = 10, periodStart?: string): Promise<BoardRow[]> {
    if (!this.client) return [];
    const start = periodStart ?? periodStartUTC(period);
    const { data, error } = await this.client
      .from("sn_leaderboard")
      .select("wallet,best_score,best_dist,best_dust,big_bangs")
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
    // Nickname/avatar per row come from the (future) profiles table — null for
    // now, so the board renders a generated avatar + short address. Frontend-only.
    return (data ?? []).map((x) => ({
      pseudo: shortAddr(x.wallet),
      wallet: x.wallet,
      score: x.best_score,
      dist: x.best_dist,
      dust: x.best_dust,
      bigBangs: x.big_bangs ?? 0,
      nickname: null as string | null,
      avatar: null as string | null,
    }));
  }

  /** Signed submission through the Edge Function. Returns true if stored.
      `bigBangs` is unsigned transparency metadata (not part of the message). */
  async submit(score: number, dist: number, dust: number, bigBangs = 0): Promise<boolean> {
    this.lastSubmitReason = null;
    if (!this.client) {
      this.lastSubmitReason = "Supabase non configuré (URL/clé absente)";
      console.warn(`${LOG} submit skipped — leaderboard not configured.`);
      return false;
    }
    const address = this.wallet.getAddress();
    if (!address) {
      this.lastSubmitReason = "Aucun wallet connecté";
      console.warn(`${LOG} submit skipped — no wallet connected (guests can't rank).`);
      return false;
    }

    // Obtain (once) a device authorization: the wallet signs a single message
    // binding this device key to the wallet. Every subsequent score is signed
    // LOCALLY by the device key — no wallet popup, no app-switch, no hang.
    let deleg: Delegation | null = this.device.getValid(address);
    if (!deleg) {
      const exp = Date.now() + DELEGATION_TTL_MS;
      const authMsg = delegationMessage(address, this.device.deviceAddress(), exp);
      try {
        try { this.onAuthorizing?.(); } catch { /* UI hook must never break the flow */ }
        const sig = await this.wallet.signMessage(authMsg);
        deleg = { wallet: address.toLowerCase(), device: this.device.deviceAddress().toLowerCase(), exp, sig };
        this.device.save(deleg);
        console.info(`${LOG} device authorized for ${shortAddr(address)} — future saves are silent.`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const code = (e as { code?: number })?.code;
        const timedOut = /sign-timeout/.test(msg);
        const rejected = code === 4001 || /reject|denied|refus|cancel|annul/i.test(msg);
        this.lastSubmitReason = timedOut
          ? "Le wallet n'a pas répondu — rouvre-le, signe l'activation une seule fois, puis réessaie."
          : rejected
          ? "Activation refusée dans le wallet"
          : `Activation impossible (wallet) : ${msg}`;
        this.lastError = this.lastSubmitReason;
        console.error(`${LOG} submit aborted — device authorization failed/rejected:`, e);
        return false;
      }
    }

    // Sign the score with the DEVICE key — local, instant, never opens the wallet.
    const ts = Date.now();
    const message = `SUPER NOVUS score:${score} dist:${dist} dust:${dust} ts:${ts}`;
    let signature: string;
    try {
      signature = await this.device.signScore(message);
    } catch (e) {
      this.lastSubmitReason = `Signature locale impossible : ${e instanceof Error ? e.message : String(e)}`;
      this.lastError = this.lastSubmitReason;
      console.error(`${LOG} submit aborted — device signature failed:`, e);
      return false;
    }

    // Guard the network call so a hung request can't leave the UI stuck on "Saving…".
    const invoke = this.client.functions.invoke("submit-score", {
      body: {
        wallet: address, score, dist, dust, ts, signature, bigbangs: bigBangs,
        delegation: { device: deleg.device, exp: deleg.exp, sig: deleg.sig },
      },
    });
    let data: any, error: any;
    try {
      ({ data, error } = await Promise.race([
        invoke as Promise<{ data: any; error: any }>,
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("invoke-timeout")), 30_000)),
      ]));
    } catch (e) {
      this.lastSubmitReason = /invoke-timeout/.test(String(e))
        ? "Serveur de scores injoignable (délai dépassé) — réessaie."
        : `Réseau injoignable : ${e instanceof Error ? e.message : String(e)}`;
      this.lastError = this.lastSubmitReason;
      return false;
    }
    if (error) {
      this.lastError = error.message;
      let detail = "";
      try { detail = await (error as any).context?.text?.(); } catch { /* ignore */ }
      const status = (error as any).context?.status as number | undefined;
      // A 401 has TWO possible causes: the gateway rejecting a non-JWT key, OR our
      // function rejecting a bad signature (it returns {error:"signature invalid"}).
      // Distinguish them by reading the body so we never mislabel one as the other.
      const sigInvalid = /signature\s*invalid/i.test(detail || "");
      // A rejected signature most likely means a stale/expired device authorization
      // (or the wallet changed). Drop it so the next save re-authorizes with one tap.
      if (sigInvalid) this.device.clearDelegation();
      // Surface the EXACT cause (do not hide it) — this reaches the Game Over screen.
      this.lastSubmitReason =
        status === 404 ? "Serveur de scores non déployé (submit-score 404)"
        : sigInvalid ? `Autorisation expirée${recoveredHint(detail)} — réessaie pour la réactiver en un tap.`
        : status === 401 ? "Fonction protégée par JWT — redéploie avec --no-verify-jwt (401)"
        : status === 403 ? "Accès refusé (403) — vérifie la clé Supabase / le déploiement"
        : status === 429 ? "Trop de soumissions — patiente ~30 s (429)"
        : status === 400 ? `Données refusées (400) : ${extractErr(detail) || "bad request"}`
        : status === 500 ? `Erreur serveur (500) : ${extractErr(detail) || "voir les logs"}`
        : status ? `Échec (${status}) : ${extractErr(detail) || error.message}`
        : `Réseau injoignable : ${error.message}`;
      console.error(`${LOG} submit-score failed (status ${status ?? "?"}) — ${this.lastSubmitReason}\n${detail || error.message}`);
      return false;
    }
    const ok = Boolean((data as { ok?: boolean } | null)?.ok);
    if (!ok) {
      this.lastSubmitReason = "Réponse serveur invalide (ok=false)";
      console.warn(`${LOG} submit-score returned not-ok:`, data);
    } else { this.lastError = null; this.lastSubmitReason = null; }
    return ok;
  }

  /** Probe the submit-score Edge Function WITHOUT signing — classifies whether it
      is reachable/deployed. 400 = deployed & validating (good); 404 = not deployed;
      401 = JWT-protected (redeploy --no-verify-jwt). Used by the ?diag panel. */
  async probeFunction(): Promise<{ ok: boolean; status: number | null; reason: string }> {
    if (!this.client) return { ok: false, status: null, reason: "client non configuré" };
    const { error } = await this.client.functions.invoke("submit-score", { body: { probe: true } });
    if (!error) return { ok: true, status: 200, reason: "atteignable (200)" };
    const status = (error as any).context?.status ?? null;
    let detail = ""; try { detail = await (error as any).context?.text?.(); } catch { /* ignore */ }
    if (status === 400) return { ok: true, status, reason: "déployée & valide (400 validation) ✓" };
    if (status === 404) return { ok: false, status, reason: "NON DÉPLOYÉE (404)" };
    if (status === 401) return { ok: false, status, reason: "protégée JWT — redéploie --no-verify-jwt (401)" };
    if (status === 403) return { ok: false, status, reason: "403 — clé/déploiement à vérifier" };
    return { ok: false, status, reason: `status ${status ?? "?"} : ${extractErr(detail) || error.message}` };
  }

  /** The connected wallet's BEST server-side entry across the current weekly +
      monthly periods — the leaderboard is the single source of truth for the
      player's best score/dist/dust, so the profile and board can never disagree.
      Returns null when offline / not connected / no entry yet. */
  async myBest(): Promise<{ score: number; dist: number; dust: number } | null> {
    const addr = this.wallet.getAddress();
    if (!this.client || !addr) return null;
    const { data, error } = await this.client
      .from("sn_leaderboard")
      .select("best_score,best_dist,best_dust")
      .eq("wallet", addr)
      .order("best_score", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) { console.error(`${LOG} myBest query failed:`, error); return null; }
    if (!data) return null;
    return { score: data.best_score ?? 0, dist: data.best_dist ?? 0, dust: data.best_dust ?? 0 };
  }

  /** Connected wallet's rank in a period (1-based), or null if unavailable
      (not connected / not on the board / offline). */
  async myRank(period: LeaderboardPeriod): Promise<number | null> {
    const addr = this.wallet.getAddress();
    if (!this.client || !addr) return null;
    const start = periodStartUTC(period);
    const mineRes = await this.client
      .from("sn_leaderboard").select("best_score")
      .eq("wallet", addr).eq("period_type", period).eq("period_start", start)
      .maybeSingle();
    if (mineRes.error || !mineRes.data) return null;
    const myScore = mineRes.data.best_score;
    const cntRes = await this.client
      .from("sn_leaderboard").select("*", { count: "exact", head: true })
      .eq("period_type", period).eq("period_start", start).gt("best_score", myScore);
    if (cntRes.error) { console.error(`${LOG} rank query failed (${period}):`, cntRes.error); return null; }
    return (cntRes.count ?? 0) + 1;
  }

  /* ---------- offline pending submission ---------- */
  private static PENDING_KEY = "super-novus:pending";

  /** Store a score to submit later (played offline / no wallet). */
  savePending(score: number, dist: number, dust: number, bigBangs = 0): void {
    try {
      localStorage.setItem(Leaderboard.PENDING_KEY, JSON.stringify({ score, dist, dust, bigBangs }));
      console.info(`${LOG} score stored locally — will sync when a wallet connects.`);
    } catch { /* private mode */ }
  }
  hasPending(): boolean {
    try { return localStorage.getItem(Leaderboard.PENDING_KEY) !== null; } catch { return false; }
  }
  /** Submit any stored pending score once a wallet is connected. */
  async syncPending(): Promise<boolean> {
    if (!this.client || !this.wallet.getAddress()) return false;
    let p: { score: number; dist: number; dust: number; bigBangs?: number } | null = null;
    try {
      const raw = localStorage.getItem(Leaderboard.PENDING_KEY);
      if (raw) p = JSON.parse(raw);
    } catch { /* ignore */ }
    if (!p) return false;
    console.info(`${LOG} syncing pending score…`, p);
    const ok = await this.submit(p.score, p.dist, p.dust, p.bigBangs ?? 0);
    if (ok) { try { localStorage.removeItem(Leaderboard.PENDING_KEY); } catch { /* ignore */ } }
    return ok;
  }
}
