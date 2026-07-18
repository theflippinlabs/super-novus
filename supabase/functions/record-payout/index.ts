// SUPER NOVUS — record-payout Edge Function (Deno / Supabase)
// redeploy: v3 — MUST deploy with verify_jwt=false (see supabase/config.toml).
// Marks a prize payout as PAID. Only the treasury owner can call it: the caller
// signs a message with the treasury wallet and the function verifies the
// signature matches TREASURY_ADDRESS. No funds move here — the owner already
// sent the CRO from their own wallet; this just records the tx for transparency.
// Deploy: supabase functions deploy record-payout --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { verifyMessage } from "https://esm.sh/viem@2.9.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// The treasury (also the Big Bang recipient). Overridable via env.
const TREASURY = (Deno.env.get("TREASURY_ADDRESS") ??
  "0x277B7CAD86D0f56Ae547533934dceA365ac7D7Bf").toLowerCase();

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const { period_type, period_start, tx_hash, wallet, signature } = body ?? {};

  if (period_type !== "weekly" && period_type !== "monthly") return json({ error: "period_type" }, 400);
  if (typeof period_start !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(period_start)) return json({ error: "period_start" }, 400);
  if (typeof tx_hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(tx_hash)) return json({ error: "tx_hash" }, 400);
  if (typeof wallet !== "string" || wallet.toLowerCase() !== TREASURY) return json({ error: "not treasury" }, 403);
  if (typeof signature !== "string") return json({ error: "signature" }, 400);

  const message = `SUPER NOVUS payout ${period_type}:${period_start} tx:${tx_hash}`;
  let valid = false;
  try {
    valid = await verifyMessage({ address: wallet as `0x${string}`, message, signature: signature as `0x${string}` });
  } catch { valid = false; }
  if (!valid) return json({ error: "signature invalid" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { error } = await supabase.from("sn_payouts")
    .update({ status: "paid", tx_hash, paid_at: new Date().toISOString() })
    .eq("period_type", period_type).eq("period_start", period_start).eq("rank", 1);
  if (error) return json({ error: "db", detail: error.message }, 500);

  return json({ ok: true });
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
