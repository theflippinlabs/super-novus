// SUPER NOVUS — record-payout Edge Function (Deno / Supabase)
// redeploy: v4 — on-chain verification, NO wallet signature.
// Marks a prize payout as PAID and records the exact CRO amount for accounting.
// Authenticity is proven ON-CHAIN (not by a wallet signature, which on mobile
// WalletConnect often never surfaced): the given tx must be a real Cronos
// transaction FROM the treasury TO the recorded winner. The amount is read from
// that transaction, so the financial ledger cannot be faked. No funds move here.
// Deploy: supabase functions deploy record-payout --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TREASURY = (Deno.env.get("TREASURY_ADDRESS") ??
  "0x277B7CAD86D0f56Ae547533934dceA365ac7D7Bf").toLowerCase();
const RPC_URL = Deno.env.get("CRONOS_RPC_URL") ?? "https://evm.cronos.org";

/** Minimal JSON-RPC call to the Cronos node. */
async function rpc(method: string, params: unknown[]): Promise<any> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`rpc ${method} HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(`rpc ${method}: ${j.error?.message ?? "error"}`);
  return j.result;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method" }, 405);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const { period_type, period_start, tx_hash } = body ?? {};

  if (period_type !== "weekly" && period_type !== "monthly") return json({ error: "period_type" }, 400);
  if (typeof period_start !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(period_start)) return json({ error: "period_start" }, 400);
  if (typeof tx_hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(tx_hash)) return json({ error: "tx_hash" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Which winner should this tx have paid?
  const { data: row, error: readErr } = await supabase
    .from("sn_payouts").select("wallet")
    .eq("period_type", period_type).eq("period_start", period_start).eq("rank", 1)
    .maybeSingle();
  if (readErr) return json({ error: "db", detail: readErr.message }, 500);
  if (!row) return json({ error: "no such payout" }, 404);
  const winner = String(row.wallet).toLowerCase();

  // Verify the transaction on-chain: it must exist and be TREASURY -> winner.
  // The amount (value) is read straight from the chain, so it is authoritative.
  let amountCRO: number | null = null;
  try {
    const tx = await rpc("eth_getTransactionByHash", [tx_hash]);
    if (!tx) return json({ error: "tx not found on-chain" }, 400);
    const from = String(tx.from ?? "").toLowerCase();
    const to = String(tx.to ?? "").toLowerCase();
    if (from !== TREASURY) return json({ error: "tx not from treasury" }, 400);
    if (to !== winner) return json({ error: "tx recipient != winner" }, 400);
    const wei = BigInt(tx.value ?? "0x0");
    amountCRO = Math.round((Number(wei) / 1e18) * 1e6) / 1e6;
  } catch (e) {
    // If the node is unreachable we still record the tx hash (publicly auditable
    // on Cronoscan) but leave the amount null rather than trust an unverified value.
    console.error("record-payout on-chain verify failed:", e);
    return json({ error: "onchain verify failed", detail: String(e) }, 502);
  }

  const { error } = await supabase.from("sn_payouts")
    .update({ status: "paid", tx_hash, amount_cro: amountCRO, paid_at: new Date().toISOString() })
    .eq("period_type", period_type).eq("period_start", period_start).eq("rank", 1);
  if (error) return json({ error: "db", detail: error.message }, 500);

  return json({ ok: true, amount_cro: amountCRO });
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
