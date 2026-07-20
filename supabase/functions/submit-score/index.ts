// SUPER NOVUS — submit-score Edge Function (Deno / Supabase)
// redeploy: v5 — robust signature verification (EOA recover + EIP-1271/6492 + direct 1271).
// Verifies an EIP-191 signature, rate-limits, records the submission, and
// upserts the wallet's best score into the current WEEKLY and MONTHLY periods.
// Deploy: supabase functions deploy submit-score --no-verify-jwt
// Secrets needed: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (via `supabase secrets set`)
//
// SECURITY NOTE (documented honestly): the score is computed client-side.
// This function blocks anonymous submissions and absurd values via a signature
// + bounds, but is NOT a strong anti-cheat. Full server-side validation is out
// of scope. Guest players (no wallet) cannot submit and never appear in ranks.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { createPublicClient, encodeFunctionData, hashMessage, http, recoverMessageAddress } from "https://esm.sh/viem@2.9.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RATE_LIMIT_SECONDS = 30;
const MAX_DIST = 200_000;
// Cronos RPC — used only to verify smart-contract-wallet signatures (EIP-1271).
const RPC_URL = Deno.env.get("CRONOS_RPC_URL") ?? "https://evm.cronos.org";

/** Verify an EIP-191 personal_sign signature, supporting BOTH externally-owned
    accounts and smart-contract wallets:
      1) EOA  — recover the signer offline (ecrecover) and compare. No network.
      2) Smart account (EIP-1271 / EIP-6492) — verify on-chain via the Cronos RPC.
         Many mobile wallets are smart accounts whose signatures cannot be checked
         with plain ecrecover; skipping this rejected otherwise-valid submissions.
    Returns the recovered EOA address (or "") alongside the verdict, for honest
    error reporting — recovered addresses are public information. */
async function verifySignature(
  wallet: string,
  message: string,
  signature: `0x${string}`,
): Promise<{ valid: boolean; recovered: string }> {
  const expected = wallet.toLowerCase();
  let recovered = "";
  try {
    recovered = (await recoverMessageAddress({ message, signature })).toLowerCase();
  } catch (e) {
    console.error("recoverMessageAddress failed:", e);
  }
  if (recovered && recovered === expected) return { valid: true, recovered };

  // Fallback A: viem's universal (EIP-6492/1271) verification via a deployless call.
  const client = createPublicClient({ transport: http(RPC_URL) });
  try {
    if (await client.verifyMessage({ address: wallet as `0x${string}`, message, signature })) {
      return { valid: true, recovered };
    }
  } catch (e) {
    console.error("on-chain universal verify failed:", e);
  }

  // Fallback B: direct EIP-1271 isValidSignature(bytes32,bytes) → magic 0x1626ba7e.
  // A plain eth_call to the account contract; works even where deployless calls
  // aren't supported by the RPC, as long as the smart account exists on Cronos.
  try {
    const data = encodeFunctionData({
      abi: [{
        name: "isValidSignature", type: "function", stateMutability: "view",
        inputs: [{ name: "hash", type: "bytes32" }, { name: "signature", type: "bytes" }],
        outputs: [{ name: "", type: "bytes4" }],
      }],
      functionName: "isValidSignature",
      args: [hashMessage(message), signature],
    });
    const res = await client.call({ to: wallet as `0x${string}`, data });
    if (typeof res?.data === "string" && res.data.toLowerCase().startsWith("0x1626ba7e")) {
      return { valid: true, recovered };
    }
  } catch (e) {
    console.error("direct EIP-1271 isValidSignature failed:", e);
  }
  return { valid: false, recovered };
}

