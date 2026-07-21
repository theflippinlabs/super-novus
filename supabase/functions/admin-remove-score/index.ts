// SUPER NOVUS — admin-remove-score Edge Function (Deno / Supabase)
// v1 — MUST deploy with verify_jwt=false (see supabase/config.toml).
// Disqualifies a wallet: deletes its leaderboard entries (all periods) and any
// pending payout, so a cheater is removed from the ranks and can't win. Owner-
// only, guarded by ADMIN_SECRET (constant-time compare). Fails CLOSED if the
// secret isn't configured. No funds move here.
// Deploy: supabase functions deploy admin-remove-score --no-verify-jwt

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
  const { wallet, secret } = body ?? {};

  const provided = (req.headers.get("x-admin-secret") ?? secret ?? "") as string;
  if (!(await constantTimeEqual(provided, ADMIN_SECRET))) return json({ error: "unauthorized" }, 401);

  if (typeof wallet !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return json({ error: "wallet" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Case-insensitive match (leaderboard stores the address as submitted).
  const lb = await supabase.from("sn_leaderboard").delete({ count: "exact" }).ilike("wallet", wallet);
  if (lb.error) return json({ error: "db", detail: lb.error.message }, 500);
  // Also drop any pending prize the cheater was auto-selected for.
  const po = await supabase.from("sn_payouts").delete({ count: "exact" }).ilike("wallet", wallet).eq("status", "pending");
  if (po.error) return json({ error: "db", detail: po.error.message }, 500);

  return json({ ok: true, removed: lb.count ?? 0, payoutsRemoved: po.count ?? 0 });
});

async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha), y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
