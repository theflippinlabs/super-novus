/* BigBangStore — buy Big Bang Packs in advance ("fuel for future missions").
   A premium full-screen sheet with the three packs as cards; Supernova is
   highlighted as best value. Buying triggers ONE CRO payment (WalletConnect);
   on success the credits are added to the player's balance and future revives
   are instant with no wallet. Fails soft with a precise, localized reason. */
import { WalletManager, PayError } from "../net/WalletManager";
import { BigBangCredits } from "../net/BigBangCredits";
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
      </div>`;
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

  private async buy(packId: BigBangPack["id"]): Promise<void> {
    if (this.busy) return;
    const pack = BIG_BANG_PACKS.find((p) => p.id === packId);
    if (!pack) return;
    this.busy = true;
    const btns = this.el.querySelectorAll<HTMLButtonElement>(".bbsBuy");
    btns.forEach((b) => (b.disabled = true));
    this.msg(t("store.processing"), true);
    try {
      // Connect on demand (explicit user action — no silent deep link).
      if (!this.wallet.getAddress()) await this.wallet.connect();
      // A session paired before Cronos was required is scoped to another chain, so
      // the wallet silently drops a Cronos transaction (no prompt appears). Force a
      // one-time reconnect so the payment actually surfaces in the wallet.
      if (!this.wallet.hasCronosSession()) { this.showReconnect(pack); return; }
      // Make sure we're on Cronos BEFORE paying. If we can't switch automatically,
      // show a Switch button + manual steps rather than a dead-end error.
      if (!(await this.wallet.ensureCronos())) { this.showSwitch(pack); return; }
      const txHash = await this.wallet.payCRO(BIG_BANG_RECIPIENT, pack.priceCRO);
      this.credits.addPack(pack, txHash, Date.now());
      this.onChange();
      this.render();   // reflect the new balance
      this.msg(t("store.purchased", { n: pack.credits }), true);
    } catch (e) {
      const reason = e instanceof PayError ? e.reason : "failed";
      if (reason === "wrong-chain") { this.showSwitch(pack); return; }
      const raw = e instanceof Error ? e.message : String(e ?? "");
      const rejectedConnect = !(e instanceof PayError) && /reject|denied|refus|cancel|annul|close|4001/i.test(raw);
      this.msg(
        reason === "rejected" || rejectedConnect ? t("bigbang.errRejected")
        : reason === "funds"       ? t("store.errFunds", { n: this.cro(pack.priceCRO) })
        : reason === "no-wallet"   ? t("bigbang.errNoWallet")
        : t("bigbang.errGeneric", { reason: raw.slice(0, 120) || "?" }),
      );
      btns.forEach((b) => (b.disabled = false));
    } finally {
      this.busy = false;
    }
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
      const ok = await this.wallet.ensureCronos();
      if (ok) { this.buy(pack.id); }                 // switched → retry the purchase
      else { btn.disabled = false; btn.textContent = t("store.switchBtn"); } // manual steps stay
    });
  }

  /** The wallet session predates Cronos support (payments would be dropped with no
      prompt). Offer a one-tap reconnect that pairs a fresh, Cronos-scoped session. */
  private showReconnect(pack: BigBangPack): void {
    this.busy = false;
    this.el.querySelectorAll<HTMLButtonElement>(".bbsBuy").forEach((b) => (b.disabled = false));
    const m = this.el.querySelector("#bbsMsg") as HTMLElement | null;
    if (!m) return;
    m.className = "bbsMsg";
    m.innerHTML = `
      <div class="bbsSwitch">
        <div class="bbsSwitchTitle">⚠ ${t("store.reconnectTitle")}</div>
        <button class="bbsSwitchBtn" id="bbsReconnectBtn">${t("store.reconnectBtn")}</button>
        <div class="bbsSwitchManual">${t("store.reconnectMsg")}</div>
      </div>`;
    const btn = m.querySelector("#bbsReconnectBtn") as HTMLButtonElement;
    btn.addEventListener("click", async () => {
      btn.disabled = true; btn.textContent = t("store.switching");
      try { await this.wallet.reconnect(); this.buy(pack.id); }   // fresh Cronos session → retry
      catch { btn.disabled = false; btn.textContent = t("store.reconnectBtn"); }
    });
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
    @media (prefers-reduced-motion: reduce){.bbsOverlay,.bbsSheet{animation:none}}
    `;
    document.head.appendChild(s);
  }
}
