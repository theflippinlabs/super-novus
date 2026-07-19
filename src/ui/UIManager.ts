/* UIManager — ported from reference, auth section adapted to wallet/guest.
   HUD/stats/toast/flash logic identical to the validated build. */
import type { BoardRow } from "../net/Leaderboard";
import type { PoolInfo } from "../net/PrizePool";
import { SUPPORTED_CHAIN_ID, type ControlMode, type Lang } from "../config";
import { i18n, t } from "../i18n";
import { generateAvatar } from "./Avatar";
import { displayName, silhouetteDataUri } from "./Identity";

/** Identity for the current player's own board row (their chosen name/avatar). */
export interface MeIdentity { wallet: string; nickname: string | null; avatar: string | null; }

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
  walletStatus = $("walletStatus");
  wNick = $("wNick");
  saveState = $("saveState");
  lbPrize = $("lbPrize");
  podium = $("podium");
  saveScoreBtn = $("saveScoreBtn") as HTMLButtonElement;
  bigBangBtn = $("bigBangBtn") as HTMLButtonElement;
  bbLabel = $("bbLabel");
  bbPrice = $("bbPrice");
  bigBangCount = $("bigBangCount");
  menuBtn = $("menuBtn") as HTMLButtonElement;
  newRecordBadge = $("newRecordBadge");
  weeklyRank = $("weeklyRank");
  monthlyRank = $("monthlyRank");
  profileIcon = $("profileIcon") as HTMLButtonElement;
  profileAv = $("profileAv");
  menuMusicBtn = $("menuMusicBtn") as HTMLButtonElement;
  private _tt: ReturnType<typeof setTimeout> | undefined;

  /** Active locale as a BCP-47 tag for number/date formatting. */
  private locale(): string { return BCP47[i18n.get()] ?? "en-US"; }

  /** Reflect the active language: the flag shown on the header pill + the active
      option in the popover chooser. */
  setLangActive(lang: Lang): void {
    const flags: Record<string, string> = { fr: "🇫🇷", en: "🇬🇧", ko: "🇰🇷" };
    const flag = document.getElementById("langFlag");
    if (flag) flag.textContent = flags[lang] ?? "🌍";
    for (const b of document.querySelectorAll<HTMLElement>(".langOpt"))
      b.classList.toggle("active", b.dataset.lang === lang);
  }

  /** Highlight the active control mode option. */
  setControlActive(mode: ControlMode): void {
    for (const b of document.querySelectorAll<HTMLElement>(".ctrlOpt"))
      b.classList.toggle("active", b.dataset.mode === mode);
  }

  /** Fill the circular header profile button so it reads unmistakably as "my
      profile". Connected → the player's avatar (custom, else the deterministic
      galaxy avatar) inside a gold profile ring. Guest → a neutral user silhouette
      in a soft ring, signalling "sign in / your profile". The nickname/address
      never appear here — identity is avatar-only in the header. */
  setProfileIdentity(connected: boolean, wallet: string | null, customAvatar: string | null, _nickname: string | null): void {
    const av = this.profileAv;
    if (connected && wallet) {
      const avatar = customAvatar || generateAvatar(wallet, 64);
      av.style.backgroundImage = `url("${avatar}")`;
      av.classList.add("hasAvatar");
      av.classList.remove("guest");
    } else {
      av.style.backgroundImage = `url("${silhouetteDataUri()}")`;
      av.classList.remove("hasAvatar");
      av.classList.add("guest");
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
      // Connected: show only Avatar (header) + Nickname. No address, no disconnect.
      this.walletBtn.style.display = "none";
      this.walletStatus.style.display = "flex";
      this.wNick.textContent = nickname || "…";
      this.playBtn.textContent = t("menu.playConnected");
      this.walletState.textContent = chainId !== null && chainId !== SUPPORTED_CHAIN_ID ? t("wallet.otherNet") : "";
      return;
    }
    this.walletStatus.style.display = "none";
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
        const name = displayName(r.wallet, r.nickname);   // never an address
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

  /** Render the top-3 as a premium 3D podium (🥇 centre, 🥈 left, 🥉 right).
      Avatar + nickname (never an address), score, trophy on #1, idle animation.
      `me` supplies the current player's own name/avatar so their podium cell uses
      their chosen identity. Empty slots render as neutral pedestals. */
  renderPodium(rows: BoardRow[], me: MeIdentity | null): void {
    // No scores yet → an inviting empty state, not ghost placeholders.
    if (!rows.length) {
      this.podium.innerHTML = `<div class="podEmpty"><span class="podEmojiTrophy">🏆</span><span>${t("lb.empty")}</span></div>`;
      return;
    }
    const loc = this.locale();
    // Visual order left→right: 2nd, 1st, 3rd.
    const slots: Array<{ row: BoardRow | undefined; place: 1 | 2 | 3 }> = [
      { row: rows[1], place: 2 }, { row: rows[0], place: 1 }, { row: rows[2], place: 3 },
    ];
    const medal = (p: number) => (p === 1 ? "🥇" : p === 2 ? "🥈" : "🥉");
    const cell = ({ row, place }: { row: BoardRow | undefined; place: 1 | 2 | 3 }): string => {
      const filled = Boolean(row);
      const mine = Boolean(row && me && row.wallet.toLowerCase() === me.wallet.toLowerCase());
      const name = row ? (mine ? displayName(row.wallet, me!.nickname) : displayName(row.wallet, row.nickname)) : "—";
      const avatar = row
        ? ((mine && me!.avatar) || row.avatar || generateAvatar(row.wallet, 72))
        : silhouetteDataUri("#3f4a72");
      const score = row ? (Math.floor(row.score)).toLocaleString(loc) : "—";
      return `
      <div class="pod pod${place}${filled ? "" : " empty"}${mine ? " me" : ""}">
        <div class="podTop">
          ${place === 1 ? `<div class="podCrown">🏆</div>` : ""}
          <div class="podAvatarWrap">
            <img class="podAvatar" src="${avatar}" alt="" loading="lazy">
            <span class="podMedal">${medal(place)}</span>
          </div>
          <div class="podName">${escHtml(name)}</div>
          <div class="podScore">${score}</div>
        </div>
        <div class="podBase"><span class="podRank">${place}</span></div>
      </div>`;
    };
    this.podium.innerHTML = slots.map(cell).join("");
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
