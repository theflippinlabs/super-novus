/* BigBangCredits — the player's Big Bang balance ("fuel for future missions").
   Packs are bought in advance with ONE on-chain CRO payment; the granted Big
   Bangs become credits. Dying then consumes a credit INSTANTLY — no wallet, no
   signature — as long as the per-run limit (3) allows it.

   Storage is per-wallet in localStorage (client-authoritative for the instant,
   frictionless revive). The pack PAYMENT is on-chain, so every purchase has a
   durable, recoverable receipt (tx hash kept in history) even though the balance
   itself currently lives on the device. The API is async and abstracted so a
   Supabase-backed balance can replace the store later without touching the UI. */
import { BB_CREDITS_PREFIX, type BigBangPack } from "../config";
import { WalletManager } from "./WalletManager";

export interface BBPurchase {
  packId: BigBangPack["id"];
  emoji: string;
  credits: number;
  cro: number;
  txHash: string;
  ts: number;        // epoch ms
}
interface Stored { purchased: number; consumed: number; history: BBPurchase[]; }

const EMPTY: Stored = { purchased: 0, consumed: 0, history: [] };

export class BigBangCredits {
  constructor(private wallet: WalletManager) {}

  /** Big Bangs available to spend right now (never negative). */
  available(wallet?: string): number {
    const s = this.read(wallet);
    return Math.max(0, s.purchased - s.consumed);
  }

  /** Purchases, most recent first. */
  history(wallet?: string): BBPurchase[] {
    return [...this.read(wallet).history].sort((a, b) => b.ts - a.ts);
  }

  /** Credit a purchased pack after its CRO payment confirmed. `now` is passed in
      because Date.now() is unavailable in some sandboxed contexts; the caller
      stamps the time. */
  addPack(pack: BigBangPack, txHash: string, now: number): void {
    const addr = this.wallet.getAddress();
    if (!addr) return;
    const s = this.read(addr);
    s.purchased += pack.credits;
    s.history.push({ packId: pack.id, emoji: pack.emoji, credits: pack.credits, cro: pack.priceCRO, txHash, ts: now });
    this.write(addr, s);
  }

  /** Spend one credit (instant revive). Returns false if none available. */
  consume(): boolean {
    const addr = this.wallet.getAddress();
    if (!addr) return false;
    const s = this.read(addr);
    if (s.purchased - s.consumed <= 0) return false;
    s.consumed += 1;
    this.write(addr, s);
    return true;
  }

  /* ---------- storage ---------- */
  private key(wallet?: string): string | null {
    const addr = wallet ?? this.wallet.getAddress();
    return addr ? BB_CREDITS_PREFIX + addr.toLowerCase() : null;
  }
  private read(wallet?: string): Stored {
    const k = this.key(wallet);
    if (!k) return { ...EMPTY };
    try {
      const raw = localStorage.getItem(k);
      if (raw) {
        const p = JSON.parse(raw);
        return {
          purchased: Number(p.purchased) || 0,
          consumed: Number(p.consumed) || 0,
          history: Array.isArray(p.history) ? p.history : [],
        };
      }
    } catch { /* private mode / bad json */ }
    return { ...EMPTY };
  }
  private write(wallet: string, s: Stored): void {
    const k = this.key(wallet);
    if (!k) return;
    try { localStorage.setItem(k, JSON.stringify(s)); } catch { /* ignore */ }
  }
}
