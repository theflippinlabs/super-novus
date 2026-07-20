/* LeaderboardPage — the dedicated competition hub. The home screen only sells the
   game; everything about "how am I doing vs everyone" lives here:
   a hero, weekly/monthly tabs, the live CRO reward for the active period, a top-3
   podium, and the complete scrollable ranking (rank · avatar · nickname · distance
   · Star Dust · score). Instant search, the current player highlighted, and a
   floating "Your position #N → tap to scroll" card when they're ranked below the
   fold. Identities are always avatar + nickname — never a wallet address. */
import { Leaderboard, type BoardRow } from "../net/Leaderboard";
import { WalletManager } from "../net/WalletManager";
import { Profile } from "../net/Profile";
import { PrizePool, type PoolInfo } from "../net/PrizePool";
import type { LeaderboardPeriod } from "../config";
import { generateAvatar } from "./Avatar";
import { displayName, silhouetteDataUri } from "./Identity";
import { i18n, t } from "../i18n";

const BCP47: Record<string, string> = { fr: "fr-FR", en: "en-US", ko: "ko-KR" };
const escHtml = (s: string): string => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] || c));

export class LeaderboardPage {
  private el: HTMLElement;
  private period: LeaderboardPeriod = "weekly";
  private rows: BoardRow[] = [];
  private query = "";
  private pool: PoolInfo | null = null;

  constructor(
    private leaderboard: Leaderboard,
    private wallet: WalletManager,
    private profile: Profile,
    private prizePool: PrizePool,
  ) {
    this.injectStyles();
    const el = document.createElement("div");
    el.id = "lbPage";
    el.className = "lbpOverlay";
    el.style.display = "none";
    document.body.appendChild(el);
    this.el = el;
    i18n.onChange(() => { if (this.isOpen()) this.render(); });
  }

  isOpen(): boolean { return this.el.style.display !== "none"; }
  close(): void {
    // Slide the page out to the right, then unmount (smooth page navigation).
    this.el.classList.add("lbpClosing");
    const done = () => { this.el.style.display = "none"; this.el.classList.remove("lbpClosing"); this.el.innerHTML = ""; };
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { done(); return; }
    window.setTimeout(done, 240);
  }

  private locale(): string { return BCP47[i18n.get()] ?? "en-US"; }
  private num(n: number): string { return Math.floor(n || 0).toLocaleString(this.locale()); }
  private cro(n: number): string { return n.toLocaleString(this.locale(), { maximumFractionDigits: n < 100 ? 2 : 0 }); }

  /** Identity used for the current player's own row (their chosen name/avatar). */
  private meIdentity(): { wallet: string; nickname: string | null; avatar: string | null } | null {
    const addr = this.wallet.getAddress();
    if (!addr) return null;
    const id = this.profile.cachedIdentity(addr);
    return { wallet: addr.toLowerCase(), nickname: id.nickname, avatar: id.avatar };
  }

  async open(period: LeaderboardPeriod): Promise<void> {
    this.period = period;
    this.query = "";
    this.pool = this.prizePool.staticPool();   // instant guaranteed figures
    this.el.style.display = "flex";
    this.renderShell();
    await this.load();
    // Upgrade to the live pool (community bonus) in the background.
    this.prizePool.compute().then((p) => { this.pool = p; this.renderPrize(); }).catch(() => { /* keep static */ });
  }

  private async load(): Promise<void> {
    if (!this.leaderboard.available) { this.rows = []; this.renderPodium(); this.renderList(); return; }
    try { this.rows = await this.leaderboard.top(this.period, 100); }
    catch { this.rows = []; }
    this.renderPodium();
    this.renderList();
  }

  /** Full re-render (language change while open). */
  private render(): void { this.renderShell(); this.renderPodium(); this.renderList(); this.renderPrize(); }

