/* Profile — LOCAL-ONLY player identity + lifetime stats (frontend scope).
   Deliberately NOT wired to Supabase yet: nickname, avatar and lifetime stats
   live in localStorage so the UI can be finalized first. The public method shapes
   mirror what a future Supabase-backed version will expose, so swapping the
   storage layer later won't touch the UI. History and rewards are out of scope
   for now. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL_DEFAULT, SUPABASE_ANON_KEY_DEFAULT } from "../config";
import { WalletManager } from "./WalletManager";

const PROFILE_PREFIX = "super-novus:profile:";
const STATS_PREFIX = "super-novus:stats:";

export interface ProfileRow { wallet: string; nickname: string | null; avatar_url: string | null; created_at: string | null; }
export interface ProfileStats {
  high_score: number; total_dist: number; total_dust: number;
  games: number; deaths: number; big_bangs: number;
  weekly_wins: number; monthly_wins: number;
  best_weekly_rank: number | null; best_monthly_rank: number | null;
}
export interface SaveResult { ok: boolean; error?: "no-wallet" | string; }

interface StoredProfile { nickname: string | null; avatar: string | null; created_at: string | null; }
interface StoredStats { high_score: number; total_dist: number; total_dust: number; games: number; deaths: number; big_bangs: number; }

const EMPTY_STATS: StoredStats = { high_score: 0, total_dist: 0, total_dust: 0, games: 0, deaths: 0, big_bangs: 0 };

export class Profile {
  private client: SupabaseClient | null = null;

  constructor(private wallet: WalletManager) {
    const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || SUPABASE_URL_DEFAULT;
    const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || SUPABASE_ANON_KEY_DEFAULT;
    if (url && key) this.client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  /** Local storage is always available (guest-safe). */
  get available(): boolean { return true; }

  /** Pull this wallet's SHARED profile (nickname/avatar) from the server into the
      local cache, so a pseudo set on another device shows up here too. Non-blocking. */
  async syncSelf(): Promise<void> {
    const addr = this.wallet.getAddress();
    if (!this.client || !addr) return;
    try {
      const { data } = await this.client.from("sn_profiles").select("nickname,avatar_url").eq("wallet", addr.toLowerCase()).maybeSingle();
      if (!data) return;
      const p = this.readProfile(addr);
      if (data.nickname != null) p.nickname = data.nickname;
      if (data.avatar_url != null) p.avatar = data.avatar_url;
      this.writeProfile(addr, p);
    } catch { /* offline — keep local */ }
  }

  /* ---------- identity (local) ---------- */
  cachedIdentity(wallet: string): { nickname: string | null; avatar: string | null } {
    const p = this.readProfile(wallet);
    return { nickname: p.nickname, avatar: p.avatar };
  }

  /** Async only to mirror the future Supabase API; reads localStorage. */
  async get(wallet?: string): Promise<ProfileRow | null> {
    const addr = wallet ?? this.wallet.getAddress();
    if (!addr) return null;
    const p = this.readProfile(addr);
    return { wallet: addr, nickname: p.nickname, avatar_url: p.avatar, created_at: p.created_at };
  }

  async stats(wallet?: string): Promise<ProfileStats | null> {
    const addr = wallet ?? this.wallet.getAddress();
    if (!addr) return null;
    const s = this.readStats(addr);
    return {
      high_score: s.high_score, total_dist: s.total_dist, total_dust: s.total_dust,
      games: s.games, deaths: s.deaths, big_bangs: s.big_bangs,
      // Wins and best ranks require the backend (added later) — unknown locally.
      weekly_wins: 0, monthly_wins: 0, best_weekly_rank: null, best_monthly_rank: null,
    };
  }

  /** Save nickname and/or avatar. Pushes to the SHARED server profile (so it
      shows the same everywhere) AND caches locally for instant reads. The server
      enforces nickname uniqueness; a clash returns { ok:false, error:"nick-taken" }
      and nothing is changed. Offline, it still saves locally. */
  async save(opts: { nickname?: string; avatarUrl?: string | null }): Promise<SaveResult> {
    const addr = this.wallet.getAddress();
    if (!addr) return { ok: false, error: "no-wallet" };

    if (this.client) {
      const body: Record<string, unknown> = { wallet: addr };
      if (opts.nickname !== undefined) body.nickname = opts.nickname;
      if (opts.avatarUrl !== undefined) body.avatar_url = opts.avatarUrl;
      try {
        const { error } = await this.client.functions.invoke("set-profile", { body });
        if (error) {
          let detail = ""; try { detail = await (error as any).context?.text?.(); } catch { /* ignore */ }
          const status = (error as any).context?.status as number | undefined;
          if (status === 409 || /nick-taken/.test(detail)) return { ok: false, error: "nick-taken" };
          if (status === 400 && /nickname/.test(detail)) return { ok: false, error: "bad-nickname" };
          // Other server error → fall through to a local save (offline-friendly).
          console.warn(`[Profile] server save failed (${status ?? "?"}), saving locally: ${detail || error.message}`);
        }
      } catch (e) { console.warn("[Profile] server save network error — local only:", e); }
    }

    const p = this.readProfile(addr);
    if (opts.nickname !== undefined) p.nickname = opts.nickname;
    if (opts.avatarUrl !== undefined) p.avatar = opts.avatarUrl;
    if (!p.created_at) p.created_at = new Date().toISOString();
    this.writeProfile(addr, p);
    return { ok: true };
  }

  /** Accumulate one finished run into the local lifetime stats. */
  recordRun(score: number, dist: number, dust: number, bigBangs: number): void {
    const addr = this.wallet.getAddress();
    if (!addr) return; // stats are per-identity; guests don't accumulate
    const s = this.readStats(addr);
    s.high_score = Math.max(s.high_score, Math.floor(score));
    s.total_dist += Math.floor(dist);
    s.total_dust += Math.floor(dust);
    s.games += 1;
    s.deaths += 1;
    s.big_bangs += Math.max(0, Math.floor(bigBangs));
    this.writeStats(addr, s);
    // Anchor "member since" on the first recorded run if not already set.
    const p = this.readProfile(addr);
    if (!p.created_at) { p.created_at = new Date().toISOString(); this.writeProfile(addr, p); }
  }

  /** Lift the cached best score to at least the leaderboard's (source of truth),
      so the local profile can never display below the server after a cross-device
      or cross-session play. Totals (dist/dust) stay lifetime-accumulated. */
  recordBest(score: number, _dist: number, _dust: number): void {
    const addr = this.wallet.getAddress();
    if (!addr) return;
    const s = this.readStats(addr);
    if (Math.floor(score) > s.high_score) { s.high_score = Math.floor(score); this.writeStats(addr, s); }
  }

  /* ---------- storage ---------- */
  private readProfile(wallet: string): StoredProfile {
    try {
      const raw = localStorage.getItem(PROFILE_PREFIX + wallet.toLowerCase());
      if (raw) { const p = JSON.parse(raw); return { nickname: p.nickname ?? null, avatar: p.avatar ?? null, created_at: p.created_at ?? null }; }
    } catch { /* private mode */ }
    return { nickname: null, avatar: null, created_at: null };
  }
  private writeProfile(wallet: string, p: StoredProfile): void {
    try { localStorage.setItem(PROFILE_PREFIX + wallet.toLowerCase(), JSON.stringify(p)); } catch { /* ignore */ }
  }
  private readStats(wallet: string): StoredStats {
    try {
      const raw = localStorage.getItem(STATS_PREFIX + wallet.toLowerCase());
      if (raw) return { ...EMPTY_STATS, ...JSON.parse(raw) };
    } catch { /* private mode */ }
    return { ...EMPTY_STATS };
  }
  private writeStats(wallet: string, s: StoredStats): void {
    try { localStorage.setItem(STATS_PREFIX + wallet.toLowerCase(), JSON.stringify(s)); } catch { /* ignore */ }
  }
}
