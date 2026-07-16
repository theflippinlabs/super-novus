/* WalletManager — real wallet connection (injected provider or WalletConnect v2).
   If VITE_WC_PROJECT_ID is missing AND no injected provider exists, `available`
   is false and the UI shows an explicit, non-blocking state (guest mode intact).
   No mock wallets, ever. */
import { SUPPORTED_CHAIN_ID, OPTIONAL_CHAIN_IDS } from "../config";

type Eip1193 = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, cb: (...a: unknown[]) => void): void;
  disconnect?(): Promise<void>;
};

export class WalletManager {
  private provider: Eip1193 | null = null;
  private address: string | null = null;
  private chainId: number | null = null;
  private listeners: Array<(addr: string | null, chainId: number | null) => void> = [];

  get projectId(): string {
    return (import.meta.env.VITE_WC_PROJECT_ID as string | undefined) ?? "";
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

  onChange(cb: (addr: string | null, chainId: number | null) => void): void {
    this.listeners.push(cb);
  }
  private emit(): void {
    for (const cb of this.listeners) cb(this.address, this.chainId);
  }

  /** Silent reconnection attempt (injected only — WC v2 restores via its own session). */
  async tryReconnect(): Promise<string | null> {
    const inj = this.injected;
    if (!inj) return null;
    try {
      const accounts = (await inj.request({ method: "eth_accounts" })) as string[];
      if (accounts && accounts.length > 0) {
        this.provider = inj;
        this.address = accounts[0];
        await this.refreshChain();
        this.watch(inj);
        this.emit();
        return this.address;
      }
    } catch { /* no silent session */ }
    return null;
  }

  async connect(): Promise<string> {
    // 1) injected first (MetaMask & co)
    const inj = this.injected;
    if (inj) {
      const accounts = (await inj.request({ method: "eth_requestAccounts" })) as string[];
      if (!accounts?.length) throw new Error("Aucun compte autorisé");
      this.provider = inj;
      this.address = accounts[0];
      await this.refreshChain();
      this.watch(inj);
      this.emit();
      return this.address;
    }
    // 2) WalletConnect v2 (QR modal)
    if (!this.projectId) throw new Error("VITE_WC_PROJECT_ID manquant");
    const { EthereumProvider } = await import("@walletconnect/ethereum-provider");
    const wc = await EthereumProvider.init({
      projectId: this.projectId,
      chains: [SUPPORTED_CHAIN_ID],
      optionalChains: OPTIONAL_CHAIN_IDS as unknown as [number, ...number[]],
      showQrModal: true,
      metadata: {
        name: "SUPER NOVUS",
        description: "A Novarys cosmic arcade experience",
        url: window.location.origin,
        icons: [`${window.location.origin}/icon-512.png`],
      },
    });
    await wc.enable();
    const accounts = (await wc.request({ method: "eth_accounts" })) as string[];
    if (!accounts?.length) throw new Error("Connexion refusée");
    this.provider = wc as unknown as Eip1193;
    this.address = accounts[0];
    this.chainId = Number(wc.chainId ?? SUPPORTED_CHAIN_ID);
    this.watch(this.provider);
    this.emit();
    return this.address;
  }

  private async refreshChain(): Promise<void> {
    try {
      const hex = (await this.provider!.request({ method: "eth_chainId" })) as string;
      this.chainId = parseInt(hex, 16);
    } catch { this.chainId = null; }
  }

  private watch(p: Eip1193): void {
    p.on?.("accountsChanged", (accs: unknown) => {
      const a = accs as string[];
      this.address = a?.length ? a[0] : null;
      this.emit();
    });
    p.on?.("chainChanged", (id: unknown) => {
      this.chainId = typeof id === "string" ? parseInt(id, 16) : Number(id);
      this.emit();
    });
    p.on?.("disconnect", () => { this.address = null; this.emit(); });
  }

  async signMessage(msg: string): Promise<string> {
    if (!this.provider || !this.address) throw new Error("Wallet non connecté");
    return (await this.provider.request({
      method: "personal_sign",
      params: [msg, this.address],
    })) as string;
  }

  async disconnect(): Promise<void> {
    try { await this.provider?.disconnect?.(); } catch { /* injected has none */ }
    this.provider = null;
    this.address = null;
    this.chainId = null;
    this.emit();
  }
}

export function shortAddr(a: string): string {
  return a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}