  private renderShell(): void {
    this.el.innerHTML = `
      <div class="lbpSheet">
        <div class="lbpFixed">
          <div class="lbpHead">
            <button class="lbpBack" id="lbpClose" aria-label="${t("common.close")}">‹</button>
            <div class="lbpTitleWrap">
              <div class="lbpTitle">🏆 ${t("lb.title")}</div>
              <div class="lbpHeroSub">${t("lb.heroSub")}</div>
            </div>
          </div>
          <div class="lbpTabs">
            <button class="lbpTab${this.period === "weekly" ? " on" : ""}" data-period="weekly">${t("menu.tabWeekly")}</button>
            <button class="lbpTab${this.period === "monthly" ? " on" : ""}" data-period="monthly">${t("menu.tabMonthly")}</button>
          </div>
          <div class="lbpPrize" id="lbpPrize"></div>
          <div class="podium" id="lbpPodium"></div>
          <div class="lbpSearchWrap">
            <span class="lbpSearchIcon">⌕</span>
            <input id="lbpSearch" class="lbpSearch" type="text" inputmode="search"
              placeholder="${t("lb.searchPlaceholder")}" autocomplete="off" value="${escHtml(this.query)}">
          </div>
          <div class="lbpCols">
            <span class="c-rank">#</span><span class="c-name">${t("lb.colPlayer")}</span>
            <span class="c-dd">${t("lb.colDist")}</span><span class="c-dd">${t("lb.colDust")}</span>
            <span class="c-score">${t("lb.colScore")}</span>
          </div>
        </div>
        <div class="lbpList" id="lbpList"></div>
        <div class="lbpMeFloat" id="lbpMeFloat" style="display:none"></div>
      </div>`;
    (this.el.querySelector("#lbpClose") as HTMLElement).addEventListener("click", () => this.close());
    for (const tab of this.el.querySelectorAll<HTMLElement>(".lbpTab"))
      tab.addEventListener("click", () => {
        const p = tab.dataset.period as LeaderboardPeriod;
        if (p && p !== this.period) { this.period = p; this.pool = this.prizePool.staticPool(); this.renderShell(); this.load();
          this.prizePool.compute().then((pl) => { this.pool = pl; this.renderPrize(); }).catch(() => {}); }
      });
    const search = this.el.querySelector("#lbpSearch") as HTMLInputElement;
    search.addEventListener("input", () => { this.query = search.value; this.renderList(); });
    this.renderPrize();
  }

  /** Live CRO reward for the active period. */
  private renderPrize(): void {
    const el = this.el.querySelector("#lbpPrize") as HTMLElement | null;
    if (!el) return;
    const p = this.pool;
    if (!p) { el.innerHTML = `🏆 <span>${t("prize.loading")}</span>`; return; }
    if (this.period === "weekly") {
      const eq = p.weeklyCRO !== null ? ` (≈${this.cro(p.weeklyCRO)} CRO)` : "";
      el.innerHTML = `🏆 <b>${t("prize.weeklyMain", { usd: p.weeklyUsd })}</b> <span>${t("prize.paidInCro")}${eq}</span>`;
    } else {
      const gEq = p.monthlyGuaranteedCRO !== null ? ` (≈${this.cro(p.monthlyGuaranteedCRO)} CRO)` : "";
      const bonus = this.cro(p.bonusCRO);
      el.innerHTML = `🏆 <b>${t("prize.total", { usd: p.monthlyUsd, bonus })}</b> <span>${t("prize.guaranteed", { usd: p.monthlyUsd })}${gEq}</span>`;
    }
  }

  /** Top-3 podium (🥇 centre, 🥈 left, 🥉 right). */
  private renderPodium(): void {
    const host = this.el.querySelector("#lbpPodium") as HTMLElement | null;
    if (!host) return;
    if (!this.rows.length) {
      host.innerHTML = `<div class="podEmpty"><span class="podEmojiTrophy">🏆</span><span>${this.leaderboard.available ? t("lb.empty") : t("lb.soon")}</span></div>`;
      return;
    }
    const me = this.meIdentity();
    const loc = this.locale();
    const slots: Array<{ row: BoardRow | undefined; place: 1 | 2 | 3 }> = [
      { row: this.rows[1], place: 2 }, { row: this.rows[0], place: 1 }, { row: this.rows[2], place: 3 },
    ];
    const medal = (p: number) => (p === 1 ? "🥇" : p === 2 ? "🥈" : "🥉");
    const cell = ({ row, place }: { row: BoardRow | undefined; place: 1 | 2 | 3 }): string => {
      const filled = Boolean(row);
      const mine = Boolean(row && me && row.wallet.toLowerCase() === me.wallet);
      const name = row ? (mine ? displayName(row.wallet, me!.nickname) : displayName(row.wallet, row.nickname)) : "—";
      const avatar = row ? ((mine && me!.avatar) || row.avatar || generateAvatar(row.wallet, 72)) : silhouetteDataUri("#3f4a72");
      const score = row ? Math.floor(row.score).toLocaleString(loc) : "—";
      return `
        <div class="pod pod${place}${filled ? "" : " empty"}${mine ? " me" : ""}">
          <div class="podTop">
            ${place === 1 ? `<div class="podCrown">🏆</div>` : ""}
            <div class="podAvatarWrap"><img class="podAvatar" src="${escHtml(avatar)}" alt="" loading="lazy"><span class="podMedal">${medal(place)}</span></div>
            <div class="podName">${escHtml(name)}</div>
            <div class="podScore">${score}</div>
          </div>
          <div class="podBase"><span class="podRank">${place}</span></div>
        </div>`;
    };
    host.innerHTML = slots.map(cell).join("");
  }