/** Monday 00:00 UTC of the week containing d, as YYYY-MM-DD. */
function weekStartUTC(d: Date): string {
  const diff = (d.getUTCDay() + 6) % 7; // days since Monday
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - diff))
    .toISOString().slice(0, 10);
}
/** 1st of the month, 00:00 UTC, as YYYY-MM-DD. */
function monthStartUTC(d: Date): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }

  const { wallet, score, dist, dust, ts, signature, delegation } = body ?? {};
  // Big Bang count is informational (not part of the signed message); clamp it.
  const bigBangs = Math.max(0, Math.min(3, Math.floor(Number((body ?? {}).bigbangs) || 0)));
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

  // 3) authenticity. TWO accepted proofs:
  //    (A) Delegated device key — the wallet signed ONCE to authorize a local device
  //        key; each score is then signed by that device key. This is the default
  //        path (no wallet popup per save). We verify the wallet→device delegation
  //        AND that the score was signed by the delegated device.
  //    (B) Legacy direct path — the wallet itself signed the score message. Kept for
  //        backward compatibility with older clients.
  const message = `SUPER NOVUS score:${score} dist:${dist} dust:${dust} ts:${ts}`;
  if (delegation && typeof delegation === "object") {
    const device = String((delegation as any).device ?? "");
    const exp = Number((delegation as any).exp);
    const dsig = String((delegation as any).sig ?? "");
    if (!/^0x[0-9a-fA-F]{40}$/.test(device)) return json({ error: "delegation device" }, 400);
    if (!Number.isFinite(exp) || exp <= Date.now()) return json({ error: "signature invalid", detail: "delegation expired" }, 401);
    // Reject absurdly long-lived tokens (hygiene) — ~200 days max.
    if (exp - Date.now() > 200 * 24 * 60 * 60_000) return json({ error: "delegation exp too far" }, 400);
    if (typeof dsig !== "string" || !dsig) return json({ error: "delegation sig" }, 400);

    // 3a) the wallet authorized this device (EOA or smart-contract wallet).
    const authMsg = `SUPER NOVUS authorize device ${device.toLowerCase()} for wallet ${String(wallet).toLowerCase()} until ${exp}`;
    const auth = await verifySignature(wallet, authMsg, dsig as `0x${string}`);
    if (!auth.valid) {
      return json({ error: "signature invalid", detail: "bad delegation", recovered: auth.recovered || null, expected: String(wallet).toLowerCase() }, 401);
    }
    // 3b) the score was signed by the delegated device key (always an EOA).
    let scoreSigner = "";
    try { scoreSigner = (await recoverMessageAddress({ message, signature: signature as `0x${string}` })).toLowerCase(); }
    catch (e) { console.error("device recover failed:", e); }
    if (!scoreSigner || scoreSigner !== device.toLowerCase()) {
      return json({ error: "signature invalid", detail: "device mismatch", recovered: scoreSigner || null, expected: device.toLowerCase() }, 401);
    }
  } else {
    const { valid, recovered } = await verifySignature(wallet, message, signature as `0x${string}`);
    if (!valid) {
      // Honest, specific error (public addresses only) — never a fake "JWT" problem.
      return json({ error: "signature invalid", recovered: recovered || null, expected: wallet.toLowerCase() }, 401);
    }
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 4) rate limit
  const { data: last } = await supabase
    .from("sn_score_submissions")
    .select("submitted_at")
    .eq("wallet", wallet)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last && Date.now() - new Date(last.submitted_at).getTime() < RATE_LIMIT_SECONDS * 1000)
    return json({ error: "rate limited" }, 429);

  await supabase.from("sn_score_submissions").insert({ wallet, score, dist, dust, big_bangs: bigBangs });

  // 5) upsert best into the current weekly + monthly periods
  const now = new Date();
  const periods: Array<{ period_type: "weekly" | "monthly"; period_start: string }> = [
    { period_type: "weekly", period_start: weekStartUTC(now) },
    { period_type: "monthly", period_start: monthStartUTC(now) },
  ];

  let saved = false;
  for (const p of periods) {
    const { data: cur } = await supabase
      .from("sn_leaderboard")
      .select("best_score")
      .eq("wallet", wallet)
      .eq("period_type", p.period_type)
      .eq("period_start", p.period_start)
      .maybeSingle();

    if (!cur || score > cur.best_score) {
      const { error } = await supabase.from("sn_leaderboard").upsert(
        {
          wallet,
          period_type: p.period_type,
          period_start: p.period_start,
          best_score: score,
          best_dist: dist,
          best_dust: dust,
          big_bangs: bigBangs,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "wallet,period_type,period_start" },
      );
      if (error) return json({ error: "db", detail: error.message }, 500);
      saved = true;
    }
  }

  return json({ ok: true, saved });
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });
}
