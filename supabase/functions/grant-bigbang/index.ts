// SUPER NOVUS — grant-bigbang Edge Function (Deno / Supabase)
// v1 — MUST deploy with verify_jwt=false (see supabase/config.toml).
// Gifts free Big Bang credits to a wallet (promo / ops). Because the endpoint is
// public, it is protected by an ADMIN secret: the caller must send the exact
// ADMIN_SECRET (set via `supabase secrets set ADMIN_SECRET=…`). No wallet
// signature is used (the mobile WalletConnect prompt never surfaced). Fails
// CLOSED — if ADMIN_SECRET is not configured, every call is rejected.
// Deploy: supabase functions deploy grant-bigbang --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-admin-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  const ADMIN_SECRET = Deno.env.get("ADMIN_SECRET") ?? "";
  if (!ADMIN_SECRET) return json({ error: "admin secret not configured" }, 503);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const { wallet, credits, note, secret } = body ?? {};

  const provided = (req.headers.get("x-admin-secret") ?? secret ?? "") as string;
  if (provided !== ADMIN_SECRET) return json({ error: "unauthorized" }, 401);

  if (typeof wallet !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return json({ error: "wallet" }, 400);
  const n = Math.floor(Number(credits));
  if (!Number.isInteger(n) || n < 1 || n > 90) return json({ error: "credits" }, 400);
  const reason = typeof note === "string" ? note.slice(0, 200) : null;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data, error } = await supabase.from("sn_bigbang_grants")
    .insert({ wallet: wallet.toLowerCase(), credits: n, note: reason })
    .select("id").single();
  if (error) return json({ error: "db", detail: error.message }, 500);

  return json({ ok: true, id: data?.id, wallet: wallet.toLowerCase(), credits: n });
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
