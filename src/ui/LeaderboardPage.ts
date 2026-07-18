/* LeaderboardPage — the full-screen competitive ranking, opened by tapping the
   home-screen podium. Complete standings with avatar + nickname (never a wallet
   address), score, distance and Star Dust, the current player's row highlighted
   and pinned, live search, smooth scrolling and animated row entrance.
   Reads the same Supabase-backed board as the podium; fails soft when the online
   leaderboard isn't configured. Frontend-only identities (deterministic name +
   avatar) so no blockchain data ever surfaces. */
import { Leaderboard, type BoardRow } from "../net/Leaderboard";
import { WalletManager } from "../net/WalletManager";
import { Profile } from "../net/Profile";
import type { LeaderboardPeriod } from "../config";
import { generateAvatar } from "./Avatar";
import { displayName } from "./Identity";
import { i18n, t } from "../i18n";

const BCP47: Record<string, string> = { fr: "fr-FR", en: "en-US", ko: "ko-KR" };
const escHtml = (s: string): string => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] || c));

export class LeaderboardPage {
  private el: HTMLElement;
  private period: LeaderboardPeriod = "weekly";
  private rows: BoardRow[] = [];
  private query = "";

  constructor(private leaderboard: Leaderboard, private wallet: WalletManager, private profile: Profile) {
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
  close(): void { this.el.style.display = "none"; this.el.innerHTML = ""; }

  private locale(): string { return BCP47[i18n.get()] ?? "en-US"; }
  private num(n: number): string { return Math.floor(n || 0).toLocaleString(this.locale()); }

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
    this.el.style.display = "flex";
    this.renderShell();
    await this.load();
  }

  private async load(): Promise<void> {
    if (!this.leaderboard.available) { this.rows = []; this.renderList(); return; }
    try {
      this.rows = await this.leaderboard.top(this.period, 100);
    } catch { this.rows = []; }
    this.renderList();
  }

  /** Full re-render (used on language change while open). */
  private render(): void { this.renderShell(); this.renderList(); }

  private renderShell(): void {
    this.el.innerHTML = `
      <div class="lbpSheet">
        <div class="lbpHead">
          <div class="lbpTitle">${t("lb.title")}</div>
          <button class="lbpClose" id="lbpClose" aria-label="${t("common.close")}">✕</button>
        </div>
        <div class="lbpTabs">
          <button class="lbpTab${this.period === "weekly" ? " on" : ""}" data-period="weekly">${t("menu.tabWeekly")}</button>
          <button class="lbpTab${this.period === "monthly" ? " on" : ""}" data-period="monthly">${t("menu.tabMonthly")}</button>
        </div>
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
        <div class="lbpList" id="lbpList"></div>
      </div>`;
    (this.el.querySelector("#lbpClose") as HTMLElement).addEventListener("click", () => this.close());
    this.el.addEventListener("click", (e) => { if (e.target === this.el) this.close(); });
    for (const tab of this.el.querySelectorAll<HTMLElement>(".lbpTab"))
      tab.addEventListener("click", () => {
        const p = tab.dataset.period as LeaderboardPeriod;
        if (p && p !== this.period) { this.period = p; this.renderShell(); this.load(); }
      });
    const search = this.el.querySelector("#lbpSearch") as HTMLInputElement;
    search.addEventListener("input", () => { this.query = search.value; this.renderList(); });
  }

