/* CronosPay — verify a native CRO payment purely by its transaction hash, with NO
   wallet integration at all. This is the wallet-agnostic fallback for the (common)
   case where a mobile wallet won't route a Cronos transaction over WalletConnect:
   the player sends CRO to the treasury from their wallet like any normal transfer,
   copies the transaction hash, and we confirm it on-chain via public Cronos RPC.
   Works with every wallet, no connection required. */
import { BIG_BANG_RECIPIENT, SUPPORTED_CHAIN_ID } from "../config";

// Public Cronos RPC endpoints, tried in order for resilience (CORS-enabled).
// VITE_CRONOS_RPC_URL, when set, is tried first.
const RPCS: string[] = [
  (import.meta.env.VITE_CRONOS_RPC_URL as string | undefined) || "",
  "https://evm.cronos.org",
  "https://cronos-evm-rpc.publicnode.com",
  "https://cronos.drpc.org",
].filter(Boolean);

export type VerifyReason =
  | "format" | "not-found" | "pending" | "failed"
  | "wrong-recipient" | "wrong-chain" | "underpaid" | "network";

export type VerifyResult =
  | { ok: true; value: bigint; from: string }
  | { ok: false; reason: VerifyReason; detail?: string };

/** One JSON-RPC call, falling over to the next endpoint on any failure. */
async function rpc(method: string, params: unknown[]): Promise<unknown> {
  let lastErr: unknown = null;
  for (const url of RPCS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
      const j = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (j.error) { lastErr = new Error(j.error.message || "rpc error"); continue; }
      return j.result;
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error("all RPCs failed");
}

type RpcTx = { to?: string | null; from?: string; value?: string; chainId?: string } | null;
type RpcReceipt = { status?: string; blockNumber?: string | null } | null;

/** Confirm that `txHash` is a successful Cronos transfer of at least `minCRO`
    to `recipient`. Pure on-chain verification — no wallet, no signature. */
export async function verifyPayment(
  txHash: string,
  minCRO: number,
  recipient: string = BIG_BANG_RECIPIENT,
): Promise<VerifyResult> {
  const hash = txHash.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return { ok: false, reason: "format" };

  let tx: RpcTx;
  let receipt: RpcReceipt;
  try {
    tx = (await rpc("eth_getTransactionByHash", [hash])) as RpcTx;
    receipt = (await rpc("eth_getTransactionReceipt", [hash])) as RpcReceipt;
  } catch (e) {
    return { ok: false, reason: "network", detail: e instanceof Error ? e.message : String(e) };
  }

  if (!tx) return { ok: false, reason: "not-found" };
  // A Cronos tx carries chainId 0x19 (25) — reject a hash from another network.
  if (tx.chainId != null) {
    const cid = typeof tx.chainId === "string" ? parseInt(tx.chainId, 16) : Number(tx.chainId);
    if (Number.isFinite(cid) && cid > 0 && cid !== SUPPORTED_CHAIN_ID)
      return { ok: false, reason: "wrong-chain", detail: String(cid) };
  }
  if (!receipt || receipt.blockNumber == null) return { ok: false, reason: "pending" };
  if (receipt.status != null && receipt.status !== "0x1") return { ok: false, reason: "failed" };

  const to = (tx.to || "").toLowerCase();
  if (to !== recipient.toLowerCase()) return { ok: false, reason: "wrong-recipient", detail: to };

  let value: bigint;
  try { value = BigInt(tx.value ?? "0x0"); } catch { value = 0n; }
  const minWei = BigInt(Math.trunc(minCRO)) * (10n ** 18n);
  if (value < minWei) return { ok: false, reason: "underpaid", detail: value.toString() };

  return { ok: true, value, from: (tx.from || "").toLowerCase() };
}

// --- Replay guard: a given tx hash can credit exactly one purchase on this device.
const USED_KEY = "super-novus:usedtx";

export function isTxUsed(hash: string): boolean {
  try {
    const raw = localStorage.getItem(USED_KEY);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    return Array.isArray(arr) && arr.includes(hash.trim().toLowerCase());
  } catch { return false; }
}

export function markTxUsed(hash: string): void {
  try {
    const raw = localStorage.getItem(USED_KEY);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    const set = Array.isArray(arr) ? arr : [];
    set.push(hash.trim().toLowerCase());
    localStorage.setItem(USED_KEY, JSON.stringify(set.slice(-200)));
  } catch { /* ignore */ }
}
