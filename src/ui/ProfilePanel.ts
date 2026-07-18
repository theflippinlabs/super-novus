/* ProfilePanel — premium player dashboard.
   Shows the player as Avatar + Nickname (never a raw address on the home screen —
   the full address appears only inside this panel). Two views: the nickname setup
   prompt (right after connecting, when no nickname is set) and the full dashboard
   (identity, ranks, lifetime stats, game history, reward history).
   Fails soft: without Supabase it still shows the generated avatar and explains
   that online profiles aren't configured. */
import { Profile, type ProfileRow, type ProfileStats, type RunRow, type RewardRow } from "../net/Profile";
import { Leaderboard } from "../net/Leaderboard";
import { WalletManager } from "../net/WalletManager";
import { generateAvatar } from "./Avatar";
import { i18n, t } from "../i18n";
import { NICKNAME_MIN, NICKNAME_MAX } from "../config";

const BCP47: Record<string, string> = { fr: "fr-FR", en: "en-US", ko: "ko-KR" };

export class ProfilePanel {
  private el: HTMLElement;
  private onIdentityChange: (() => void) | null = null;

  constructor(private profile: Profile, private wallet: WalletManager, private leaderboard: Leaderboard) {
    this.injectStyles();
    const el = document.createElement("div");
    el.id = "profilePanel";
    el.className = "pfOverlay";
    el.style.display = "none";
    document.body.appendChild(el);
    this.el = el;
    i18n.onChange(() => { if (this.el.style.display !== "none") this.render(); });
  }

  /** Called after a successful save so the menu can refresh the identity chip. */
  setIdentityListener(cb: () => void): void { this.onIdentityChange = cb; }

  isOpen(): boolean { return this.el.style.display !== "none"; }
  close(): void { this.el.style.display = "none"; this.el.innerHTML = ""; }