  private renderList(): void {
    const list = this.el.querySelector("#lbpList") as HTMLElement;
    if (!list) return;
    // Clear any previous pinned "me" footer before re-rendering (e.g. on search).
    this.el.querySelectorAll(".lbpMeFoot").forEach((f) => f.remove());
    if (!this.leaderboard.available) { list.innerHTML = `<div class="lbpEmpty">${t("lb.soon")}</div>`; return; }
    if (!this.rows.length) { list.innerHTML = `<div class="lbpEmpty">${t("lb.empty")}</div>`; return; }

    const me = this.meIdentity();
    const q = this.query.trim().toLowerCase();
    const loc = this.locale();

    const rowHtml = (r: BoardRow, rank: number): string => {
      const mine = me && r.wallet.toLowerCase() === me.wallet;
      const name = mine ? displayName(r.wallet, me!.nickname) : displayName(r.wallet, r.nickname);
      const avatar = (mine && me!.avatar) || r.avatar || generateAvatar(r.wallet, 44);
      const medal = rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "";
      return `
        <div class="lbpRow${mine ? " me" : ""}" style="animation-delay:${Math.min(rank * 22, 400)}ms">
          <span class="c-rank">${medal || rank}</span>
          <span class="c-name">
            <img class="lbpAv" src="${avatar}" alt="" loading="lazy">
            <span class="lbpNm">${escHtml(name)}${mine ? ` <em>${t("lb.you")}</em>` : ""}</span>
          </span>
          <span class="c-dd">${this.num(r.dist)}</span>
          <span class="c-dd">★ ${this.num(r.dust)}</span>
          <span class="c-score">${(r.score || 0).toLocaleString(loc)}</span>
        </div>`;
    };

    // Rank is the absolute position in the full board; search only filters display.
    const ranked = this.rows.map((r, i) => ({ r, rank: i + 1 }));
    const shown = q
      ? ranked.filter(({ r }) => displayName(r.wallet, r.nickname).toLowerCase().includes(q))
      : ranked;

    if (!shown.length) { list.innerHTML = `<div class="lbpEmpty">${t("lb.noMatch")}</div>`; return; }
    list.innerHTML = shown.map(({ r, rank }) => rowHtml(r, rank)).join("");

    // Pin the player's own position as a sticky footer if they're not on screen /
    // outside the current filter, so "where am I" is always answerable.
    if (me && !q) {
      const idx = ranked.findIndex(({ r }) => r.wallet.toLowerCase() === me.wallet);
      if (idx >= 0) {
        const mine = ranked[idx];
        // Only pin when the player's own row scrolled out of the top slice.
        if (mine.rank > 8) {
          const foot = document.createElement("div");
          foot.className = "lbpMeFoot";
          foot.innerHTML = rowHtml(mine.r, mine.rank);
          list.parentElement?.appendChild(foot);
        }
      }
    }
  }

