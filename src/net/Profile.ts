/* Profile — player identity + lifetime stats client.
   Identity is the wallet, but the player is ALWAYS shown as Avatar + Nickname,
   never a raw address. Nicknames/avatars are stored in Supabase (signed writes
   via the save-profile Edge Function); lifetime stats come from an RPC over the
   run history. A tiny localStorage cache gives an instant identity on boot.
   Fails soft: with no Supabase, the generated avatar + local nickname still work. */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL_DEFAULT, SUPABASE_ANON_KEY_DEFAULT, PROFILE_HISTORY_LIMIT } from "../config";
import { WalletManager } from "./WalletManager";

const LOG = "[Profile]";
const CACHE_PREFIX = "super-novus:profile:";

export interface ProfileRow { wallet: string; nickname: string | null; avatar_url: string | null; created_at: string | null; }
export interface ProfileStats {
  high_score: number; total_dist: number; total_dust: number;
  games: number; deaths: number; big_bangs: number;
  weekly_wins: number; monthly_wins: number;
  best_weekly_rank: number | null; best_monthly_rank: number | null;
}
export interface RunRow { created_at: string; score: number; dist: number; weekly_rank: number | null; monthly_rank: number | null; big_bangs: number; }
export interface RewardRow { period_type: "weekly" | "monthly"; period_start: string; rank: number; status: string; tx_hash: string | null; }

export interface SaveResult { ok: boolean; error?: "not-configured" | "no-wallet" | "signature" | "nick-taken" | string; }

export class Profile {
  private client: SupabaseClient | null = null;

  constructor(private wallet: WalletManager) {
    const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || SUPABASE_URL_DEFAULT;
    const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || SUPABASE_ANON_KEY_DEFAULT;
    if (url && key) this.client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }

  get available(): boolean { return this.client !== null; }

  /* ---------- instant local identity cache ---------- */
  cachedIdentity(wallet: string): { nickname: string | null; avatar: string | null } {
    try {
      const raw = localStorage.getItem(CACHE_PREFIX + wallet.toLowerCase());
      if (raw) { const p = JSON.parse(raw); return { nickname: p.nickname ?? null, avatar: p.avatar ?? null }; }
    } catch { /* private mode */ }
    return { nickname: null, avatar: null };
  }
  private cacheIdentity(wallet: string, nickname: string | null, avatar: string | null): void {
    try { localStorage.setItem(CACHE_PREFIX + wallet.toLowerCase(), JSON.stringify({ nickname, avatar })); } catch { /* ignore */ }
  }

  /* ---------- reads ---------- */
  async get(wallet?: string): Promise<ProfileRow | null> {
    const addr = wallet ?? this.wallet.getAddress();
    if (!this.client || !addr) return null;
    const { data, error } = await this.client
      .from("sn_profiles").select("wallet,nickname,avatar_url,created_at")
      .ilike("wallet", addr).maybeSingle();
    if (error) { console.warn(`${LOG} get failed:`, error.message); return null; }
    const row = (data as ProfileRow) ?? null;
    if (row) this.cacheIdentity(addr, row.nickname, row.avatar_url);
    return row;
  }

  async stats(wallet?: string): Promise<ProfileStats | null> {
    const addr = wallet ?? this.wallet.getAddress();
    if (!this.client || !addr) return null;
    const { data, error } = await this.client.rpc("sn_profile_stats", { p_wallet: addr });
    if (error) { console.warn(`${LOG} stats failed:`, error.message); return null; }
    return (data as ProfileStats) ?? null;
  }

  async runs(wallet?: string, limit = PROFILE_HISTORY_LIMIT): Promise<RunRow[]> {
    const addr = wallet ?? this.wallet.getAddress();
    if (!this.client || !addr) return [];
    const { data, error } = await this.client
      .from("sn_runs").select("created_at,score,dist,weekly_rank,monthly_rank,big_bangs")
      .ilike("wallet", addr).order("created_at", { ascending: false }).limit(limit);
    if (error) { console.warn(`${LOG} runs failed:`, error.message); return []; }
    return (data ?? []) as RunRow[];
  }

  async rewards(wallet?: string): Promise<RewardRow[]> {
    const addr = wallet ?? this.wallet.getAddress();
    if (!this.client || !addr) return [];
    const { data, error } = await this.client
      .from("sn_payouts").select("period_type,period_start,rank,status,tx_hash")
      .ilike("wallet", addr).order("period_start", { ascending: false });
    if (error) { console.warn(`${LOG} rewards failed:`, error.message); return []; }
    return (data ?? []) as RewardRow[];
  }

  /* ---------- signed write ---------- */
  /** Save nickname and/or avatar (avatar_url null resets to the generated one). */
  async save(opts: { nickname?: string; avatarUrl?: string | null }): Promise<SaveResult> {
    if (!this.client) return { ok: false, error: "not-configured" };
    const addr = this.wallet.getAddress();
    if (!addr) return { ok: false, error: "no-wallet" };
    const ts = Date.now();
    const message = `SUPER NOVUS profile ts:${ts}`;
    let signature: string;
    try { signature = await this.wallet.signMessage(message); }
    catch { return { ok: false, error: "signature" }; }

    const body: Record<string, unknown> = { wallet: addr, ts, signature };
    if (opts.nickname !== undefined) body.nickname = opts.nickname;
    if (opts.avatarUrl !== undefined) body.avatar_url = opts.avatarUrl;

    const { error } = await this.client.functions.invoke("save-profile", { body });
    if (error) {
      const status = (error as any).context?.status;
      let detail = "";
      try { detail = await (error as any).context?.text?.(); } catch { /* ignore */ }
      if (status === 409 || /taken|duplicate|unique/i.test(detail)) return { ok: false, error: "nick-taken" };
      console.error(`${LOG} save failed (status ${status ?? "?"}):`, detail || error.message);
      return { ok: false, error: detail || error.message };
    }
    // Refresh the instant-identity cache.
    const cur = this.cachedIdentity(addr);
    this.cacheIdentity(addr,
      opts.nickname !== undefined ? opts.nickname : cur.nickname,
      opts.avatarUrl !== undefined ? opts.avatarUrl : cur.avatar);
    return { ok: true };
  }
}
