/* WalletManager — production wallet connection.
   Two real paths: an injected EIP-1193 provider (MetaMask, Crypto.com DeFi
   Wallet, Rabby…) or WalletConnect v2 with the QR modal. If VITE_WC_PROJECT_ID
   is missing AND no injected provider exists, `available` is false and the UI
   shows an explicit, non-blocking state. Guest mode is always playable.
   No mock wallets, ever. */
import { SUPPORTED_CHAIN_ID, OPTIONAL_CHAIN_IDS, CRONOS_PARAMS, WC_PROJECT_ID_DEFAULT } from "../config";

type Eip1193 = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, cb: (...a: unknown[]) => void): void;
  removeListener?(event: string, cb: (...a: unknown[]) => void): void;
  disconnect?(): Promise<void>;
};

/** WalletConnect v2 provider surface we rely on. */
type WcProvider = Eip1193 & {
  enable(): Promise<string[]>;
  session?: unknown;
  accounts?: string[];
  chainId?: number;
};

const WC_SESSION_PREFIX = "wc@2:";

export class WalletManager {
  private provider: Eip1193 | null = null;
  private wc: WcProvider | null = null;              // cached WC instance
  private address: string | null = null;
  private chainId: number | null = null;
  private listeners: Array<(addr: string | null, chainId: number | null) => void> = [];
  private bound: { p: Eip1193; handlers: Record<string, (...a: unknown[]) => void> } | null = null;

  get projectId(): string {
    const env = (import.meta.env.VITE_WC_PROJECT_ID as string | undefined) ?? "";
    return env || WC_PROJECT_ID_DEFAULT;
  }
  get injected(): Eip1193 | null {
    return ((window as unknown as { ethereum?: Eip1193 }).ethereum) ?? null;
  }
  /** true if at least one real connection path exists */
  get available(): boolean {
    return Boolean(this.projectId) || Boolean(this.injected);
  }

  getAddress(): string | null { return this.address; }
  getChainId(): number | null { return this.chainId; }
  get onCronos(): boolean { return this.chainId === SUPPORTED_CHAIN_ID; }

  onChange(cb: (addr: string | null, chainId: number | null) => void): void {
    this.listeners.push(cb);
  }
  private emit(): void {
    for (const cb of this.listeners) cb(this.address, this.chainId);
  }

  /** Silent reconnection: restore an injected session, otherwise a WC v2
      session — without ever opening a modal. */
  async tryReconnect(): Promise<string | null> {
    // 1) injected: eth_accounts returns [] if not authorised (no prompt)
    const inj = this.injected;
    if (inj) {
      try {
        const accounts = (await inj.request({ method: "eth_accounts" })) as string[];
        if (accounts?.length) {
          this.provider = inj;
          this.address = accounts[0];
          await this.refreshChain();
          this.watch(inj);
          this.emit();
          return this.address;
        }
      } catch { /* no silent injected session */ }
    }
    // 2) WalletConnect v2: only touch the SDK if a stored session exists,
    //    so guest mode never pays the import cost.
    if (this.projectId && this.hasStoredWcSession()) {
      try {
        const wc = await this.initWc();
        if (wc.session) {
          // On a restored session accounts may not be populated yet — fall back
          // to eth_accounts (no prompt) so the connected state survives reloads.
          let accs = wc.accounts ?? [];
          if (!accs.length) {
            try { accs = (await wc.request({ method: "eth_accounts" })) as string[]; } catch { /* none */ }
          }
          if (accs?.length) {
            this.provider = wc;
            this.address = accs[0];
            this.chainId = Number(wc.chainId ?? this.chainId ?? SUPPORTED_CHAIN_ID);
            this.watch(wc);
            this.emit();
            return this.address;
          }
        }
      } catch { /* stale/expired WC session */ }
    }
    return null;
  }

  /** Re-check for a restored session when the tab becomes visible again. iOS
      Safari often suspends the page while the wallet app is open; on return the
      WC session may already be established. Never opens a modal / prompt. */
  async resume(): Promise<string | null> {
    if (this.address) return this.address;            // already connected
    const canInjected = Boolean(this.injected);
    const canWc = Boolean(this.projectId) && this.hasStoredWcSession();
    if (!canInjected && !canWc) return null;
    try { return await this.tryReconnect(); } catch { return null; }
  }

