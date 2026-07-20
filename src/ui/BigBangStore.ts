/* BigBangStore — buy Big Bang Packs in advance ("fuel for future missions").
   A premium full-screen sheet with the three packs as cards; Supernova is
   highlighted as best value. Buying triggers ONE CRO payment (WalletConnect);
   on success the credits are added to the player's balance and future revives
   are instant with no wallet. Fails soft with a precise, localized reason. */
import { WalletManager, PayError } from "../net/WalletManager";
import { BigBangCredits } from "../net/BigBangCredits";
import { verifyPayment, isTxUsed, markTxUsed } from "../net/CronosPay";
import { BIG_BANG_PACKS, BIG_BANG_RECIPIENT, type BigBangPack } from "../config";
import { i18n, t } from "../i18n";

const BCP47: Record<string, string> = { fr: "fr-FR", en: "en-US", ko: "ko-KR" };

export class BigBangStore {
  private el: HTMLElement;
  private busy = false;

  constructor(
    private wallet: WalletManager,
    private credits: BigBangCredits,
    private onChange: () => void,     // refresh menu/profile/game-over credit displays
  ) {
    this.injectStyles();
    const el = document.createElement("div");
    el.id = "bbStore";
    el.className = "bbsOverlay";
    el.style.display = "none";
    document.body.appendChild(el);
    this.el = el;
    i18n.onChange(() => { if (this.isOpen()) this.render(); });
  }

  isOpen(): boolean { return this.el.style.display !== "none"; }
  close(): void { this.el.style.display = "none"; this.el.innerHTML = ""; this.busy = false; }
  open(): void { this.el.style.display = "flex"; this.render(); }

  private cro(n: number): string { return n.toLocaleString(BCP47[i18n.get()] ?? "en-US"); }

  private render(): void {
    const bal = this.credits.available();
    const cards = BIG_BANG_PACKS.map((p) => this.card(p)).join("");
    this.el.innerHTML = `
      <div class="bbsSheet">
        <div class="bbsHead">
          <div class="bbsTitleWrap">
            <div class="bbsTitle">${t("store.title")}</div>
            <div class="bbsBal">💥 ${bal} ${t("store.available")}</div>
          </div>
          <button class="bbsClose" id="bbsClose" aria-label="${t("common.close")}">✕</button>
        </div>
        <div class="bbsSub">${t("store.subtitle")}</div>
        <div class="bbsCards">${cards}</div>
        <div id="bbsMsg" class="bbsMsg"></div>
        <div id="bbsLogWrap" class="bbsLogWrap" style="display:none">
          <div class="bbsLogHead">${t("store.logTitle")}</div>
          <pre id="bbsLog" class="bbsLog"></pre>
        </div>
      </div>`;
    // Restore the last attempt's log (it survives the wallet deep-link / reload),
    // so the player and I can see exactly where a purchase stalled.
    const saved = this.loadLog();
    if (saved) this.renderLog(saved);
    (this.el.querySelector("#bbsClose") as HTMLElement).addEventListener("click", () => this.close());
    this.el.addEventListener("click", (e) => { if (e.target === this.el && !this.busy) this.close(); });
    for (const btn of this.el.querySelectorAll<HTMLButtonElement>(".bbsBuy"))
      btn.addEventListener("click", () => this.buy(btn.dataset.pack as BigBangPack["id"]));
  }

  private card(p: BigBangPack): string {
    const best = p.best ? " bbsBest" : "";
    const ribbon = p.best ? `<div class="bbsRibbon">${t("store.bestValue")}</div>` : "";
    const name = t(`store.pack.${p.id}`);
    const tag = t(`store.tag.${p.id}`);
    return `
      <div class="bbsCard${best}">
        ${ribbon}
        <div class="bbsIcon">${p.emoji}</div>
        <div class="bbsName">${name}</div>
        <div class="bbsTag">${tag}</div>
        <div class="bbsCredits">💥 ${p.credits} <span>${t("store.bigBangs")}</span></div>
        <div class="bbsRuns">${t("store.runs", { n: p.runs })}</div>
        <div class="bbsPricing">
          <span class="bbsNormal">${this.cro(p.normalCRO)}</span>
          <span class="bbsPrice">${this.cro(p.priceCRO)} CRO</span>
        </div>
        <div class="bbsSave">${t("store.save", { n: this.cro(p.saveCRO) })}</div>
        <button class="bbsBuy${best}" data-pack="${p.id}">${t("store.buy")}</button>
      </div>`;
  }

