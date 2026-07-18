// SUPER NOVUS — save-profile Edge Function (Deno / Supabase)
// Saves a player's nickname and/or avatar. The caller proves ownership of the
// wallet by signing `SUPER NOVUS profile ts:<ts>`; the function verifies the
// signature matches the wallet before writing. Nicknames are unique
// (case-insensitive) — a clash returns 409 so the client can prompt for another.
// Avatars are stored as data URIs (or null = use the generated cosmic avatar).
// Deploy: supabase functions deploy save-profile --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { verifyMessage } from "https://esm.sh/viem@2.9.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const NICK_MIN = 3, NICK_MAX = 18;
const AVATAR_MAX = 400_000;                     // ~256 KB image as a data URI
const NICK_RE = /^[\p{L}\p{N} _.-]+$/u;          // letters, numbers, space, _ . -

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const { wallet, nickname, avatar_url, ts, signature } = body ?? {};

  if (typeof wallet !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return json({ error: "wallet" }, 400);
  if (typeof ts !== "number" || Math.abs(Date.now() - ts) > 5 * 60_000) return json({ error: "stale ts" }, 400);
  if (typeof signature !== "string") return json({ error: "signature" }, 400);

  // Validate optional fields.
  let nick: string | undefined;
  if (nickname !== undefined && nickname !== null) {
    if (typeof nickname !== "string") return json({ error: "nickname" }, 400);
    nick = nickname.trim();
    if (nick.length < NICK_MIN || nick.length > NICK_MAX || !NICK_RE.test(nick)) return json({ error: "nickname invalid" }, 400);
  }
  let avatar: string | null | undefined;
  if (avatar_url !== undefined) {
    if (avatar_url === null) avatar = null;
    else if (typeof avatar_url === "string" && avatar_url.length <= AVATAR_MAX &&
             /^(data:image\/|https:\/\/)/.test(avatar_url)) avatar = avatar_url;
    else return json({ error: "avatar invalid" }, 400);
  }

  // Verify wallet ownership.
  const message = `SUPER NOVUS profile ts:${ts}`;
  let valid = false;
  try { valid = await verifyMessage({ address: wallet as `0x${string}`, message, signature: signature as `0x${string}` }); }
  catch { valid = false; }
  if (!valid) return json({ error: "signature invalid" }, 401);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const w = wallet.toLowerCase();

  // Build the patch from provided fields only (never null out an unspecified one).
  const patch: Record<string, unknown> = { wallet: w, updated_at: new Date().toISOString() };
  if (nick !== undefined) patch.nickname = nick;
  if (avatar !== undefined) patch.avatar_url = avatar;

  const { error } = await supabase.from("sn_profiles").upsert(patch, { onConflict: "wallet" });
  if (error) {
    // 23505 = unique_violation (nickname already taken).
    if ((error as any).code === "23505" || /duplicate|unique/i.test(error.message)) return json({ error: "nickname taken" }, 409);
    return json({ error: "db", detail: error.message }, 500);
  }
  return json({ ok: true });
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