  private avatarSrc(row: ProfileRow | null): string {
    const addr = this.wallet.getAddress() || "0x0";
    if (row?.avatar_url) return row.avatar_url;
    const cached = this.profile.cachedIdentity(addr).avatar;
    return cached || generateAvatar(addr, 128);
  }
  private nick(row: ProfileRow | null): string | null {
    const addr = this.wallet.getAddress() || "";
    return row?.nickname ?? this.profile.cachedIdentity(addr).nickname ?? null;
  }
  private locale(): string { return BCP47[i18n.get()] ?? "en-US"; }
  private num(n: number): string { return Math.floor(n || 0).toLocaleString(this.locale()); }
  private date(iso: string | null): string {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleDateString(this.locale(), { year: "numeric", month: "short", day: "numeric" }); }
    catch { return iso.slice(0, 10); }
  }

  /* ============================ nickname setup ============================ */
  async openNicknameSetup(): Promise<void> {
    this.el.style.display = "flex";
    const row = await this.profile.get();
    const avatar = this.avatarSrc(row);
    this.el.innerHTML = `
      <div class="pfCard pfNarrow">
        <img class="pfAvatarBig" src="${avatar}" alt="avatar">
        <h2 class="pfH">${t("profile.chooseNickname")}</h2>
        <p class="pfMuted">${t("profile.chooseNicknameSub")}</p>
        <input id="pfNickIn" class="pfInput" maxlength="${NICKNAME_MAX}" placeholder="${t("profile.nickname")}" autocomplete="off">
        <div id="pfNickMsg" class="pfMsg">${t("profile.nickRules")}</div>
        <button id="pfNickSave" class="pfBtn pfBtnGold">${t("profile.save")}</button>
      </div>`;
    const input = this.el.querySelector("#pfNickIn") as HTMLInputElement;
    const msg = this.el.querySelector("#pfNickMsg") as HTMLElement;
    const btn = this.el.querySelector("#pfNickSave") as HTMLButtonElement;
    input.focus();
    btn.addEventListener("click", () => this.saveNickname(input, msg, btn, true));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") this.saveNickname(input, msg, btn, true); });
  }

  private async saveNickname(input: HTMLInputElement, msg: HTMLElement, btn: HTMLButtonElement, closeOnDone: boolean): Promise<void> {
    const name = input.value.trim();
    if (name.length < NICKNAME_MIN || name.length > NICKNAME_MAX) { msg.textContent = t("profile.nickRules"); msg.className = "pfMsg pfErr"; return; }
    btn.disabled = true; msg.className = "pfMsg"; msg.textContent = t("profile.saving");
    const res = await this.profile.save({ nickname: name });
    if (res.ok) {
      msg.textContent = t("profile.saved"); msg.className = "pfMsg pfOk";
      this.onIdentityChange?.();
      if (closeOnDone) setTimeout(() => this.close(), 700); else this.render();
    } else {
      btn.disabled = false;
      msg.className = "pfMsg pfErr";
      msg.textContent = res.error === "nick-taken" ? t("profile.nickTaken")
        : res.error === "not-configured" ? t("profile.notConfigured")
        : res.error === "signature" ? t("profile.saveError") : t("profile.saveError");
    }
  }

  /* ============================ full dashboard ============================ */
  async open(): Promise<void> {
    this.el.style.display = "flex";
    await this.render();
  }

  private async render(): Promise<void> {
    const addr = this.wallet.getAddress();
    if (!addr) {
      this.el.innerHTML = `
        <div class="pfCard pfNarrow">
          <h2 class="pfH">${t("profile.title")}</h2>
          <p class="pfMuted">${t("profile.guest")}</p>
          <button id="pfClose" class="pfBtn">${t("common.close")}</button>
        </div>`;
      this.el.querySelector("#pfClose")?.addEventListener("click", () => this.close());
      return;
    }

    // Instant skeleton with the cached/generated identity, then hydrate.
    const cachedNick = this.profile.cachedIdentity(addr).nickname;
    this.el.innerHTML = this.shell(this.avatarSrc(null), cachedNick, addr, true);
    this.bindShell();

    const [row, stats, runs, rewards, weeklyRank, monthlyRank] = await Promise.all([
      this.profile.get(),
      this.profile.stats(),
      this.profile.runs(),
      this.profile.rewards(),
      this.leaderboard.myRank("weekly"),
      this.leaderboard.myRank("monthly"),
    ]);

    const nickname = this.nick(row);
    this.el.innerHTML = this.shell(this.avatarSrc(row), nickname, addr, false, { stats, runs, rewards, row, weeklyRank, monthlyRank });
    this.bindShell(row);
  }

  private shell(
    avatar: string, nickname: string | null, addr: string, loading: boolean,
    d?: { stats: ProfileStats | null; runs: RunRow[]; rewards: RewardRow[]; row: ProfileRow | null; weeklyRank: number | null; monthlyRank: number | null },
  ): string {
    const name = nickname || `${addr.slice(0, 6)}…${addr.slice(-4)}`;
    const configWarn = this.profile.available ? "" : `<div class="pfWarn">${t("profile.notConfigured")}</div>`;
    const head = `
      <div class="pfHead">
        <div class="pfIdent">
          <div class="pfAvatarWrap"><img class="pfAvatarBig" src="${avatar}" alt="avatar"><button id="pfAvatarBtn" class="pfAvatarEdit" aria-label="${t("profile.changeAvatar")}">✎</button></div>
          <div class="pfNameCol">
            <div class="pfName" id="pfName">${esc(name)}</div>
            <button id="pfEditNick" class="pfLink">${t("profile.editNickname")}</button>
          </div>
        </div>
        <button id="pfClose" class="pfX" aria-label="${t("common.close")}">✕</button>
      </div>
      <input id="pfAvatarFile" type="file" accept="image/*" style="display:none">`;

    if (loading || !d) {
      return `<div class="pfCard">${head}${configWarn}<div class="pfMuted pfPad">${t("common.loading")}</div></div>`;
    }

    const { stats, runs, rewards, weeklyRank, monthlyRank, row } = d;
    const rk = (n: number | null) => (n === null || n === undefined ? "—" : `#${n}`);
    const meta = `
      <div class="pfMeta">
        <div class="pfMetaRow"><span>${t("profile.wallet")}</span><b class="pfAddr">${esc(addr)}</b></div>
        <div class="pfMetaRow"><span>${t("profile.memberSince")}</span><b>${this.date(row?.created_at ?? null)}</b></div>
      </div>`;
    const ranks = `
      <div class="pfRanks">
        <div class="pfRank"><div class="pfRankV">${rk(weeklyRank)}</div><div class="pfRankL">${t("profile.currentRank")}</div></div>
        <div class="pfRank"><div class="pfRankV">${rk(stats?.best_weekly_rank ?? null)}</div><div class="pfRankL">${t("profile.bestWeekly")}</div></div>
        <div class="pfRank"><div class="pfRankV">${rk(stats?.best_monthly_rank ?? null)}</div><div class="pfRankL">${t("profile.bestMonthly")}</div></div>
      </div>`;

    const tiles: Array<[string, string, string]> = [
      ["⭐", t("stats.highScore"), this.num(stats?.high_score ?? 0)],
      ["🌌", t("stats.totalDistance"), this.num(stats?.total_dist ?? 0) + " m"],
      ["✨", t("stats.totalDust"), this.num(stats?.total_dust ?? 0)],
      ["🎮", t("stats.games"), this.num(stats?.games ?? 0)],
      ["💀", t("stats.deaths"), this.num(stats?.deaths ?? 0)],
      ["🌠", t("stats.bigbangs"), this.num(stats?.big_bangs ?? 0)],
      ["🏆", t("stats.weeklyWins"), this.num(stats?.weekly_wins ?? 0)],
      ["👑", t("stats.monthlyWins"), this.num(stats?.monthly_wins ?? 0)],
    ];
    const statsGrid = `
      <div class="pfSection"><h3 class="pfSecH">${t("stats.title")}</h3>
        <div class="pfGrid">${tiles.map(([ic, l, v]) => `
          <div class="pfTile"><div class="pfTileIc">${ic}</div><div class="pfTileV">${v}</div><div class="pfTileL">${l}</div></div>`).join("")}
        </div></div>`;

    const history = `
      <div class="pfSection"><h3 class="pfSecH">${t("history.title")}</h3>
        ${runs.length ? `<div class="pfList">${runs.map((r) => `
          <div class="pfRow">
            <span class="pfRowDate">${this.date(r.created_at)}</span>
            <span class="pfRowMain"><b>${this.num(r.score)}</b> · ${this.num(r.dist)} m${r.big_bangs ? ` · 🌌${r.big_bangs}` : ""}</span>
            <span class="pfRowPos">${r.weekly_rank ? "S#" + r.weekly_rank : ""}${r.monthly_rank ? " · M#" + r.monthly_rank : ""}</span>
          </div>`).join("")}</div>` : `<div class="pfMuted pfPad">${t("history.empty")}</div>`}
      </div>`;

    const rewardsHtml = `
      <div class="pfSection"><h3 class="pfSecH">${t("rewards.title")}</h3>
        ${rewards.length ? `<div class="pfList">${rewards.map((r) => {
          const champ = r.period_type === "weekly" ? t("rewards.weeklyChampion") : t("rewards.monthlyChampion");
          const desc = r.period_type === "weekly" ? t("rewards.weeklyReward") : t("rewards.monthlyReward");
          const st = r.status === "paid" ? t("rewards.statusPaid") : r.status === "completed" ? t("rewards.statusCompleted") : t("rewards.statusPending");
          const cls = r.status === "paid" || r.status === "completed" ? "pfPaid" : "pfPending";
          return `<div class="pfReward">
            <div class="pfRewTop"><b>🏆 ${champ}</b><span class="pfBadge ${cls}">${st}</span></div>
            <div class="pfRewSub">${this.date(r.period_start)} · ${t("rewards.firstPlace")}</div>
            <div class="pfRewDesc">${desc}</div>
          </div>`;
        }).join("")}</div>` : `<div class="pfMuted pfPad">${t("rewards.empty")}</div>`}
      </div>`;

    return `<div class="pfCard">${head}${configWarn}${meta}${ranks}${statsGrid}${history}${rewardsHtml}</div>`;
  }

  private bindShell(row?: ProfileRow | null): void {
    this.el.querySelector("#pfClose")?.addEventListener("click", () => this.close());
    // Edit nickname inline.
    this.el.querySelector("#pfEditNick")?.addEventListener("click", () => this.inlineNickname(row ?? null));
    // Avatar upload.
    const fileBtn = this.el.querySelector("#pfAvatarBtn") as HTMLButtonElement | null;
    const file = this.el.querySelector("#pfAvatarFile") as HTMLInputElement | null;
    fileBtn?.addEventListener("click", () => file?.click());
    file?.addEventListener("change", () => this.onAvatarFile(file));
  }

  private inlineNickname(row: ProfileRow | null): void {
    const nameEl = this.el.querySelector("#pfName") as HTMLElement | null;
    if (!nameEl) return;
    const current = this.nick(row) ?? "";
    nameEl.innerHTML = `
      <input id="pfNickIn" class="pfInput pfInputSm" maxlength="${NICKNAME_MAX}" value="${esc(current)}" placeholder="${t("profile.nickname")}" autocomplete="off">
      <div id="pfNickMsg" class="pfMsg">${t("profile.nickRules")}</div>
      <button id="pfNickSave" class="pfBtn pfBtnGold pfBtnSm">${t("profile.save")}</button>`;
    const input = this.el.querySelector("#pfNickIn") as HTMLInputElement;
    const msg = this.el.querySelector("#pfNickMsg") as HTMLElement;
    const btn = this.el.querySelector("#pfNickSave") as HTMLButtonElement;
    input.focus();
    btn.addEventListener("click", () => this.saveNickname(input, msg, btn, false));
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") this.saveNickname(input, msg, btn, false); });
  }

  /** Downscale any uploaded image to a 256×256 JPEG data URI (guaranteed small). */
  private onAvatarFile(input: HTMLInputElement): void {
    const f = input.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = async () => {
        const size = 256;
        const canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        // cover-fit
        const scale = Math.max(size / img.width, size / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        const res = await this.profile.save({ avatarUrl: dataUrl });
        if (res.ok) { this.onIdentityChange?.(); this.render(); }
        else console.warn("[ProfilePanel] avatar save failed:", res.error);
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(f);
  }

  private injectStyles(): void {
    if (document.getElementById("pfStyles")) return;
    const s = document.createElement("style");
    s.id = "pfStyles";
    s.textContent = `
      .pfOverlay{position:fixed;inset:0;z-index:30;display:flex;align-items:flex-start;justify-content:center;
        background:radial-gradient(ellipse at 50% -10%,rgba(60,40,110,.5),rgba(3,3,18,.96) 62%);
        overflow-y:auto;padding:max(18px,env(safe-area-inset-top)) 14px 40px;-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
      .pfCard{width:min(94vw,440px);margin-top:8px;background:rgba(8,11,28,.72);border:1px solid rgba(140,170,255,.18);
        border-radius:20px;padding:18px 16px 20px;box-shadow:0 24px 60px rgba(0,0,0,.5)}
      .pfNarrow{max-width:340px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:10px}
      .pfHead{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin-bottom:14px}
      .pfIdent{display:flex;gap:12px;align-items:center;min-width:0}
      .pfAvatarWrap{position:relative;flex-shrink:0}
      .pfAvatarBig{width:64px;height:64px;border-radius:18px;border:1px solid rgba(245,197,66,.4);
        box-shadow:0 0 22px rgba(120,90,255,.35);object-fit:cover;background:#0a0e24}
      .pfNarrow .pfAvatarBig{width:96px;height:96px;border-radius:26px}
      .pfAvatarEdit{position:absolute;right:-6px;bottom:-6px;width:24px;height:24px;border-radius:50%;border:none;cursor:pointer;
        background:linear-gradient(180deg,#FFEDB0,var(--gold) 60%,#D89B1E);color:#050418;font-size:11px;font-weight:800;pointer-events:auto}
      .pfNameCol{min-width:0}
      .pfName{font-size:20px;font-weight:800;letter-spacing:.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .pfLink{background:none;border:none;color:var(--dim);font-family:inherit;font-size:11px;letter-spacing:1px;cursor:pointer;padding:2px 0;pointer-events:auto}
      .pfLink:hover{color:#c8cfe8}
      .pfX,.pfBtn{pointer-events:auto;font-family:inherit;cursor:pointer}
      .pfX{width:34px;height:34px;flex-shrink:0;border-radius:10px;border:1px solid rgba(255,255,255,.16);
        background:rgba(20,24,52,.6);color:#c8cfe8;font-size:13px}
      .pfH{font-size:16px;letter-spacing:2px;font-weight:800;margin-top:4px}
      .pfMuted{color:var(--dim);font-size:13px;line-height:1.5}
      .pfPad{padding:8px 2px}
      .pfWarn{font-size:11px;color:#f5c542;background:rgba(245,197,66,.08);border:1px solid rgba(245,197,66,.25);
        border-radius:10px;padding:8px 10px;margin-bottom:12px}
      .pfMeta{margin:0 0 14px;border-top:1px solid rgba(255,255,255,.07);border-bottom:1px solid rgba(255,255,255,.07);padding:10px 0}
      .pfMetaRow{display:flex;justify-content:space-between;gap:12px;font-size:12px;padding:3px 0}
      .pfMetaRow span{color:var(--dim);letter-spacing:1px;flex-shrink:0}
      .pfMetaRow b{color:#e6ebff;font-weight:700;text-align:right;min-width:0}
      .pfAddr{font-family:ui-monospace,Menlo,monospace;font-size:10.5px;word-break:break-all;color:#9fb0e0}
      .pfRanks{display:flex;gap:8px;margin-bottom:16px}
      .pfRank{flex:1;background:rgba(20,26,58,.5);border:1px solid rgba(140,170,255,.16);border-radius:12px;padding:10px 6px;text-align:center}
      .pfRankV{font-size:20px;font-weight:800;color:var(--gold);font-variant-numeric:tabular-nums}
      .pfRankL{font-size:8.5px;letter-spacing:1px;color:var(--dim);margin-top:3px;line-height:1.2}
      .pfSection{margin-bottom:18px}
      .pfSecH{font-size:10px;letter-spacing:3px;color:var(--dim);font-weight:700;margin-bottom:10px}
      .pfGrid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
      .pfTile{background:rgba(16,20,44,.6);border:1px solid rgba(140,170,255,.14);border-radius:12px;padding:10px 4px;text-align:center}
      .pfTileIc{font-size:16px}
      .pfTileV{font-size:14px;font-weight:800;margin-top:3px;font-variant-numeric:tabular-nums}
      .pfTileL{font-size:7.5px;letter-spacing:.5px;color:var(--dim);margin-top:2px;line-height:1.2}
      .pfList{display:flex;flex-direction:column;gap:6px}
      .pfRow{display:flex;align-items:baseline;gap:8px;font-size:12px;padding:8px 10px;background:rgba(16,20,44,.5);border-radius:10px;font-variant-numeric:tabular-nums}
      .pfRowDate{color:var(--dim);font-size:10px;width:74px;flex-shrink:0}
      .pfRowMain{flex:1;min-width:0}
      .pfRowMain b{color:var(--gold)}
      .pfRowPos{color:#9fb0e0;font-size:10px;flex-shrink:0}
      .pfReward{background:rgba(16,20,44,.5);border:1px solid rgba(140,170,255,.14);border-radius:12px;padding:10px 12px}
      .pfRewTop{display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px}
      .pfRewSub{font-size:10px;color:var(--dim);margin:3px 0}
      .pfRewDesc{font-size:11px;color:#c8cfe8}
      .pfBadge{font-size:9px;letter-spacing:1px;font-weight:800;padding:3px 8px;border-radius:20px}
      .pfPending{color:#f5c542;background:rgba(245,197,66,.12)}
      .pfPaid{color:#9fdc8a;background:rgba(120,220,120,.12)}
      .pfInput{pointer-events:auto;font-family:inherit;font-size:15px;letter-spacing:1px;text-align:center;font-weight:700;color:#fff;
        background:rgba(10,14,36,.8);border:1px solid rgba(140,170,255,.4);border-radius:10px;padding:11px 12px;width:100%;outline:none}
      .pfInputSm{font-size:14px;padding:8px 10px;margin-bottom:6px}
      .pfMsg{font-size:11px;color:var(--dim);margin:4px 0 2px}
      .pfMsg.pfErr{color:#e0708a}.pfMsg.pfOk{color:#9fdc8a}
      .pfBtn{border:1px solid rgba(140,170,255,.4);background:rgba(30,40,80,.7);color:#dfe6ff;border-radius:10px;
        padding:11px 18px;font-weight:700;letter-spacing:1px;font-size:12px}
      .pfBtnGold{border:none;background:linear-gradient(180deg,#FFEDB0,var(--gold) 60%,#D89B1E);color:#050418;font-weight:800}
      .pfBtnSm{padding:8px 14px;font-size:11px}
      @media (prefers-reduced-motion: reduce){.pfOverlay{backdrop-filter:none}}
    `;
    document.head.appendChild(s);
  }
}

function esc(s: string): string { return s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] || c)); }