  private msg(text: string, ok = false): void {
    const m = this.el.querySelector("#bbsMsg") as HTMLElement | null;
    if (m) { m.textContent = text; m.className = `bbsMsg ${ok ? "ok" : "err"}`; }
  }

  // ── Purchase pipeline log ─────────────────────────────────────────────────
  // Always visible (not gated by ?diag). Every step is timestamped and persisted
  // to sessionStorage so it survives the wallet deep-link round-trip and a Safari
  // reload — the player (and support) can see exactly where a payment stalled.
  private static readonly LOG_KEY = "super-novus:bbs:log";
  private logLines: string[] = [];
  private scrolledToLog = false;

  private clock(): string {
    const d = new Date();
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  private logStep(msg: string): void {
    this.logLines.push(`${this.clock()}  ${msg}`);
    try { sessionStorage.setItem(BigBangStore.LOG_KEY, JSON.stringify(this.logLines)); } catch { /* ignore */ }
    this.renderLog(this.logLines);
    // Bring the log into view once per attempt so the player sees the live pipeline
    // (and the outcome) without hunting below the pack cards.
    if (!this.scrolledToLog) {
      this.scrolledToLog = true;
      try { this.el.querySelector("#bbsLogWrap")?.scrollIntoView({ block: "center", behavior: "smooth" }); } catch { /* ignore */ }
    }
  }

  private renderLog(lines: string[]): void {
    const wrap = this.el.querySelector("#bbsLogWrap") as HTMLElement | null;
    const pre = this.el.querySelector("#bbsLog") as HTMLElement | null;
    if (!wrap || !pre) return;
    wrap.style.display = lines.length ? "block" : "none";
    pre.textContent = lines.join("\n");
    pre.scrollTop = pre.scrollHeight;
  }

  private loadLog(): string[] {
    try {
      const raw = sessionStorage.getItem(BigBangStore.LOG_KEY);
      const arr = raw ? JSON.parse(raw) : null;
      if (Array.isArray(arr)) { this.logLines = arr.slice(-60); return this.logLines; }
    } catch { /* ignore */ }
    return [];
  }

  private resetLog(): void {
    this.logLines = [];
    this.scrolledToLog = false;
    try { sessionStorage.removeItem(BigBangStore.LOG_KEY); } catch { /* ignore */ }
  }

  private async buy(packId: BigBangPack["id"]): Promise<void> {
    if (this.busy) return;
    const pack = BIG_BANG_PACKS.find((p) => p.id === packId);
    if (!pack) return;
    this.busy = true;
    const btns = this.el.querySelectorAll<HTMLButtonElement>(".bbsBuy");
    btns.forEach((b) => (b.disabled = true));
    this.msg(t("store.processing"), true);
    this.resetLog();
    this.logStep(`▶ buy ${pack.id} — ${pack.priceCRO} CRO`);
    // Stream every WalletManager step (connect, chainId, payload, request, response)
    // into the on-device log.
    this.wallet.onLog = (m) => this.logStep(m);
    // When the tx request is published, WalletConnect on iOS won't foreground the
    // wallet by itself — show a tappable button so a fresh user gesture opens it.
    this.wallet.onRequestSent = (url) => this.showConfirmButton(url);
    try {
      // 1) Connect. If the wallet injects a provider (we're inside its own dApp
      // browser), ALWAYS use it directly — it pays natively on Cronos, unlike a
      // WalletConnect session that may only grant Ethereum. Otherwise fall back to
      // WalletConnect (Safari / external wallet).
      this.logStep(`· injected provider present: ${this.wallet.hasInjected()}`);
      if (this.wallet.hasInjected()) {
        this.logStep("· using wallet's direct (injected) provider");
        await this.wallet.connectDirect();
      } else if (!this.wallet.getAddress()) {
        this.logStep("· not connected → connecting (WalletConnect)");
        await this.wallet.connect();
      }
      const addr = this.wallet.getAddress();
      this.logStep(`✓ wallet connected: ${addr ? addr.slice(0, 6) + "…" + addr.slice(-4) : "none"}`);
      const d0 = this.wallet.diag();
      this.logStep(`· chainId=${d0.chainId ?? "?"} kind=${d0.kind} approved=[${d0.chains.join(",") || "—"}]`);

      // 2) Authoritative Cronos check (also fixes tx routing to eip155:25).
      const prep = await this.wallet.prepareCronos();
      this.logStep(`· prepareCronos → ${prep}`);
      // Session doesn't include Cronos. For WalletConnect wallets that simply don't
      // expose Cronos (e.g. Crypto.com Onchain over WC grants only eip155:1), a
      // re-pair can't fix it — so the reliable in-app-browser path is shown first,
      // with a small secondary "reconnect" option for wallets that CAN grant Cronos
      // on a fresh pairing.
      if (prep === "reconnect") { this.showBrowserHint(pack); return; }
      if (prep === "switch") { this.showSwitch(pack); return; }

      // 3) Pay — payCRO logs session-readiness, payload, request, and response.
      const txHash = await this.wallet.payCRO(BIG_BANG_RECIPIENT, pack.priceCRO);
      this.logStep(`✓ callback: tx ${txHash.slice(0, 14)}…`);

      // 4) Credit.
      this.credits.addPack(pack, txHash, Date.now());
      this.logStep(`✓ purchase credited: +${pack.credits} Big Bangs`);
      this.onChange();
      const keep = this.logLines.slice();   // render() rebuilds the DOM — re-show the log
      this.render();
      this.renderLog(keep);
      this.msg(t("store.purchased", { n: pack.credits }), true);
    } catch (e) {
      const reason = e instanceof PayError ? e.reason : "failed";
      const raw = e instanceof Error ? e.message : String(e ?? "");
      this.logStep(`✗ ${reason}: ${raw.slice(0, 140) || "?"}`);
      if (reason === "wrong-chain") { this.showSwitch(pack); return; }
      const rejectedConnect = !(e instanceof PayError) && /reject|denied|refus|cancel|annul|close|4001/i.test(raw);
      this.msg(
        reason === "rejected" || rejectedConnect ? t("bigbang.errRejected")
        : reason === "timeout"     ? t("store.errTimeout")
        : reason === "funds"       ? t("store.errFunds", { n: this.cro(pack.priceCRO) })
        : reason === "no-wallet"   ? t("bigbang.errNoWallet")
        : t("bigbang.errGeneric", { reason: raw.slice(0, 120) || "?" }),
      );
      btns.forEach((b) => (b.disabled = false));
    } finally {
      this.wallet.onLog = null;
      this.wallet.onRequestSent = null;
      this.busy = false;
    }
  }

  /** The transaction has been published but iOS WalletConnect won't foreground the
      wallet for a session request. Show a prominent, tappable link — a real anchor
      to the wallet's deep-link, so the tap is a genuine user gesture iOS honors —
      that brings the wallet up to display the pending confirmation. */
  private showConfirmButton(url: string | null): void {
    const m = this.el.querySelector("#bbsMsg") as HTMLElement | null;
    if (!m) return;
    m.className = "bbsMsg";
    m.innerHTML = `
      <div class="bbsConfirm">
        <div class="bbsConfirmText">${t("store.awaitingConfirm")}</div>
        ${url
          ? `<a class="bbsConfirmBtn" id="bbsOpenWallet" href="${url}" rel="noopener">${t("store.openWallet")}</a>`
          : `<div class="bbsSwitchManual">${t("store.openWalletManual")}</div>`}
      </div>`;
    try { m.scrollIntoView({ block: "center", behavior: "smooth" }); } catch { /* ignore */ }
  }

  /** Not on Cronos: offer a one-tap switch, and explain how to do it manually if
      the wallet can't switch programmatically. Never a dead-end error. */
  private showSwitch(pack: BigBangPack): void {
    this.busy = false;
    this.el.querySelectorAll<HTMLButtonElement>(".bbsBuy").forEach((b) => (b.disabled = false));
    const m = this.el.querySelector("#bbsMsg") as HTMLElement | null;
    if (!m) return;
    m.className = "bbsMsg";
    m.innerHTML = `
      <div class="bbsSwitch">
        <div class="bbsSwitchTitle">⚠ ${t("store.switchTitle")}</div>
        <button class="bbsSwitchBtn" id="bbsSwitchBtn">${t("store.switchBtn")}</button>
        <div class="bbsSwitchManual">${t("store.switchManual")}</div>
      </div>`;
    const btn = m.querySelector("#bbsSwitchBtn") as HTMLButtonElement;
    btn.addEventListener("click", async () => {
      btn.disabled = true; btn.textContent = t("store.switching");
      const prep = await this.wallet.prepareCronos();
      if (prep === "ok") { this.buy(pack.id); }               // on Cronos → retry the purchase
      else if (prep === "reconnect") { this.showBrowserHint(pack); } // session lacks Cronos → browser path
      else { btn.disabled = false; btn.textContent = t("store.switchBtn"); } // manual steps stay
    });
  }

  /** The active WalletConnect session doesn't include Cronos, so a CRO payment
      can't be routed. The RELIABLE path (shown first) is to open the game inside
      the wallet's own in-app browser — an injected provider that prompts natively
      with no relay. A small secondary "reconnect" option remains for wallets that
      CAN grant Cronos on a fresh pairing (Crypto.com Onchain over WC never does). */
  private showBrowserHint(pack?: BigBangPack): void {
    this.busy = false;
    this.el.querySelectorAll<HTMLButtonElement>(".bbsBuy").forEach((b) => (b.disabled = false));
    const m = this.el.querySelector("#bbsMsg") as HTMLElement | null;
    if (!m) return;
    const link = window.location.origin;
    m.className = "bbsMsg";
    m.innerHTML = `
      <div class="bbsSwitch">
        <div class="bbsSwitchTitle">⚠ ${t("store.noCronosTitle")}</div>
        <div class="bbsSwitchManual">${t("store.noCronosMsg")}</div>
        ${pack ? `<button class="bbsSwitchBtn" id="bbsPayDirect">${t("store.payDirect")}</button>` : ""}
        <div class="bbsPayOr">${t("store.payOr")}</div>
        <button class="bbsReconnectLink" id="bbsCopyLink">${t("store.copyLink")}</button>
        <div class="bbsSwitchManual" style="opacity:.7">${link.replace(/^https?:\/\//, "")}</div>
        ${pack ? `<button class="bbsReconnectLink" id="bbsReconnectBtn">${t("store.reconnectBtn")}</button>` : ""}
      </div>`;
    const pay = m.querySelector("#bbsPayDirect") as HTMLButtonElement | null;
    if (pay && pack) pay.addEventListener("click", () => this.showManualPay(pack));
    const copy = m.querySelector("#bbsCopyLink") as HTMLButtonElement;
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(link); copy.textContent = t("store.copied"); }
      catch { copy.textContent = link.replace(/^https?:\/\//, ""); }  // clipboard blocked → reveal for manual copy
    });
    const re = m.querySelector("#bbsReconnectBtn") as HTMLButtonElement | null;
    if (re && pack) re.addEventListener("click", () => this.attemptReconnect(pack, re));
  }

