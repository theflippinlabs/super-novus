/* UIManager — ported from reference, auth section adapted to wallet/guest.
   HUD/stats/toast/flash logic identical to the validated build. */
import { shortAddr } from "../net/WalletManager";
import type { BoardRow } from "../net/Leaderboard";
import { SUPPORTED_CHAIN_ID } from "../config";

const $ = (id: string): HTMLElement => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing in index.html`);
  return el;
};

export class UIManager {
  hud = $("hud");
  scoreV = $("scoreV");
  distV = $("distV");
  dustV = $("dustV");
  lives = $("livesDots");
  energyWrap = $("energyWrap");
  energyFill = $("energyFill");
  novaFlash = $("novaFlash");
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
  lbListMenu = $("lbListMenu");
  bigBangBtn = $("bigBangBtn") as HTMLButtonElement;
  menuBtn = $("menuBtn") as HTMLButtonElement;
  newRecordBadge = $("newRecordBadge");
  weeklyRank = $("weeklyRank");
  monthlyRank = $("monthlyRank");
  private _tt: ReturnType<typeof setTimeout> | undefined;

  /** Toggle the NEW RECORD badge on the game-over screen. */
  showNewRecord(on: boolean): void {
    this.newRecordBadge.style.display = on ? "block" : "none";
  }

  /** Show a weekly/monthly rank line, or hide it when rank is null. */
  setRank(period: "weekly" | "monthly", rank: number | null): void {
    const el = period === "weekly" ? this.weeklyRank : this.monthlyRank;
    if (rank === null) { el.style.display = "none"; return; }
    const label = period === "weekly" ? "CLASSEMENT SEMAINE" : "CLASSEMENT MOIS";
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

  /** Reflect music ON/OFF on the HUD toggle. */
  setMusicButton(on: boolean): void {
    this.musicBtn.textContent = on ? "🎵" : "🔇";
    this.musicBtn.classList.toggle("off", !on);
    this.musicBtn.setAttribute("aria-label", on ? "Couper la musique" : "Activer la musique");
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

  /** Explicit, non-blocking auth states. Guest mode always available. */
  setAuth(addr: string | null, walletAvailable: boolean, chainId: number | null): void {
    if (addr) {
      this.walletBtn.style.display = "none";
      this.loggedRow.style.display = "flex";
      const net = chainId === SUPPORTED_CHAIN_ID ? "CRONOS"
        : chainId === null ? "RÉSEAU ?" : `RÉSEAU ${chainId}`;
      this.whoTxt.textContent = `CONNECTÉ · ${shortAddr(addr).toUpperCase()} · ${net}`;
      this.playBtn.textContent = "S'EMBRASER";
      this.walletState.textContent = chainId !== null && chainId !== SUPPORTED_CHAIN_ID
        ? "Réseau différent de Cronos — la signature du score fonctionne quand même."
        : "Ton meilleur score sera enregistré au classement public.";
      return;
    }
    this.loggedRow.style.display = "none";
    this.playBtn.textContent = "CONTINUER EN INVITÉ";
    if (!walletAvailable) {
      this.walletBtn.style.display = "";
      this.walletBtn.disabled = true;
      this.walletState.textContent =
        "Wallet non configuré (VITE_WC_PROJECT_ID absent et aucun wallet injecté) — mode invité disponible.";
    } else {
      this.walletBtn.style.display = "";
      this.walletBtn.disabled = false;
      this.walletState.textContent = "Sans connexion, ton score ne sera pas enregistré au classement.";
    }
  }

  setWalletError(msg: string): void {
    this.walletState.textContent = `Connexion wallet impossible : ${msg}`;
  }

  renderBoard(el: HTMLElement, rows: BoardRow[], meWallet: string | null): void {
    if (!rows.length) {
      el.innerHTML = `<div class="lbEmpty">Aucun score cette période — sois le premier !</div>`;
      return;
    }
    const esc = (s: string) => s.replace(/[<>&]/g, "");
    el.innerHTML = rows
      .map(
        (r, i) => `
      <div class="lbRow${r.wallet === meWallet ? " me" : ""}">
        <span class="rank">${i + 1}</span>
        <span class="who">
          <span class="name">${esc(r.pseudo)}</span>
          <span class="sub">${Math.floor(r.dist).toLocaleString("fr-FR")} m · ★ ${Math.floor(r.dust)}</span>
        </span>
        <span class="pts">${Math.floor(r.score).toLocaleString("fr-FR")}</span>
      </div>`,
      )
      .join("");
  }

  /** Explicit, non-blocking message in a board (e.g. server not configured). */
  boardMessage(el: HTMLElement, msg: string): void {
    el.innerHTML = `<div class="lbEmpty">${msg}</div>`;
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
