/* UIManager — ported from reference, auth section adapted to wallet/guest.
   HUD/stats/toast/flash logic identical to the validated build. */
import { shortAddr } from "../net/WalletManager";
import type { BoardRow } from "../net/Leaderboard";
import type { PoolInfo } from "../net/PrizePool";
import { SUPPORTED_CHAIN_ID, type ControlMode, type Lang } from "../config";
import { i18n, t } from "../i18n";
import { generateAvatar } from "./Avatar";

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing in index.html`);
  return el;
};

const BCP47: Record<string, string> = { fr: "fr-FR", en: "en-US", ko: "ko-KR" };
const escHtml = (s: string): string => s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] || c));

export class UIManager {
  hud = $("hud");
  scoreV = $("scoreV");
  distV = $("distV");
  dustV = $("dustV");
  lives = $("livesDots");
  energyWrap = $("energyWrap");
  energyFill = $("energyFill");
  novaFlash = $("novaFlash");
  floatLayer = $("floatLayer");
  pauseBtn = $("pauseBtn") as HTMLButtonElement;
  musicBtn = $("musicBtn") as HTMLButtonElement;
  toast = $("levelToast");
  whiteout = $("whiteout");
  hitFlash = $("hitFlash");
  menu = $("menu");
  gameover = $("gameover");
  pauseScreen = $("pauseScreen");
  playBtn = $("playBtn") as HTMLButtonElement;
  walletBtn = $("walletBtn") as HTMLButtonElement;
  walletState = $("walletState");
  loggedRow = $("loggedRow");
  whoTxt = $("whoTxt");
  logoutBtn = $("logoutBtn") as HTMLButtonElement;
  saveState = $("saveState");
  lbPrize = $("lbPrize");
  lbListMenu = $("lbListMenu");
  bigBangBtn = $("bigBangBtn") as HTMLButtonElement;
  bigBangCount = $("bigBangCount");
  menuBtn = $("menuBtn") as HTMLButtonElement;
  newRecordBadge = $("newRecordBadge");
  weeklyRank = $("weeklyRank");
  monthlyRank = $("monthlyRank");
  profileIcon = $("profileIcon") as HTMLButtonElement;
  menuMusicBtn = $("menuMusicBtn") as HTMLButtonElement;
  private _tt: ReturnType<typeof setTimeout> | undefined;

  /** Active locale as a BCP-47 tag for number/date formatting. */
  private locale(): string { return BCP47[i18n.get()] ?? "en-US"; }

  /** Highlight the active language chip. */
  setLangActive(lang: Lang): void {
    for (const b of document.querySelectorAll<HTMLElement>(".langBtn"))
      b.classList.toggle("active", b.dataset.lang === lang);
  }

  /** Highlight the active control mode option. */
  setControlActive(mode: ControlMode): void {
    for (const b of document.querySelectorAll<HTMLElement>(".ctrlOpt"))
      b.classList.toggle("active", b.dataset.mode === mode);
  }

  /** Fill the circular header profile icon with the avatar when connected, or a
      neutral silhouette otherwise. The nickname/address live only in the panel. */
  setProfileIdentity(connected: boolean, avatar: string | null, _nickname: string | null): void {
    if (connected && avatar) {
      this.profileIcon.style.backgroundImage = `url("${avatar}")`;
      this.profileIcon.classList.add("hasAvatar");
    } else {
      this.profileIcon.style.backgroundImage = "";
      this.profileIcon.classList.remove("hasAvatar");
    }
  }

  /** Toggle the NEW RECORD badge on the game-over screen. */
  showNewRecord(on: boolean): void {
    this.newRecordBadge.style.display = on ? "block" : "none";
  }

  /** Show Big Bang usage this run (e.g. 1/3). */
  setBigBangCount(used: number, max: number): void {
    this.bigBangCount.textContent = t("bigbang.count", { used, max });
  }

  /** Show a weekly/monthly rank line, or hide it when rank is null. */
  setRank(period: "weekly" | "monthly", rank: number | null): void {
    const el = period === "weekly" ? this.weeklyRank : this.monthlyRank;
    if (rank === null) { el.style.display = "none"; return; }
    const label = period === "weekly" ? t("gameover.rankWeekly") : t("gameover.rankMonthly");
    el.innerHTML = `${label} · <b>#${rank}</b>`;
    el.style.display = "block";
  }

  setStats(score: number, dist: number, dust: number): void {
    this.scoreV.textContent = Math.floor(score).toLocaleString("fr-FR");
    this.distV.textContent = Math.floor(dist).toLocaleString("fr-FR");
    this.dustV.textContent = String(dust);
  }

  /** STAR ENERGY gauge fill, 0..1. */
  setEnergy(value01: number): void {
    this.energyFill.style.width = `${Math.round(Math.max(0, Math.min(1, value01)) * 100)}%`;
  }

  /** Toggle the "full" state: blinking bar + Nova Blast hint. */
  setNovaReady(ready: boolean): void {
    this.energyWrap.classList.toggle("full", ready);
  }

  /** Reflect music ON/OFF on both the in-game HUD toggle and the menu header. */
  setMusicButton(on: boolean): void {
    for (const b of [this.musicBtn, this.menuMusicBtn]) {
      b.textContent = on ? "🎵" : "🔇";
      b.classList.toggle("off", !on);
      b.setAttribute("aria-label", on ? "Couper la musique" : "Activer la musique");
    }
  }

  /** Pop a floating score/label near the player and let it rise + fade (~1s).
      Purely cosmetic feedback — spawned from collect / Nova events. */
  floatScore(text: string, kind: "dust" | "graze" | "nova" = "dust"): void {
    const el = document.createElement("div");
    el.className = "floatScore";
    el.textContent = text;
    const color = kind === "nova" ? "#e6c8ff" : kind === "graze" ? "#a5d4ff" : "#ffe08a";
    el.style.color = color;
    el.style.fontSize = kind === "nova" ? "28px" : kind === "graze" ? "15px" : "17px";
    // Cluster around the player (screen centre, slightly low) with light scatter.
    el.style.left = `${48 + (Math.random() * 8 - 4)}%`;
    el.style.top = `${kind === "nova" ? 50 : 60 + (Math.random() * 6 - 3)}%`;
    this.floatLayer.appendChild(el);
    setTimeout(() => el.remove(), 1050);
  }

  /** White-gold full-screen flash for Nova Blast (~400ms). */
  flashNova(): void {
    this.novaFlash.style.transition = "none";
    this.novaFlash.style.opacity = "1";
    requestAnimationFrame(() => {
      this.novaFlash.style.transition = "opacity .4s ease-out";
      this.novaFlash.style.opacity = "0";
    });
  }

  setLives(n: number, max: number): void {
    let s = "";
    for (let i = 0; i < max; i++) s += i < n ? "●" : `<span class="lost">●</span>`;
    this.lives.innerHTML = s;
  }

  showToast(msg: string): void {
    this.toast.textContent = msg;
    this.toast.style.opacity = "1";
    clearTimeout(this._tt);
    this._tt = setTimeout(() => (this.toast.style.opacity = "0"), 1600);
  }

  flashHit(): void {
    this.hitFlash.style.transition = "none";
    this.hitFlash.style.opacity = "1";
    requestAnimationFrame(() => {
      this.hitFlash.style.transition = "opacity .6s";
      this.hitFlash.style.opacity = "0";
    });
  }

  flashWhite(hold: number): void {
    this.whiteout.style.transition = "opacity .06s";
    this.whiteout.style.opacity = "1";
    setTimeout(() => {
      this.whiteout.style.transition = "opacity 1.1s";
      this.whiteout.style.opacity = "0";
    }, hold);
  }

  /** Explicit, non-blocking auth states. Guest mode always available.
      The address is never shown here — the player is identified by nickname. */
  setAuth(addr: string | null, walletAvailable: boolean, chainId: number | null, nickname: string | null = null): void {
    if (addr) {
      this.walletBtn.style.display = "none";
      this.loggedRow.style.display = "flex";
      const net = chainId === SUPPORTED_CHAIN_ID ? "CRONOS" : chainId === null ? "…" : `#${chainId}`;
      this.whoTxt.textContent = `${nickname ? nickname : "✓"} · ${net}`;
      this.playBtn.textContent = t("menu.playConnected");
      this.walletState.textContent = chainId !== null && chainId !== SUPPORTED_CHAIN_ID
        ? t("wallet.otherNet") : t("wallet.rankedNote");
      return;
    }
    this.loggedRow.style.display = "none";
    this.playBtn.textContent = t("menu.playGuest");
    if (!walletAvailable) {
      this.walletBtn.style.display = "";
      this.walletBtn.disabled = true;
      this.walletState.textContent = t("wallet.noConfig");
    } else {
      this.walletBtn.style.display = "";
      this.walletBtn.disabled = false;
      this.walletState.textContent = t("wallet.guestNote");
    }
  }

  setWalletError(msg: string): void {
    this.walletState.textContent = t("wallet.error", { msg });
  }

  renderBoard(el: HTMLElement, rows: BoardRow[], meWallet: string | null): void {
    if (!rows.length) {
      el.innerHTML = `<div class="lbEmpty">${t("lb.empty")}</div>`;
      return;
    }
    const loc = this.locale();
    el.innerHTML = rows
      .map((r, i) => {
        const name = r.nickname || r.pseudo;
        const avatar = r.avatar || generateAvatar(r.wallet, 48);
        return `
      <div class="lbRow${r.wallet === meWallet ? " me" : ""}">
        <span class="rank">${i + 1}</span>
        <img class="lbAvatar" src="${avatar}" alt="" loading="lazy">
        <span class="who">
          <span class="name">${escHtml(name)}</span>
          <span class="sub">${Math.floor(r.dist).toLocaleString(loc)} m · ★ ${Math.floor(r.dust)}${r.bigBangs ? ` · 🌌${r.bigBangs}` : ""}</span>
        </span>
        <span class="pts">${Math.floor(r.score).toLocaleString(loc)}</span>
      </div>`;
      })
      .join("");
  }

  /** Explicit, non-blocking message in a board (e.g. server not configured). */
  boardMessage(el: HTMLElement, msg: string): void {
    el.innerHTML = `<div class="lbEmpty">${msg}</div>`;
  }

  /** Render the live prize pool for the active tab. USD amounts are guaranteed;
      CRO equivalents are shown as "≈" (they depend on the price at award time).
      Monthly also shows the 30% Community Bonus from this month's Big Bangs. */
  setPrizePool(period: "weekly" | "monthly", pool: PoolInfo | null): void {
    const el = this.lbPrize;
    if (!pool) { el.innerHTML = `🏆 <span>${t("prize.loading")}</span>`; return; }
    const cro = (n: number) => n.toLocaleString(this.locale(), { maximumFractionDigits: n < 100 ? 2 : 0 });
    if (period === "weekly") {
      const eq = pool.weeklyCRO !== null ? ` (≈${cro(pool.weeklyCRO)} CRO)` : "";
      el.innerHTML =
        `🏆 <b>${t("prize.weeklyMain", { usd: pool.weeklyUsd })}</b> ` +
        `<span>${t("prize.paidInCro")}${eq} — ${t("prize.weeklyComp")}</span>`;
    } else {
      const gEq = pool.monthlyGuaranteedCRO !== null ? ` (≈${cro(pool.monthlyGuaranteedCRO)} CRO)` : "";
      const bonus = cro(pool.bonusCRO);
      el.innerHTML =
        `🏆 <b>${t("prize.monthlyTitle")}</b><br>` +
        `<span>${t("prize.guaranteed", { usd: pool.monthlyUsd })}${gEq}</span><br>` +
        `<span>${t("prize.bonus", { bonus })}</span><br>` +
        `<b>${t("prize.total", { usd: pool.monthlyUsd, bonus })}</b>`;
    }
  }

  /** Reflect the active weekly/monthly tab across both panels. */
  setLbTab(period: string): void {
    for (const btn of document.querySelectorAll<HTMLElement>(".lbTab"))
      btn.classList.toggle("active", btn.dataset.period === period);
  }

  hideBoards(): void {
    for (const el of document.querySelectorAll<HTMLElement>(".lbPanel")) el.style.display = "none";
  }
}