  /** Wallet-agnostic payment: the player sends CRO to the treasury from ANY wallet
      (a normal transfer — no WalletConnect), pastes the transaction hash, and we
      confirm it on-chain via public Cronos RPC, then credit the Big Bangs. This is
      the reliable path when a wallet won't route Cronos over WalletConnect. */
  private showManualPay(pack: BigBangPack): void {
    this.busy = false;
    const m = this.el.querySelector("#bbsMsg") as HTMLElement | null;
    if (!m) return;
    const addr = BIG_BANG_RECIPIENT;
    m.className = "bbsMsg";
    m.innerHTML = `
      <div class="bbsPay">
        <div class="bbsSwitchTitle">${t("store.payDirectTitle")}</div>
        <div class="bbsPayStep">${t("store.payStep1", { n: this.cro(pack.priceCRO) })}</div>
        <div class="bbsPayAddr" id="bbsPayAddr">${addr}</div>
        <button class="bbsSwitchBtn" id="bbsPayCopyAddr">${t("store.payCopyAddr")}</button>
        <div class="bbsPayStep">${t("store.payStep2")}</div>
        <input class="bbsPayInput" id="bbsPayHash" inputmode="text" autocomplete="off"
               autocapitalize="off" spellcheck="false" placeholder="${t("store.payHashPlaceholder")}" />
        <button class="bbsConfirmBtn" id="bbsPayVerify">${t("store.payVerify")}</button>
        <div class="bbsPayMsg" id="bbsPayMsg"></div>
        <button class="bbsReconnectLink" id="bbsPayBack">${t("common.cancel")}</button>
      </div>`;
    try { m.scrollIntoView({ block: "center", behavior: "smooth" }); } catch { /* ignore */ }

    const copyAddr = m.querySelector("#bbsPayCopyAddr") as HTMLButtonElement;
    copyAddr.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(addr); copyAddr.textContent = t("store.payAddrCopied"); }
      catch { /* selection fallback not reliable on iOS — address is visible above */ }
    });
    (m.querySelector("#bbsPayBack") as HTMLButtonElement).addEventListener("click", () => this.showBrowserHint(pack));

    const input = m.querySelector("#bbsPayHash") as HTMLInputElement;
    const verify = m.querySelector("#bbsPayVerify") as HTMLButtonElement;
    const payMsg = m.querySelector("#bbsPayMsg") as HTMLElement;
    const setMsg = (text: string, ok = false) => { payMsg.textContent = text; payMsg.className = `bbsPayMsg ${ok ? "ok" : "err"}`; };

    verify.addEventListener("click", async () => {
      const hash = input.value.trim();
      if (isTxUsed(hash)) { setMsg(t("store.payErrUsed")); return; }
      verify.disabled = true; verify.textContent = t("store.payVerifying");
      this.resetLog();
      this.logStep(`▶ verify payment ${pack.id} — ${pack.priceCRO} CRO`);
      this.logStep(`· hash ${hash.slice(0, 12)}…`);
      const res = await verifyPayment(hash, pack.priceCRO);
      this.logStep(`· verifyPayment → ${res.ok ? "ok" : res.reason}${res.ok ? "" : " " + (res.detail ?? "")}`);
      verify.disabled = false; verify.textContent = t("store.payVerify");
      if (res.ok) {
        markTxUsed(hash);
        this.credits.addPack(pack, hash, Date.now());
        this.logStep(`✓ purchase credited: +${pack.credits} Big Bangs`);
        this.onChange();
        const keep = this.logLines.slice();
        this.render();
        this.renderLog(keep);
        this.msg(t("store.purchased", { n: pack.credits }), true);
        return;
      }
      const key = ({
        format: "store.payErrFormat", "not-found": "store.payErrNotFound", pending: "store.payErrPending",
        failed: "store.payErrFailed", "wrong-recipient": "store.payErrRecipient", "wrong-chain": "store.payErrChain",
        underpaid: "store.payErrUnderpaid", network: "store.payErrNetwork",
      } as const)[res.reason];
      setMsg(t(key, { n: this.cro(pack.priceCRO) }));
    });
  }

  /** Secondary path: tear down and re-pair a fresh WalletConnect session, then
      retry — only helps wallets that grant Cronos on a new pairing. */
  private async attemptReconnect(pack: BigBangPack, btn: HTMLButtonElement): Promise<void> {
    btn.disabled = true; btn.textContent = t("store.switching");
    this.wallet.onLog = (m) => this.logStep(m);
    try {
      this.logStep("· reconnect: re-pairing a fresh session…");
      await this.wallet.reconnect();
      const prep = await this.wallet.prepareCronos();
      this.logStep(`· post-reconnect prepareCronos → ${prep}`);
      this.wallet.onLog = null;
      if (prep === "ok") { this.busy = false; this.buy(pack.id); }
      else { this.showBrowserHint(pack); }   // still no Cronos → stay on the reliable browser path
    } catch (e) {
      this.logStep(`✗ reconnect: ${(e instanceof Error ? e.message : String(e)).slice(0, 100)}`);
      this.wallet.onLog = null;
      btn.disabled = false; btn.textContent = t("store.reconnectBtn");
    }
  }

  private injectStyles(): void {
    if (document.getElementById("bbsStyles")) return;
    const s = document.createElement("style");
    s.id = "bbsStyles";
    s.textContent = `
    .bbsOverlay{position:fixed;inset:0;z-index:32;display:flex;align-items:flex-end;justify-content:center;
      background:rgba(3,4,14,.7);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);animation:bbsFade .2s ease}
    @keyframes bbsFade{from{opacity:0}to{opacity:1}}
    .bbsSheet{width:min(100vw,560px);max-height:94vh;overflow-y:auto;-webkit-overflow-scrolling:touch;
      padding:calc(env(safe-area-inset-top) + 16px) 16px calc(env(safe-area-inset-bottom) + 18px);
      background:radial-gradient(130% 60% at 50% -6%, rgba(150,90,255,.28), transparent 60%),
        linear-gradient(180deg,#0b0a20 0%,#08071a 62%,#050414 100%);
      border-radius:24px 24px 0 0;border:1px solid rgba(150,170,255,.18);border-bottom:none;
      box-shadow:0 -20px 60px rgba(0,0,0,.6);animation:bbsUp .28s cubic-bezier(.2,.8,.2,1)}
    @keyframes bbsUp{from{transform:translateY(40px);opacity:.4}to{transform:translateY(0);opacity:1}}
    .bbsHead{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}
    .bbsTitle{font-size:15px;font-weight:800;letter-spacing:2px;
      background:linear-gradient(180deg,#fff,#d8c8ff 60%,#9b7bff);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
    .bbsBal{font-size:12px;font-weight:800;color:var(--gold);margin-top:3px;letter-spacing:.5px}
    .bbsClose{flex-shrink:0;width:38px;height:38px;border-radius:50%;font-size:15px;color:#dce4ff;cursor:pointer;
      background:rgba(30,38,78,.6);border:1px solid rgba(150,170,255,.28);font-family:inherit}
    .bbsClose:active{transform:scale(.92)}
    .bbsSub{font-size:11px;color:#9aa3c4;letter-spacing:.3px;margin:6px 0 14px;line-height:1.4}
    .bbsCards{display:flex;flex-direction:column;gap:13px}
    .bbsCard{position:relative;border-radius:18px;padding:16px;text-align:center;overflow:hidden;
      background:linear-gradient(180deg,rgba(30,26,64,.6),rgba(16,12,40,.65));
      border:1px solid rgba(150,170,255,.22);box-shadow:0 8px 22px rgba(6,8,24,.5)}
    .bbsCard.bbsBest{border:1.5px solid rgba(245,197,66,.6);
      background:radial-gradient(120% 90% at 50% 0%, rgba(160,110,255,.3), transparent 60%),linear-gradient(180deg,rgba(52,32,96,.65),rgba(20,14,48,.7));
      box-shadow:0 0 34px rgba(150,100,255,.4), inset 0 1px 0 rgba(255,255,255,.1)}
    .bbsRibbon{position:absolute;top:12px;right:-30px;transform:rotate(45deg);width:120px;text-align:center;
      font-size:8.5px;font-weight:800;letter-spacing:1px;color:#241a00;padding:3px 0;
      background:linear-gradient(180deg,#FFE9A8,#F0B429);box-shadow:0 2px 8px rgba(240,180,40,.5)}
    .bbsIcon{font-size:40px;line-height:1;margin-bottom:6px;filter:drop-shadow(0 0 14px rgba(160,120,255,.6))}
    .bbsName{font-size:15px;font-weight:800;letter-spacing:1px;color:#fff}
    .bbsTag{font-size:10px;color:#9aa3c4;margin:2px 0 10px;letter-spacing:.2px}
    .bbsCredits{font-size:20px;font-weight:800;color:#fff}
    .bbsCredits span{font-size:11px;font-weight:700;color:#c9b8ff;letter-spacing:1px;margin-left:2px}
    .bbsRuns{font-size:11px;color:#b7a6e6;font-weight:600;margin-top:2px}
    .bbsPricing{display:flex;align-items:baseline;justify-content:center;gap:10px;margin-top:11px}
    .bbsNormal{font-size:13px;color:#6b74a0;text-decoration:line-through;font-weight:600}
    .bbsPrice{font-size:19px;font-weight:800;color:var(--gold);letter-spacing:.3px}
    .bbsSave{display:inline-block;margin-top:8px;font-size:10px;font-weight:800;letter-spacing:.5px;color:#8dffbe;
      background:rgba(60,200,120,.14);border:1px solid rgba(90,220,150,.36);border-radius:20px;padding:4px 12px}
    .bbsBuy{width:100%;margin-top:13px;font-family:inherit;font-weight:800;font-size:14px;letter-spacing:1px;
      text-transform:uppercase;color:#dfe6ff;padding:14px;border-radius:13px;cursor:pointer;
      background:linear-gradient(180deg,rgba(96,120,230,.85),rgba(60,50,170,.8));border:1px solid rgba(150,170,255,.5);
      box-shadow:0 8px 20px rgba(50,40,140,.4)}
    .bbsBuy.bbsBest{color:#241a00;border:none;background:linear-gradient(180deg,#FFF0BE,#F0B429 60%,#D48E12);
      box-shadow:0 8px 22px rgba(240,180,40,.45)}
    .bbsBuy:active{transform:scale(.98)}
    .bbsBuy:disabled{opacity:.55;filter:grayscale(.3);cursor:default}
    .bbsMsg{text-align:center;font-size:12px;font-weight:700;line-height:1.4;margin-top:14px;min-height:1px;letter-spacing:.2px}
    .bbsMsg.err{color:#ff9db0}
    .bbsMsg.ok{color:#8dffbe}
    .bbsMsg:empty{display:none}
    .bbsSwitch{display:flex;flex-direction:column;align-items:center;gap:10px;margin-top:14px;padding:16px;
      border-radius:16px;background:rgba(255,150,60,.08);border:1px solid rgba(255,150,60,.34)}
    .bbsSwitchTitle{font-size:12.5px;font-weight:800;color:#ffd7a0;letter-spacing:.3px}
    .bbsSwitchBtn{font-family:inherit;font-weight:800;font-size:13px;letter-spacing:1px;text-transform:uppercase;color:#241a00;
      padding:12px 22px;border:none;border-radius:12px;cursor:pointer;
      background:linear-gradient(180deg,#FFF0BE,#F0B429 60%,#D48E12);box-shadow:0 6px 16px rgba(240,180,40,.4)}
    .bbsSwitchBtn:active{transform:scale(.97)}
    .bbsSwitchBtn:disabled{opacity:.6;cursor:default}
    .bbsSwitchManual{font-size:10.5px;font-weight:500;line-height:1.5;color:#c4cbe8;max-width:300px}
    .bbsReconnectLink{margin-top:2px;background:none;border:none;font-family:inherit;font-size:11px;font-weight:600;
      color:#9db0e6;text-decoration:underline;cursor:pointer;padding:4px}
    .bbsReconnectLink:disabled{opacity:.6;cursor:default}
    .bbsPayOr{font-size:9.5px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#7c86ad;margin:4px 0}
    .bbsPay{display:flex;flex-direction:column;align-items:center;gap:10px;margin-top:14px;padding:18px 16px;
      border-radius:16px;background:radial-gradient(120% 100% at 50% 0%, rgba(120,90,255,.22), transparent 65%),rgba(30,26,64,.55);
      border:1px solid rgba(150,170,255,.4)}
    .bbsPayStep{font-size:11.5px;font-weight:700;color:#dbe3ff;line-height:1.45;text-align:center;max-width:320px}
    .bbsPayAddr{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:#ffe6a8;word-break:break-all;
      text-align:center;padding:9px 12px;border-radius:10px;background:rgba(6,10,26,.7);border:1px solid rgba(150,170,255,.28);width:100%;box-sizing:border-box}
    .bbsPayInput{width:100%;box-sizing:border-box;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;
      color:#eaf0ff;padding:13px 12px;border-radius:11px;background:rgba(6,10,26,.8);border:1px solid rgba(150,170,255,.35);outline:none}
    .bbsPayInput:focus{border-color:rgba(150,170,255,.7)}
    .bbsPayMsg{font-size:11px;font-weight:700;line-height:1.4;text-align:center;min-height:1px}
    .bbsPayMsg.err{color:#ff9db0}
    .bbsPayMsg.ok{color:#8dffbe}
    .bbsPayMsg:empty{display:none}
    .bbsConfirm{display:flex;flex-direction:column;align-items:center;gap:12px;margin-top:14px;padding:18px 16px;
      border-radius:16px;background:radial-gradient(120% 100% at 50% 0%, rgba(120,90,255,.25), transparent 65%),rgba(40,30,90,.5);
      border:1px solid rgba(150,170,255,.4)}
    .bbsConfirmText{font-size:12.5px;font-weight:700;color:#dbe3ff;letter-spacing:.2px;text-align:center;line-height:1.4}
    .bbsConfirmBtn{display:block;width:100%;box-sizing:border-box;text-align:center;text-decoration:none;
      font-family:inherit;font-weight:800;font-size:15px;letter-spacing:.6px;color:#fff;padding:16px;border-radius:14px;
      background:linear-gradient(180deg,#6f7bff,#4b3adf 60%,#3a2ad0);border:1px solid rgba(170,185,255,.6);
      box-shadow:0 10px 26px rgba(70,55,200,.5), inset 0 1px 0 rgba(255,255,255,.18);animation:bbsPulse 1.6s ease-in-out infinite}
    .bbsConfirmBtn:active{transform:scale(.98)}
    @keyframes bbsPulse{0%,100%{box-shadow:0 10px 26px rgba(70,55,200,.5), inset 0 1px 0 rgba(255,255,255,.18)}
      50%{box-shadow:0 10px 34px rgba(120,100,255,.85), inset 0 1px 0 rgba(255,255,255,.25)}}
    .bbsLogWrap{margin-top:14px;border-radius:12px;overflow:hidden;border:1px solid rgba(120,140,220,.25);background:rgba(6,10,26,.7)}
    .bbsLogHead{font-size:9.5px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:#8ea2d8;
      padding:8px 12px;background:rgba(20,28,60,.55);border-bottom:1px solid rgba(120,140,220,.18)}
    .bbsLog{margin:0;padding:10px 12px;color:#9fe6c8;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
      font-size:9.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word;text-align:left;max-height:190px;overflow-y:auto}
    @media (prefers-reduced-motion: reduce){.bbsOverlay,.bbsSheet{animation:none}}
    `;
    document.head.appendChild(s);
  }
}
