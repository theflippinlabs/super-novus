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

  /** Optional step logger for the purchase pipeline. The Big Bang Store sets this
      to render an on-device, always-visible trace (wallet connected → chainId →
      payload → request sent → response → credited), so a failed payment shows
      exactly which step stalled instead of a generic "Payment failed". */
  onLog: ((msg: string) => void) | null = null;
  private log(msg: string): void { try { this.onLog?.(msg); } catch { /* logging must never break the flow */ } }

  /** Fired the moment a wallet request (eth_sendTransaction) has been published,
      with the wallet's own deep-link target (or null). The UI uses it to show a
      user-tappable "Open wallet to confirm" button — on iOS WalletConnect does NOT
      auto-foreground the wallet for session requests, so without a fresh user
      gesture the confirmation screen never appears. */
  onRequestSent: ((redirect: string | null) => void) | null = null;

  /** The wallet's deep-link URL taken from the live WC session's peer metadata
      (the wallet advertises this at pairing time). Used to foreground the wallet
      so it shows a pending request. Null for injected wallets or when absent. */
  walletRedirect(): string | null {
    if (!this.wc || this.provider !== this.wc) return null;
    try {
      const r = (this.wc as unknown as { session?: { peer?: { metadata?: { redirect?: { native?: string; universal?: string } } } } })
        .session?.peer?.metadata?.redirect;
      const url = (r?.native || r?.universal || "").trim();
      return url || null;
    } catch { return null; }
  }

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
      this.log("connect: injected provider found");
      const accounts = (await inj.request({ method: "eth_requestAccounts" })) as string[];
      if (!accounts?.length) throw new Error("Aucun compte autorisé");
      this.provider = inj;
      this.address = accounts[0];
      await this.refreshChain();
      this.watch(inj);
      this.emit();                                    // show connected immediately
      this.log(`connect: injected connected ${shortAddr(this.address)} chain=${this.chainId ?? "?"}`);
      // Switch to Cronos in the background — never block the connected state on
      // a chain-switch round-trip (which re-opens the wallet app on mobile).
      void this.switchToCronos(inj).then(() => this.emit());
      return this.address;
    }
    // 2) WalletConnect v2 (QR modal / mobile deep link)
    if (!this.projectId) throw new Error("VITE_WC_PROJECT_ID manquant");
    this.log("connect: WalletConnect — opening wallet…");
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
    this.log(`connect: WC connected ${shortAddr(this.address)} chain=${this.chainId} approved=[${this.approvedChains().join(",") || "—"}]`);
    void this.switchToCronos(wc).then(() => this.emit());
    return this.address;
  }

  /** The eip155 chains actually approved in the active WalletConnect session. */
  private approvedChains(): string[] {
    if (!this.wc || this.provider !== this.wc) return [];
    try {
      const eip = (this.wc as unknown as { session?: { namespaces?: Record<string, { chains?: string[]; accounts?: string[] }> } })
        .session?.namespaces?.eip155;
      const set = new Set<string>();
      for (const c of eip?.chains ?? []) set.add(c);
      for (const a of eip?.accounts ?? []) { const p = a.split(":"); if (p.length >= 2) set.add(`${p[0]}:${p[1]}`); }
      return [...set];
    } catch { return []; }
  }

  /** Wait until the WalletConnect session is actually usable before sending a
      transaction: a session object exists and at least one account is present.
      On iOS the page is often restored from a deep-link round-trip before the SDK
      has re-hydrated the session, so sending immediately would publish into a void.
      Resolves true when ready, false if it never became ready within `ms`. */
  private async waitForSession(ms = 4000): Promise<boolean> {
    if (!this.wc || this.provider !== this.wc) return true; // injected: always ready
    const deadline = Date.now() + ms;
    // Date.now() is fine at runtime (this file is not a workflow script).
    for (;;) {
      const ready = Boolean(this.wc.session) && (this.wc.accounts?.length ?? 0) > 0;
      if (ready) return true;
      if (Date.now() >= deadline) return false;
      await new Promise((r) => setTimeout(r, 150));
    }
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

  /** Ask the wallet to switch to Cronos, adding it if unknown. Never throws
      upward: signing works regardless of the active chain. */
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

  /** Ensure the active chain is Cronos. No-op if already there; otherwise requests
      a switch (adding the chain if unknown). Returns true if on Cronos afterwards.
      Safe to call before any Cronos transaction. */
  async ensureCronos(): Promise<boolean> {
    await this.refreshChain();
    if (this.chainId === SUPPORTED_CHAIN_ID) return true;
    if (this.provider) {
      await this.switchToCronos(this.provider);
      await this.refreshChain();
    }
    return this.chainId === SUPPORTED_CHAIN_ID;
  }

  /** Tear down the current session and pair a fresh one (which is Cronos-scoped).
      Used when the restored session predates Cronos support so payments surface. */
  async reconnect(): Promise<string> {
    try { await this.disconnect(); } catch { /* ignore */ }
    // Drop the cached WalletConnect provider so initWc() builds a FRESH instance
    // and pairs a brand-new session. Without this, connect() reuses the stale
    // provider (and its old, possibly non-Cronos session), defeating the reconnect.
    try { await (this.wc as unknown as { disconnect?: () => Promise<void> })?.disconnect?.(); } catch { /* ignore */ }
    this.wc = null;
    return this.connect();
  }

  /** Prepare the wallet for a Cronos payment and report exactly what to do next.

      Uses `wallet_switchEthereumChain` as an AUTHORITATIVE probe. For a
      WalletConnect session the underlying provider (`handleSwitchChain`) does:
        • Cronos (eip155:25) IS in the session  → a purely LOCAL default-chain
          switch (no wallet round-trip, no deep-link) that ALSO makes the provider
          route the next `eth_sendTransaction` on eip155:25. Without this, requests
          are published on the provider's default chain (often eip155:1) and the
          wallet SILENTLY ignores a request for a chain not in its session — which
          is why the payment prompt never appeared while score signing (chain-
          agnostic personal_sign) worked.
        • Cronos NOT in the session → it throws "chain is not approved". That is our
          reliable signal that the session predates Cronos and must be re-paired.

      Returns:
        "ok"        → on Cronos and correctly routed; safe to pay.
        "reconnect" → session has no Cronos; caller should offer a one-tap reconnect.
        "switch"    → couldn't reach Cronos (injected wallet on the wrong network,
                      or the user declined); caller shows the manual Switch prompt. */
  async prepareCronos(): Promise<"ok" | "reconnect" | "switch"> {
    if (!this.provider) return "switch";
    const isWc = Boolean(this.wc) && this.provider === this.wc;

    if (isWc) {
      this.log(`prepareCronos: WC session approved=[${this.approvedChains().join(",") || "—"}]`);
      // Authoritative: read the APPROVED session chains directly. If Cronos isn't
      // among them, the wallet never granted it — re-pair. We deliberately do NOT
      // call wallet_switchEthereumChain in that case, because the SDK would then
      // send the switch over the relay (a pointless second deep-link) and could
      // still leave the tx routed on an un-approved chain that the wallet drops.
      if (!this.sessionHasChain(SUPPORTED_CHAIN_ID)) {
        this.log("prepareCronos: Cronos (eip155:25) NOT in session → reconnect");
        return "reconnect";
      }
      // Cronos IS approved → a LOCAL default-chain switch (no wallet round-trip)
      // so the next eth_sendTransaction is published on eip155:25, the chain the
      // wallet actually has in its session, and the prompt finally appears.
      try {
        await this.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CRONOS_PARAMS.chainId }] });
      } catch { /* local switch is best-effort when the chain is already approved */ }
      this.chainId = SUPPORTED_CHAIN_ID;
      this.emit();
      this.log("prepareCronos: routing chain set to 25 → ok");
      return "ok";
    }

    // Injected wallet (in-app dApp browser / extension): switch, adding Cronos if
    // the wallet doesn't know it yet. This path prompts natively — no relay.
    try {
      await this.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: CRONOS_PARAMS.chainId }] });
      this.chainId = SUPPORTED_CHAIN_ID;
      this.emit();
      return "ok";
    } catch (e) {
      const code = (e as { code?: number })?.code;
      const msg = (e instanceof Error ? e.message : String(e ?? "")).toLowerCase();
      if (code === 4902 || /unrecognized chain|add ethereum chain|chain.*not.*added/.test(msg)) {
        try {
          await this.provider.request({ method: "wallet_addEthereumChain", params: [CRONOS_PARAMS] });
          this.chainId = SUPPORTED_CHAIN_ID;
          this.emit();
          return "ok";
        } catch { return "switch"; }
      }
      await this.refreshChain();
      return this.chainId === SUPPORTED_CHAIN_ID ? "ok" : "switch";
    }
  }

  /** True when the active WalletConnect session's approved eip155 namespace really
      includes the given chain (as `eip155:<id>` in chains or accounts). Returns
      false — not a defensive true — when absent or unparseable, so a session that
      never granted Cronos is caught and re-paired instead of silently dropping the
      payment. Only meaningful for a WalletConnect provider. */
  private sessionHasChain(id: number): boolean {
    if (!this.wc || this.provider !== this.wc) return true; // injected: n/a
    try {
      const eip = (this.wc as unknown as { session?: { namespaces?: Record<string, { chains?: string[]; accounts?: string[] }> } })
        .session?.namespaces?.eip155;
      if (!eip) return false;
      const want = `eip155:${id}`;
      const hit = (arr?: string[]) => Array.isArray(arr) && arr.some((x) => x === want || x.startsWith(`${want}:`));
      return hit(eip.chains) || hit(eip.accounts);
    } catch { return false; }
  }

  /** Read-only snapshot for on-device diagnostics (?diag=1). Exposes the exact
      approved session chains/accounts and the routing chain so a wrong-chain /
      stale-session payment failure is visible instead of a silent black box. */
  diag(): { kind: string; chainId: number | null; chains: string[]; accounts: string[] } {
    const isWc = Boolean(this.wc) && this.provider === this.wc;
    let chains: string[] = [];
    let accounts: string[] = [];
    if (isWc) {
      try {
        const eip = (this.wc as unknown as { session?: { namespaces?: Record<string, { chains?: string[]; accounts?: string[] }> } })
          .session?.namespaces?.eip155;
        chains = eip?.chains ?? [];
        accounts = eip?.accounts ?? [];
      } catch { /* ignore */ }
    }
    return {
      kind: this.provider ? (isWc ? "walletconnect" : "injected") : "none",
      chainId: this.chainId,
      chains,
      accounts,
    };
  }

  /** Read the active chain. Prefers the WalletConnect session's own chainId — a
      reliable local value — because an eth_chainId round-trip is NOT answered by
      every mobile wallet over the WC relay and would otherwise wipe a known-good
      chain. Falls back to eth_chainId for injected wallets. Never nulls a known
      chain on a failed request (keeps the last value from connect / chainChanged). */
  private async refreshChain(): Promise<void> {
    const wcChain = this.wc && this.provider === this.wc ? this.wc.chainId : undefined;
    if (typeof wcChain === "number" && wcChain > 0) { this.chainId = wcChain; return; }
    try {
      const raw = await this.provider!.request({ method: "eth_chainId" });
      const n = typeof raw === "string" ? parseInt(raw, 16) : Number(raw);
      if (Number.isFinite(n) && n > 0) this.chainId = n;
    } catch { /* keep the last known chainId — do NOT null it out */ }
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
    // Make sure the WalletConnect session is actually re-hydrated after the
    // deep-link round-trip before we publish a request into a not-yet-ready relay.
    this.log("payCRO: waiting for session readiness…");
    const ready = await this.waitForSession();
    this.log(`payCRO: session ready=${ready} (session=${Boolean(this.wc?.session)}, accounts=${this.wc?.accounts?.length ?? "n/a"})`);
    if (!(await this.ensureCronos())) {
      this.log(`payCRO: ensureCronos failed, chain=${this.chainId ?? "?"}`);
      throw new PayError("wrong-chain", "Réseau Cronos requis");
    }
    const valueWei = BigInt(Math.trunc(croAmount)) * (10n ** 18n);
    const valueHex = "0x" + valueWei.toString(16);
    const tx = { from: this.address, to, value: valueHex, data: "0x" };
    this.log(`payCRO: payload from=${shortAddr(tx.from)} to=${shortAddr(to)} value=${croAmount} CRO chain=${this.chainId}`);
    try {
      // A wallet that receives a request for a chain not in its session drops it
      // WITHOUT ever responding — the promise would then hang forever and the UI
      // would sit on "Processing…". Race a timeout so we can surface a clear,
      // actionable message instead of an infinite spinner. `data:"0x"` is included
      // because a few wallets refuse to build a native transfer without it.
      const redirect = this.walletRedirect();
      this.log(`payCRO: eth_sendTransaction sent (redirect=${redirect ?? "none"}) → awaiting confirmation…`);
      const req = this.provider.request({ method: "eth_sendTransaction", params: [tx] });
      // iOS WalletConnect does NOT auto-foreground the wallet for a session request,
      // so the confirmation screen never appears on its own. Tell the UI to show a
      // tappable "Open wallet" button (a fresh user gesture reliably opens the app),
      // and also make a best-effort auto-redirect in case the gesture is still live.
      try { this.onRequestSent?.(redirect); } catch { /* ignore */ }
      if (redirect) { try { window.location.href = redirect; } catch { /* blocked outside gesture — button covers it */ } }
      const hash = await Promise.race([
        req,
        new Promise((_, rej) => setTimeout(() => rej(new PayError("timeout", "Aucune réponse du wallet")), 90_000)),
      ]);
      this.log(`payCRO: wallet responded → ${String(hash).slice(0, 14)}…`);
      return String(hash);
    } catch (e) {
      if (e instanceof PayError) { this.log(`payCRO: ${e.reason} — ${e.message}`); throw e; }
      const code = (e as { code?: number })?.code;
      const raw = e instanceof Error ? e.message : String(e ?? "");
      const msg = raw.toLowerCase();
      this.log(`payCRO: wallet error code=${code ?? "?"} — ${raw.slice(0, 120)}`);
      if (code === 4001 || /reject|denied|refus|cancel|annul|user rejected/.test(msg))
        throw new PayError("rejected", raw || "Transaction refusée");
      if (/insufficient funds|insufficient balance|not enough|exceeds balance/.test(msg))
        throw new PayError("funds", raw || "Solde CRO insuffisant");
      throw new PayError("failed", raw || "erreur");
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
export type PayReason = "no-wallet" | "wrong-chain" | "rejected" | "funds" | "failed" | "timeout";
export class PayError extends Error {
  constructor(public reason: PayReason, message: string) { super(message); this.name = "PayError"; }
}