  private rowHtml(r: BoardRow, rank: number, me: ReturnType<LeaderboardPage["meIdentity"]>, idAttr = ""): string {
    const mine = Boolean(me && r.wallet.toLowerCase() === me.wallet);
    const name = mine ? displayName(r.wallet, me!.nickname) : displayName(r.wallet, r.nickname);
    const avatar = (mine && me!.avatar) || r.avatar || generateAvatar(r.wallet, 44);
    const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "";
    const loc = this.locale();
    return `
      <div class="lbpRow${mine ? " me" : ""}"${idAttr} style="animation-delay:${Math.min(rank * 20, 360)}ms">
        <span class="c-rank">${medal || rank}</span>
        <span class="c-name">
          <img class="lbpAv" src="${escHtml(avatar)}" alt="" loading="lazy">
          <span class="lbpNm">${escHtml(name)}${mine ? ` <em>${t("lb.you")}</em>` : ""}</span>
        </span>
        <span class="c-dd">${this.num(r.dist)}</span>
        <span class="c-dd">★ ${this.num(r.dust)}</span>
        <span class="c-score">${(r.score || 0).toLocaleString(loc)}</span>
      </div>`;
  }

  private renderList(): void {
    const list = this.el.querySelector("#lbpList") as HTMLElement;
    const float = this.el.querySelector("#lbpMeFloat") as HTMLElement | null;
    if (!list) return;
    if (float) { float.style.display = "none"; float.innerHTML = ""; }
    if (!this.leaderboard.available) { list.innerHTML = `<div class="lbpEmpty">${t("lb.soon")}</div>`; return; }
    if (!this.rows.length) { list.innerHTML = `<div class="lbpEmpty">${t("lb.empty")}</div>`; return; }

    const me = this.meIdentity();
    const q = this.query.trim().toLowerCase();
    const ranked = this.rows.map((r, i) => ({ r, rank: i + 1 }));
    const myIdx = me ? ranked.findIndex(({ r }) => r.wallet.toLowerCase() === me.wallet) : -1;

    const shown = q
      ? ranked.filter(({ r }) => displayName(r.wallet, r.nickname).toLowerCase().includes(q))
      : ranked;
    if (!shown.length) { list.innerHTML = `<div class="lbpEmpty">${t("lb.noMatch")}</div>`; return; }
    list.innerHTML = shown.map(({ r, rank }) => this.rowHtml(r, rank, me, myIdx >= 0 && rank === myIdx + 1 ? ' id="lbpMeRow"' : "")).join("");

    // Floating "Your position" card — only when the player is ranked below the fold
    // and not filtering. Tapping scrolls their row into view.
    if (float && me && !q && myIdx >= 8) {
      const rank = myIdx + 1;
      float.innerHTML = `
        <span class="lbpMeFloatL">${t("lb.yourPosition")}</span>
        <span class="lbpMeFloatR">#${rank}</span>
        <span class="lbpMeFloatGo">${t("lb.tapToScroll")} ↑</span>`;
      float.style.display = "flex";
      float.onclick = () => this.el.querySelector("#lbpMeRow")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  private injectStyles(): void {
    if (document.getElementById("lbpStyles")) return;
    const s = document.createElement("style");
    s.id = "lbpStyles";
    s.textContent = `
    .lbpOverlay{position:fixed;inset:0;z-index:30;display:flex;justify-content:center;overflow:hidden;
      background:radial-gradient(120% 45% at 50% -6%, rgba(120,90,220,.28), transparent 60%),
        linear-gradient(180deg,#0b0a20 0%,#08071a 60%,#050414 100%);
      background-color:#050414;animation:lbpSlideIn .3s cubic-bezier(.2,.8,.2,1)}
    .lbpOverlay.lbpClosing{animation:lbpSlideOut .24s ease forwards}
    @keyframes lbpSlideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}
    @keyframes lbpSlideOut{from{transform:translateX(0)}to{transform:translateX(100%)}}
    .lbpSheet{position:relative;width:min(100vw,560px);height:100%;display:flex;flex-direction:column;
      padding:calc(env(safe-area-inset-top) + 10px) 16px calc(env(safe-area-inset-bottom) + 12px)}
    .lbpFixed{flex-shrink:0}
    .lbpHead{display:flex;align-items:center;gap:10px;margin-bottom:12px}
    .lbpTitle{font-size:16px;font-weight:800;letter-spacing:1.5px;
      background:linear-gradient(180deg,#fff,#ffe6a8 60%,#F0B429);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
    .lbpHeroSub{font-size:11px;color:#9aa3c4;letter-spacing:.2px;margin-top:3px;line-height:1.4;max-width:300px}
    .lbpBack{flex-shrink:0;width:40px;height:40px;border-radius:12px;font-size:26px;line-height:1;color:#dce4ff;cursor:pointer;
      display:flex;align-items:center;justify-content:center;padding-bottom:3px;
      background:rgba(30,38,78,.55);border:1px solid rgba(150,170,255,.24);font-family:inherit}
    .lbpBack:active{transform:scale(.92)}
    .lbpTabs{display:flex;gap:8px;margin-bottom:10px}
    .lbpTab{flex:1;font-family:inherit;font-size:11px;letter-spacing:1.2px;font-weight:800;padding:11px 4px;
      color:#9aa6d4;background:rgba(28,36,74,.5);border:1px solid rgba(150,170,255,.16);border-radius:11px;
      cursor:pointer;text-transform:uppercase;transition:color .2s,background .2s}
    .lbpTab.on{color:#241a00;background:linear-gradient(180deg,#FFEDB0,#F0B429 60%,#D89B1E);border-color:transparent}
    .lbpPrize{font-size:10.5px;letter-spacing:.3px;color:var(--gold);font-weight:700;text-align:center;line-height:1.5;margin-bottom:8px}
    .lbpPrize span{color:#c8cfe8;font-weight:600}
    #lbpPodium{margin:2px 2px 8px}
    .lbpSearchWrap{position:relative;margin-bottom:11px}
    .lbpSearchIcon{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:#6b74a0;font-size:16px;pointer-events:none}
    .lbpSearch{width:100%;font-family:inherit;font-size:13px;letter-spacing:1px;color:#fff;font-weight:600;
      padding:12px 14px 12px 38px;background:rgba(10,14,36,.7);border:1px solid rgba(150,170,255,.24);border-radius:12px;outline:none}
    .lbpSearch::placeholder{color:#5a6288}
    .lbpSearch:focus{border-color:rgba(176,158,255,.6)}
    .lbpCols{display:grid;grid-template-columns:30px 1fr 50px 46px 66px;gap:4px;align-items:center;
      padding:0 8px 7px;font-size:8.5px;letter-spacing:1.5px;color:#5a6288;font-weight:700;text-transform:uppercase}
    .lbpCols .c-dd,.lbpCols .c-score{text-align:right}
    .lbpList{overflow-y:auto;-webkit-overflow-scrolling:touch;scroll-behavior:smooth;flex:1 1 auto;min-height:0;
      display:flex;flex-direction:column;gap:4px;padding-right:2px}
    .lbpRow{display:grid;grid-template-columns:30px 1fr 50px 46px 66px;gap:4px;align-items:center;
      padding:8px;border-radius:12px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.05);
      font-variant-numeric:tabular-nums;opacity:0;animation:lbpRowIn .3s ease forwards}
    @keyframes lbpRowIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    .lbpRow .c-rank{font-weight:800;color:#aeb6da;font-size:13px;text-align:center}
    .lbpRow .c-name{display:flex;align-items:center;gap:9px;min-width:0}
    .lbpAv{width:30px;height:30px;border-radius:50%;flex-shrink:0;object-fit:cover;background:#0a0e24;border:1px solid rgba(150,170,255,.35)}
    .lbpNm{font-weight:700;font-size:13px;letter-spacing:.3px;color:#eaf0ff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .lbpNm em{font-style:normal;font-size:8.5px;letter-spacing:1px;color:#241a00;background:var(--gold);padding:1px 5px;border-radius:6px;margin-left:5px;font-weight:800;vertical-align:middle}
    .lbpRow .c-dd{text-align:right;font-size:11px;color:#9aa3c4;font-weight:600}
    .lbpRow .c-score{text-align:right;font-size:14px;font-weight:800;color:var(--gold)}
    .lbpRow.me{background:rgba(245,197,66,.12);border-color:rgba(245,197,66,.4)}
    .lbpRow.me .lbpNm{color:#ffe9a0}
    .lbpMeFloat{display:flex;align-items:center;gap:10px;margin-top:10px;padding:12px 14px;cursor:pointer;
      border-radius:14px;background:linear-gradient(180deg,rgba(245,197,66,.2),rgba(216,155,30,.16));
      border:1px solid rgba(245,197,66,.5);box-shadow:0 -6px 22px rgba(0,0,0,.4)}
    .lbpMeFloat:active{transform:scale(.99)}
    .lbpMeFloatL{font-size:11px;font-weight:700;letter-spacing:.5px;color:#ffe9a0;text-transform:uppercase}
    .lbpMeFloatR{font-size:18px;font-weight:800;color:#fff}
    .lbpMeFloatGo{margin-left:auto;font-size:10px;font-weight:700;letter-spacing:.5px;color:#e7d6a0}
    .lbpEmpty{text-align:center;color:#5a6288;font-size:12px;letter-spacing:1px;padding:36px 0}
    @media (prefers-reduced-motion: reduce){.lbpRow,.lbpSheet,.lbpOverlay{animation:none;opacity:1}}
    `;
    document.head.appendChild(s);
  }
}