  async connect(): Promise<string> {
    // 1) injected first (MetaMask, Crypto.com, Rabby…)
    const inj = this.injected;
    if (inj) {
      const accounts = (await inj.request({ method: "eth_requestAccounts" })) as string[];
      if (!accounts?.length) throw new Error("Aucun compte autorisé");
      this.provider = inj;
      this.address = accounts[0];
      await this.refreshChain();
      this.watch(inj);
      this.emit();                                    // show connected immediately
      // Switch to Cronos in the background — never block the connected state on
      // a chain-switch round-trip (which re-opens the wallet app on mobile).
      void this.switchToCronos(inj).then(() => this.emit());
      return this.address;
    }
    // 2) WalletConnect v2 (QR modal / mobile deep link)
    if (!this.projectId) throw new Error("VITE_WC_PROJECT_ID manquant");
    const wc = await this.initWc();
    await wc.enable(); // opens the QR modal / deep-links to the wallet app
    const accounts = (wc.accounts?.length ? wc.accounts
      : (await wc.request({ method: "eth_accounts" })) as string[]);
    if (!accounts?.length) throw new Error("Connexion refusée");
    this.provider = wc;
    this.address = accounts[0];
    this.chainId = Number(wc.chainId ?? SUPPORTED_CHAIN_ID);
    this.watch(wc);
    this.emit();                                      // connected state now, no extra bounce
    void this.switchToCronos(wc).then(() => this.emit());
    return this.address;
  }

  /** Lazily create (once) the WalletConnect v2 provider. */
  private async initWc(): Promise<WcProvider> {
    if (this.wc) return this.wc;
    const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
    this.wc = (await EthereumProvider.init({
      projectId: this.projectId,
      // SUPER NOVUS is a Cronos game (Big Bang is paid in native CRO on Cronos),
      // so require Cronos in the session — this guarantees eth_sendTransaction is
      // approved for chain 25 and the CRO payment never fails on a chain mismatch.
      // Ethereum mainnet stays optional for broad wallet support; score signing
      // (personal_sign) works on any chain regardless.
      chains: [SUPPORTED_CHAIN_ID],
      optionalChains: [1, ...OPTIONAL_CHAIN_IDS] as unknown as [number, ...number[]],
      showQrModal: true,
      metadata: {
        name: "SUPER NOVUS",
        description: "A Novarys cosmic arcade experience",
        url: window.location.origin,
        icons: [`${window.location.origin}/icon.svg`],
      },
    })) as unknown as WcProvider;
    return this.wc;
  }