  private injectStyles(): void {
    if (document.getElementById("lbpStyles")) return;
    const s = document.createElement("style");
    s.id = "lbpStyles";
    s.textContent = `
    .lbpOverlay{position:fixed;inset:0;z-index:30;display:flex;align-items:flex-end;justify-content:center;
      background:rgba(3,4,14,.68);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);
      animation:lbpFade .2s ease}
    @keyframes lbpFade{from{opacity:0}to{opacity:1}}
    .lbpSheet{width:min(100vw,560px);max-height:92vh;display:flex;flex-direction:column;
      padding:calc(env(safe-area-inset-top) + 14px) 16px calc(env(safe-area-inset-bottom) + 14px);
      background:
        radial-gradient(120% 60% at 50% -8%, rgba(120,90,220,.28), transparent 60%),
        linear-gradient(180deg,#0b0a20 0%,#08071a 60%,#050414 100%);
      border-radius:24px 24px 0 0;border:1px solid rgba(150,170,255,.18);border-bottom:none;
      box-shadow:0 -20px 60px rgba(0,0,0,.6);animation:lbpUp .28s cubic-bezier(.2,.8,.2,1)}
    @keyframes lbpUp{from{transform:translateY(40px);opacity:.4}to{transform:translateY(0);opacity:1}}
    .lbpHead{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
    .lbpTitle{font-size:15px;font-weight:800;letter-spacing:3px;
      background:linear-gradient(180deg,#fff,#c8d6ff 60%,#7db2ff);-webkit-background-clip:text;background-clip:text;
      -webkit-text-fill-color:transparent}
    .lbpClose{width:38px;height:38px;border-radius:50%;font-size:15px;color:#dce4ff;cursor:pointer;
      background:rgba(30,38,78,.6);border:1px solid rgba(150,170,255,.28);font-family:inherit}
    .lbpClose:active{transform:scale(.92)}
    .lbpTabs{display:flex;gap:8px;margin-bottom:12px}
    .lbpTab{flex:1;font-family:inherit;font-size:11px;letter-spacing:1.5px;font-weight:800;padding:11px 4px;
      color:#9aa6d4;background:rgba(28,36,74,.5);border:1px solid rgba(150,170,255,.16);border-radius:11px;
      cursor:pointer;text-transform:uppercase;transition:color .2s,background .2s}
    .lbpTab.on{color:#241a00;background:linear-gradient(180deg,#FFEDB0,#F0B429 60%,#D89B1E);border-color:transparent}
    .lbpSearchWrap{position:relative;margin-bottom:12px}
    .lbpSearchIcon{position:absolute;left:14px;top:50%;transform:translateY(-50%);color:#6b74a0;font-size:16px;pointer-events:none}
    .lbpSearch{width:100%;font-family:inherit;font-size:13px;letter-spacing:1px;color:#fff;font-weight:600;
      padding:12px 14px 12px 38px;background:rgba(10,14,36,.7);border:1px solid rgba(150,170,255,.24);
      border-radius:12px;outline:none}
    .lbpSearch::placeholder{color:#5a6288}
    .lbpSearch:focus{border-color:rgba(176,158,255,.6)}
    .lbpCols{display:grid;grid-template-columns:30px 1fr 50px 46px 66px;gap:4px;align-items:center;
      padding:0 8px 7px;font-size:8.5px;letter-spacing:1.5px;color:#5a6288;font-weight:700;text-transform:uppercase}
    .lbpCols .c-dd,.lbpCols .c-score{text-align:right}
    .lbpList{overflow-y:auto;-webkit-overflow-scrolling:touch;scroll-behavior:smooth;flex:1;min-height:120px;
      display:flex;flex-direction:column;gap:4px;padding-right:2px}
    .lbpRow{display:grid;grid-template-columns:30px 1fr 50px 46px 66px;gap:4px;align-items:center;
      padding:8px;border-radius:12px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.05);
      font-variant-numeric:tabular-nums;opacity:0;animation:lbpRowIn .32s ease forwards}
    @keyframes lbpRowIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    .lbpRow .c-rank{font-weight:800;color:#aeb6da;font-size:13px;text-align:center}
    .lbpRow .c-name{display:flex;align-items:center;gap:9px;min-width:0}
    .lbpAv{width:30px;height:30px;border-radius:50%;flex-shrink:0;object-fit:cover;background:#0a0e24;
      border:1px solid rgba(150,170,255,.35)}
    .lbpNm{font-weight:700;font-size:13px;letter-spacing:.3px;color:#eaf0ff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .lbpNm em{font-style:normal;font-size:8.5px;letter-spacing:1px;color:#241a00;background:var(--gold);
      padding:1px 5px;border-radius:6px;margin-left:5px;font-weight:800;vertical-align:middle}
    .lbpRow .c-dd{text-align:right;font-size:11px;color:#9aa3c4;font-weight:600}
    .lbpRow .c-score{text-align:right;font-size:14px;font-weight:800;color:var(--gold)}
    .lbpRow.me{background:rgba(245,197,66,.12);border-color:rgba(245,197,66,.4)}
    .lbpRow.me .lbpNm{color:#ffe9a0}
    .lbpMeFoot{margin-top:8px;padding-top:8px;border-top:1px dashed rgba(150,170,255,.22)}
    .lbpMeFoot .lbpRow{animation:none;opacity:1;background:rgba(245,197,66,.14);border-color:rgba(245,197,66,.45)}
    .lbpEmpty{text-align:center;color:#5a6288;font-size:12px;letter-spacing:1px;padding:40px 0}
    @media (prefers-reduced-motion: reduce){.lbpRow,.lbpSheet,.lbpOverlay{animation:none;opacity:1}}
    `;
    document.head.appendChild(s);
  }
}
