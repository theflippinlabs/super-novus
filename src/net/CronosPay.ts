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

const hexToNum = (h: unknown): number => (typeof h === "string" ? parseInt(h, 16) : Number(h));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type RawTx = { hash?: string; from?: string; to?: string | null; value?: string };
const txMatches = (tx: RawTx, fromL: string, toL: string, minWei: bigint): boolean => {
  if ((tx.from || "").toLowerCase() !== fromL) return false;
  if ((tx.to || "").toLowerCase() !== toL) return false;
  let v: bigint;
  try { v = BigInt(tx.value ?? "0x0"); } catch { return false; }
  return v >= minWei;
};

/** Watch the chain FORWARD for a fresh native payment from `from` to `recipient`
    of at least `minCRO`. This recovers the (common on iOS) case where the wallet
    sent the transaction but the WalletConnect response never came back — the money
    is on-chain, so we detect it and credit anyway. Returns the tx hash or null. */
export async function watchForPayment(
  from: string,
  minCRO: number,
  recipient: string = BIG_BANG_RECIPIENT,
  opts: { timeoutMs?: number; onTick?: (block: number) => void } = {},
): Promise<string | null> {
  const fromL = from.toLowerCase();
  const toL = recipient.toLowerCase();
  const minWei = BigInt(Math.trunc(minCRO)) * (10n ** 18n);
  let cursor: number;
  try { cursor = Math.max(0, hexToNum(await rpc("eth_blockNumber", [])) - 4); } catch { return null; }
  const deadline = Date.now() + (opts.timeoutMs ?? 90_000);
  while (Date.now() < deadline) {
    let tip: number;
    try { tip = hexToNum(await rpc("eth_blockNumber", [])); } catch { tip = cursor; }
    for (; cursor <= tip; cursor++) {
      let blk: { transactions?: RawTx[] } | null;
      try { blk = (await rpc("eth_getBlockByNumber", ["0x" + cursor.toString(16), true])) as typeof blk; } catch { break; }
      for (const tx of blk?.transactions ?? []) {
        if (txMatches(tx, fromL, toL, minWei) && tx.hash) return tx.hash;
      }
      opts.onTick?.(cursor);
    }
    await sleep(4000);
  }
  return null;
}

/** Scan the last `lookback` blocks for already-made native payments from `from`
    to `recipient`. Used to RECOVER a payment whose credit was lost. Blocks are
    fetched in parallel batches so a wide window (default ~256 blocks ≈ 25 min on
    Cronos) stays fast. Returns each match as { hash, cro }, newest first. */
export async function findRecentPayments(
  from: string,
  recipient: string = BIG_BANG_RECIPIENT,
  lookback = 256,
  onProgress?: (done: number, total: number) => void,
): Promise<{ hash: string; cro: number }[]> {
  const fromL = from.toLowerCase();
  const toL = recipient.toLowerCase();
  let head: number;
  try { head = hexToNum(await rpc("eth_blockNumber", [])); } catch { return []; }
  const blocks: number[] = [];
  for (let n = head; n > head - lookback && n >= 0; n--) blocks.push(n);
  const out: { hash: string; cro: number }[] = [];
  const BATCH = 6;
  for (let i = 0; i < blocks.length; i += BATCH) {
    const slice = blocks.slice(i, i + BATCH);
    const results = await Promise.all(slice.map(async (n) => {
      try { return (await rpc("eth_getBlockByNumber", ["0x" + n.toString(16), true])) as { transactions?: RawTx[] } | null; }
      catch { return null; }
    }));
    for (const blk of results) {
      for (const tx of blk?.transactions ?? []) {
        if ((tx.from || "").toLowerCase() !== fromL || (tx.to || "").toLowerCase() !== toL) continue;
        let v: bigint;
        try { v = BigInt(tx.value ?? "0x0"); } catch { continue; }
        if (v > 0n && tx.hash) out.push({ hash: tx.hash, cro: Number(v / 10n ** 15n) / 1000 });
      }
    }
    onProgress?.(Math.min(i + BATCH, blocks.length), blocks.length);
  }
  return out;
}

/** Confirm a tx hash is a successful Cronos payment to `recipient` and return the
    CRO amount (so the caller can match it to a pack). Used for hash-based recovery
    when the auto-scan window doesn't reach the payment. */
export async function readPayment(
  txHash: string,
  recipient: string = BIG_BANG_RECIPIENT,
): Promise<{ ok: true; cro: number; from: string } | { ok: false; reason: VerifyReason }> {
  const hash = txHash.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) return { ok: false, reason: "format" };
  let tx: RpcTx;
  let receipt: RpcReceipt;
  try {
    tx = (await rpc("eth_getTransactionByHash", [hash])) as RpcTx;
    receipt = (await rpc("eth_getTransactionReceipt", [hash])) as RpcReceipt;
  } catch (e) {
    return { ok: false, reason: "network" };
  }
  if (!tx) return { ok: false, reason: "not-found" };
  if (!receipt || receipt.blockNumber == null) return { ok: false, reason: "pending" };
  if (receipt.status != null && receipt.status !== "0x1") return { ok: false, reason: "failed" };
  if ((tx.to || "").toLowerCase() !== recipient.toLowerCase()) return { ok: false, reason: "wrong-recipient" };
  let v: bigint;
  try { v = BigInt(tx.value ?? "0x0"); } catch { v = 0n; }
  return { ok: true, cro: Number(v / 10n ** 15n) / 1000, from: (tx.from || "").toLowerCase() };
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