  private hasStoredWcSession(): boolean {
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(WC_SESSION_PREFIX)) return true;
      }
    } catch { /* storage unavailable */ }
    return false;
  }

  /** Ask an injected wallet to switch to Cronos, adding it if unknown.
      Never throws upward: signing works regardless of the active chain. */
  private async switchToCronos(p: Eip1193): Promise<void> {
    try {
      await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CRONOS_PARAMS.chainId }] });
      this.chainId = SUPPORTED_CHAIN_ID;
    } catch (e) {
      const code = (e as { code?: number })?.code;
      if (code === 4902) {
        try {
          await p.request({ method: "wallet_addEthereumChain", params: [CRONOS_PARAMS] });
          this.chainId = SUPPORTED_CHAIN_ID;
        } catch { /* user declined */ }
      }
      // 4001 (user rejected) or other: keep current chain, no throw
    }
  }

  private async refreshChain(): Promise<void> {
    try {
      const hex = (await this.provider!.request({ method: "eth_chainId" })) as string;
      this.chainId = parseInt(hex, 16);
    } catch { this.chainId = null; }
  }

  private watch(p: Eip1193): void {
    this.unwatch(); // never stack listeners across reconnects
    const handlers: Record<string, (...a: unknown[]) => void> = {
      accountsChanged: (accs: unknown) => {
        const a = accs as string[];
        this.address = a?.length ? a[0] : null;
        if (!this.address) this.clear();
        this.emit();
      },
      chainChanged: (id: unknown) => {
        this.chainId = typeof id === "string" ? parseInt(id, 16) : Number(id);
        this.emit();
      },
      // WC v2 may (re)establish a session after a mobile deep-link round-trip.
      connect: () => {
        this.provider?.request({ method: "eth_accounts" })
          .then((a) => { const arr = a as string[]; if (arr?.length) { this.address = arr[0]; this.emit(); } })
          .catch(() => { /* ignore */ });
      },
      disconnect: () => { this.clear(); this.emit(); },
      session_delete: () => { this.clear(); this.emit(); },
    };
    for (const [ev, cb] of Object.entries(handlers)) p.on?.(ev, cb);
    this.bound = { p, handlers };
  }

  private unwatch(): void {
    if (!this.bound) return;
    for (const [ev, cb] of Object.entries(this.bound.handlers)) this.bound.p.removeListener?.(ev, cb);
    this.bound = null;
  }

  async signMessage(msg: string): Promise<string> {
    if (!this.provider || !this.address) throw new Error("Wallet non connecté");
    // personal_sign expects a HEX-encoded message. Passing a raw UTF-8 string is
    // interpreted inconsistently across wallets and can produce a signature that
    // recovers to the wrong address (server-side verification then fails). Encode
    // to hex — the canonical form every library (ethers/viem) uses — so the wallet
    // signs the exact EIP-191 digest the Edge Function reconstructs.
    const hexMsg = "0x" + Array.from(new TextEncoder().encode(msg))
      .map((b) => b.toString(16).padStart(2, "0")).join("");
    return (await this.provider.request({
      method: "personal_sign",
      params: [hexMsg, this.address],
    })) as string;
  }

  /** Send a native CRO payment on Cronos; returns the transaction hash.
      Enforces the Cronos chain FIRST so value is never sent on another network
      (where the native token would not be CRO). Throws a PayError with a stable
      `reason` code ("no-wallet" | "wrong-chain" | "rejected" | "funds" | "failed")
      so the caller can show a precise, localized message instead of a generic one. */
  async payCRO(to: string, croAmount: number): Promise<string> {
    if (!this.provider || !this.address) throw new PayError("no-wallet", "Wallet non connecté");
    if (!/^0x[0-9a-fA-F]{40}$/.test(to)) throw new PayError("failed", "Adresse de paiement invalide");
    // Only switch if we're not already on Cronos — avoids an extra deep link that
    // some mobile wallets treat as a second prompt.
    await this.refreshChain();
    if (this.chainId !== SUPPORTED_CHAIN_ID) {
      await this.switchToCronos(this.provider);
      await this.refreshChain();
    }
    if (this.chainId !== SUPPORTED_CHAIN_ID)
      throw new PayError("wrong-chain", "Réseau Cronos requis");
    const valueWei = BigInt(Math.trunc(croAmount)) * (10n ** 18n);
    const valueHex = "0x" + valueWei.toString(16);
    try {
      const hash = await this.provider.request({
        method: "eth_sendTransaction",
        params: [{ from: this.address, to, value: valueHex }],
      });
      return String(hash);
    } catch (e) {
      const code = (e as { code?: number })?.code;
      const msg = (e instanceof Error ? e.message : String(e ?? "")).toLowerCase();
      if (code === 4001 || /reject|denied|refus|cancel|annul|user rejected/.test(msg))
        throw new PayError("rejected", "Transaction refusée");
      if (/insufficient funds|insufficient balance|not enough|exceeds balance/.test(msg))
        throw new PayError("funds", "Solde CRO insuffisant");
      throw new PayError("failed", e instanceof Error ? e.message : String(e ?? "erreur"));
    }
  }

  async disconnect(): Promise<void> {
    this.unwatch();
    try { await this.provider?.disconnect?.(); } catch { /* injected has none */ }
    this.clear();
    this.emit();
  }

  private clear(): void {
    this.provider = null;
    this.address = null;
    this.chainId = null;
  }
}

export function shortAddr(a: string): string {
  return a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/** Payment failure with a stable machine-readable reason so the UI can localize. */
export type PayReason = "no-wallet" | "wrong-chain" | "rejected" | "funds" | "failed";
export class PayError extends Error {
  constructor(public reason: PayReason, message: string) { super(message); this.name = "PayError"; }
}
