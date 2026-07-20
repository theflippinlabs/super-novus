// SUPER NOVUS — record-bigbang Edge Function (Deno / Supabase)
// redeploy: v3 — MUST deploy with verify_jwt=false (see supabase/config.toml).
// Records a Big Bang purchase so the live Monthly Prize Pool (guaranteed $50 in
// CRO + 30% Community Bonus) can be computed. The purchase is verified ON-CHAIN
// against the Cronos RPC: the tx must pay the treasury the exact CRO amount from
// the claimed wallet. This prevents anyone from inflating the prize pool with
// fake revenue. Service role bypasses RLS. Idempotent on tx_hash.
// Deploy: supabase functions deploy record-bigbang --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// The treasury (also the Big Bang recipient). Overridable via env.
const TREASURY = (Deno.env.get("TREASURY_ADDRESS") ??
  "0x277B7CAD86D0f56Ae547533934dceA365ac7D7Bf").toLowerCase();
const RPC_URL = Deno.env.get("CRONOS_RPC_URL") ?? "https://evm.cronos.org";
// Valid Big Bang CRO amounts: à-la-carte revives (#1=10, #2=20, #3=40) AND the
// pre-paid packs (star=180, asteroid=550, supernova=1500). Pack purchases were
// previously rejected, so their revenue never reached the pool / the accounts.
const VALID_AMOUNTS = new Set([10, 20, 40, 180, 550, 1500]);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const { wallet, tx_hash, amount_cro } = body ?? {};

  if (typeof wallet !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return json({ error: "wallet" }, 400);
  if (typeof tx_hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(tx_hash)) return json({ error: "tx_hash" }, 400);
  const amount = Number(amount_cro);
  if (!Number.isInteger(amount) || !VALID_AMOUNTS.has(amount)) return json({ error: "amount_cro" }, 400);

  // --- on-chain verification ---
  const tx = await getTx(tx_hash);
  // Not yet propagated to the RPC node → 503 so the client retries later.
  if (!tx) return json({ error: "tx not found yet — retry" }, 503);
  if (typeof tx.to !== "string" || tx.to.toLowerCase() !== TREASURY) return json({ error: "wrong recipient" }, 422);
  if (typeof tx.from !== "string" || tx.from.toLowerCase() !== wallet.toLowerCase()) return json({ error: "wrong sender" }, 422);
  let value: bigint;
  try { value = BigInt(tx.value); } catch { return json({ error: "bad value" }, 422); }
  const expected = BigInt(amount) * (10n ** 18n);
  if (value !== expected) return json({ error: "amount mismatch" }, 422);

  // Require the tx to be MINED and SUCCESSFUL. A pending tx can be replaced
  // (same nonce, higher gas) so it never actually pays — recording it would
  // inflate revenue with money that never arrived. Gate on the receipt.
  const receipt = await getReceipt(tx_hash);
  if (!receipt || receipt.blockNumber == null) return json({ error: "tx not confirmed yet — retry" }, 503);
  if (String(receipt.status).toLowerCase() !== "0x1") return json({ error: "tx failed on-chain" }, 422);

  // --- record (idempotent on tx_hash), month computed server-side in UTC ---
  const now = new Date();
  const periodMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { error } = await supabase.from("sn_bigbang_purchases").upsert(
    { wallet: wallet.toLowerCase(), amount_cro: amount, tx_hash: tx_hash.toLowerCase(), period_month: periodMonth },
    { onConflict: "tx_hash", ignoreDuplicates: true },
  );
  if (error) return json({ error: "db", detail: error.message }, 500);

  return json({ ok: true, month: periodMonth, amount_cro: amount });
});

// eth_getTransactionByHash with a few retries to absorb RPC propagation delay.
async function getTx(hash: string): Promise<any | null> { return rpcResult("eth_getTransactionByHash", hash); }
// eth_getTransactionReceipt — null until the tx is mined (used to confirm success).
async function getReceipt(hash: string): Promise<any | null> { return rpcResult("eth_getTransactionReceipt", hash); }

async function rpcResult(method: string, hash: string): Promise<any | null> {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [hash] }),
      });
      const j = await r.json();
      if (j?.result) return j.result;
    } catch { /* transient — retry */ }
    if (i < 2) await new Promise((res) => setTimeout(res, 1500));
  }
  return null;
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
