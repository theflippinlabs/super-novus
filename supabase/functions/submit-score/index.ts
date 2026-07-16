// SUPER NOVUS — submit-score Edge Function (Deno / Supabase)
// Verifies an EIP-191 signature, rate-limits, and upserts the best score.
// Deploy: supabase functions deploy submit-score --no-verify-jwt
// Secrets needed: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (set via `supabase secrets set`)
//
// SECURITY NOTE (documented honestly): the score is computed client-side.
// This function blocks anonymous submissions and absurd values, but is NOT
// a strong anti-cheat. Full server-side validation (input replay) is out of scope.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { verifyMessage } from "https://esm.sh/viem@2.9.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RATE_LIMIT_SECONDS = 30;
const MAX_DIST = 200_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  const { wallet, score, dist, dust, ts, signature } = body ?? {};
  if (typeof wallet !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(wallet))
    return json({ error: "wallet" }, 400);
  for (const [k, v] of [["score", score], ["dist", dist], ["dust", dust], ["ts", ts]]) {
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return json({ error: k }, 400);
  }
  if (typeof signature !== "string") return json({ error: "signature" }, 400);

  // 1) timestamp within ±5 min
  if (Math.abs(Date.now() - ts) > 5 * 60_000) return json({ error: "stale ts" }, 400);

  // 2) plausibility bounds
  if (dist > MAX_DIST) return json({ error: "dist bound" }, 400);
  if (score > dist * 3 + dust * 150 + 5000) return json({ error: "score bound" }, 400);

  // 3) signature must match wallet
  const message = `SUPER NOVUS score:${score} dist:${dist} dust:${dust} ts:${ts}`;
  let valid = false;
  try {
    valid = await verifyMessage({ address: wallet as `0x${string}`, message, signature: signature as `0x${string}` });
  } catch { valid = false; }
  if (!valid) return json({ error: "signature invalid" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 4) rate limit via dedicated table
  const { data: last } = await supabase
    .from("sn_score_submissions")
    .select("submitted_at")
    .eq("wallet", wallet)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last && Date.now() - new Date(last.submitted_at).getTime() < RATE_LIMIT_SECONDS * 1000)
    return json({ error: "rate limited" }, 429);

  await supabase.from("sn_score_submissions").insert({ wallet });

  // 5) upsert best score
  const { data: cur } = await supabase
    .from("sn_scores").select("best_score").eq("wallet", wallet).maybeSingle();

  let saved = false;
  if (!cur || score > cur.best_score) {
    const { error } = await supabase.from("sn_scores").upsert({
      wallet, best_score: score, best_dist: dist, best_dust: dust, updated_at: new Date().toISOString(),
    });
    if (error) return json({ error: "db" }, 500);
    saved = true;
  }
  return json({ ok: true, saved });
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}
