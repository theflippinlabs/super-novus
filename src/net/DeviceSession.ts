/* DeviceSession — "sign once, save forever".
   The problem it solves: submitting a score used to require a fresh wallet
   signature EVERY time, which on iOS means app-switching to the wallet and back
   for each save (and often hanging on "Saving…"). That is unacceptable once the
   player is already connected.

   The fix is a delegated device key:
     1. Once per device, the wallet signs a single authorization binding a local
        device key to the wallet address (with an expiry). That is the ONLY wallet
        popup the leaderboard ever needs.
     2. Every score afterwards is signed LOCALLY by the device key — instant, no
        wallet, no app-switch.
   The Edge Function verifies the delegation (wallet → device) once per submit and
   the per-score device signature, so ownership is still proven cryptographically.

   The device private key lives only in this browser's localStorage. Stealing it
   would let someone submit scores as this wallet until the delegation expires —
   an acceptable risk for an arcade leaderboard, and bounded by the expiry. */
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

const DEVKEY_KEY = "super-novus:devkey";
const DELEG_KEY = "super-novus:deleg";
/** How long a single authorization lasts before the wallet must sign again. */
export const DELEGATION_TTL_MS = 180 * 24 * 60 * 60 * 1000; // ~6 months

interface StoredKey { pk: `0x${string}`; address: string; }
export interface Delegation { wallet: string; device: string; exp: number; sig: string; }

/** The exact message the wallet signs to authorize a device. MUST match the Edge
    Function byte-for-byte (addresses lowercased, exp as an integer of ms). */
export function delegationMessage(wallet: string, device: string, exp: number): string {
  return `SUPER NOVUS authorize device ${device.toLowerCase()} for wallet ${wallet.toLowerCase()} until ${exp}`;
}

export class DeviceSession {
  private account: PrivateKeyAccount | null = null;

  /** Load (or lazily create) this browser's device key. */
  private key(): PrivateKeyAccount {
    if (this.account) return this.account;
    let stored: StoredKey | null = null;
    try {
      const raw = localStorage.getItem(DEVKEY_KEY);
      if (raw) stored = JSON.parse(raw) as StoredKey;
    } catch { /* private mode / corrupt */ }
    if (stored?.pk && /^0x[0-9a-fA-F]{64}$/.test(stored.pk)) {
      this.account = privateKeyToAccount(stored.pk);
    } else {
      const pk = generatePrivateKey();
      this.account = privateKeyToAccount(pk);
      try { localStorage.setItem(DEVKEY_KEY, JSON.stringify({ pk, address: this.account.address })); } catch { /* keep in memory */ }
    }
    return this.account;
  }

  /** This device's public address (the delegate). */
  deviceAddress(): string { return this.key().address; }

  /** A cached, still-valid delegation for `wallet` on THIS device, or null. */
  getValid(wallet: string): Delegation | null {
    const w = wallet.toLowerCase();
    const dev = this.deviceAddress().toLowerCase();
    let d: Delegation | null = null;
    try {
      const raw = localStorage.getItem(DELEG_KEY);
      if (raw) d = JSON.parse(raw) as Delegation;
    } catch { /* ignore */ }
    if (!d) return null;
    if (d.wallet?.toLowerCase() !== w) return null;
    if (d.device?.toLowerCase() !== dev) return null;
    // Re-authorize a day before expiry so a save never fails on a just-expired token.
    if (typeof d.exp !== "number" || d.exp - Date.now() < 24 * 60 * 60 * 1000) return null;
    if (typeof d.sig !== "string" || !d.sig) return null;
    return d;
  }

  /** Store a freshly-obtained delegation. */
  save(d: Delegation): void {
    try { localStorage.setItem(DELEG_KEY, JSON.stringify(d)); } catch { /* memory only */ }
  }

  /** Sign a score message LOCALLY with the device key (no wallet, instant). */
  async signScore(message: string): Promise<string> {
    return this.key().signMessage({ message });
  }

  /** Forget the delegation (e.g. on wallet disconnect / switch). Keeps the key. */
  clearDelegation(): void {
    try { localStorage.removeItem(DELEG_KEY); } catch { /* ignore */ }
  }
}
