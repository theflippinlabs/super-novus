// SUPER NOVUS — set-profile Edge Function (Deno / Supabase)
// v1 — MUST deploy with verify_jwt=false (see supabase/config.toml).
// Saves a player's nickname/avatar to the SHARED profiles table so it shows the
// same everywhere. No wallet signature (consistent with submit-score — the mobile
// WalletConnect sign prompt never surfaced); a player writes their own wallet's
// profile. Nicknames are unique (case-insensitive). Service role bypasses RLS.
// Deploy: supabase functions deploy set-profile --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const NICK_MIN = 3, NICK_MAX = 18;
const NICK_RE = /^[\p{L}\p{N} _.\-]{3,18}$/u;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  const wallet = String(body?.wallet ?? "");
  if (!/^0x[0-9a-fA-F]{40}$/.test(wallet)) return json({ error: "wallet" }, 400);
  const w = wallet.toLowerCase();
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body ?? {}, k);

  // Normalize the requested changes. Absent key = leave unchanged; null/"" = reset.
  let nickname: string | null | undefined = undefined;
  if (has("nickname")) {
    const raw = body.nickname == null ? "" : String(body.nickname).trim();
    if (raw === "") nickname = null;
    else {
      if (raw.length < NICK_MIN || raw.length > NICK_MAX || !NICK_RE.test(raw)) return json({ error: "bad-nickname" }, 400);
      nickname = raw;
    }
  }
  let avatar_url: string | null | undefined = undefined;
  if (has("avatar_url")) {
    const raw = body.avatar_url == null ? "" : String(body.avatar_url);
    if (raw === "") avatar_url = null;
    else {
      if (raw.length > 300_000 || !/^(data:image\/(png|jpe?g|webp|svg\+xml);|https:\/\/)/.test(raw)) return json({ error: "bad-avatar" }, 400);
      avatar_url = raw;
    }
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Nickname uniqueness (case-insensitive), excluding this same wallet.
  if (typeof nickname === "string") {
    const { data: clash } = await supabase
      .from("sn_profiles").select("wallet").ilike("nickname", nickname).neq("wallet", w).limit(1).maybeSingle();
    if (clash) return json({ error: "nick-taken" }, 409);
  }

  // Merge with the existing row so an unspecified field is preserved.
  const { data: cur } = await supabase.from("sn_profiles").select("nickname,avatar_url").eq("wallet", w).maybeSingle();
  const row = {
    wallet: w,
    nickname: nickname === undefined ? (cur?.nickname ?? null) : nickname,
    avatar_url: avatar_url === undefined ? (cur?.avatar_url ?? null) : avatar_url,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("sn_profiles").upsert(row, { onConflict: "wallet" });
  if (error) {
    // A race on the unique index surfaces as a duplicate-key error → nick taken.
    if (/duplicate key|unique/i.test(error.message)) return json({ error: "nick-taken" }, 409);
    return json({ error: "db", detail: error.message }, 500);
  }
  return json({ ok: true, nickname: row.nickname, avatar_url: row.avatar_url });
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
