/* ProfilePanel — premium player dashboard.
   Shows the player as Avatar + Nickname (never a raw address on the home screen —
   the full address appears only inside this panel). Two views: the nickname setup
   prompt (right after connecting, when no nickname is set) and the full dashboard
   (identity, ranks, lifetime stats, game history, reward history).
   Fails soft: without Supabase it still shows the generated avatar and explains
   that online profiles aren't configured. */
import { Profile, type ProfileRow, type ProfileStats } from "../net/Profile";
import { Leaderboard } from "../net/Leaderboard";
import { WalletManager } from "../net/WalletManager";
import { BigBangCredits } from "../net/BigBangCredits";
import { i18n, t } from "../i18n";

const DEFAULT_AVATAR = "/appicon.png";   // official Super Novus icon until one is uploaded
import { NICKNAME_MIN, NICKNAME_MAX, TREASURY_ADDRESS } from "../config";

const BCP47: Record<string, string> = { fr: "fr-FR", en: "en-US", ko: "ko-KR" };

export class ProfilePanel {
  private el: HTMLElement;
  private onIdentityChange: (() => void) | null = null;
  private openStore: (() => void) | null = null;

  constructor(private profile: Profile, private wallet: WalletManager, private leaderboard: Leaderboard, private credits: BigBangCredits) {
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
  /** Lets the "Buy more" action open the Big Bang Store. */
  setStoreOpener(cb: () => void): void { this.openStore = cb; }

  isOpen(): boolean { return this.el.style.display !== "none"; }
  close(): void { this.el.style.display = "none"; this.el.innerHTML = ""; }

  private avatarSrc(row: ProfileRow | null): string {
    const addr = this.wallet.getAddress() || "0x0";
    if (row?.avatar_url) return row.avatar_url;
    return this.profile.cachedIdentity(addr).avatar || DEFAULT_AVATAR;
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
        <img class="pfAvatarBig" src="${esc(avatar)}" alt="avatar">
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

    // Identity + lifetime totals are local (instant). Render immediately so the
    // dashboard never waits on the network.
    const [row, stats] = await Promise.all([this.profile.get(), this.profile.stats()]);
    const nickname = this.nick(row);
    this.el.innerHTML = this.shell(this.avatarSrc(row), nickname, addr, false, { stats, row, currentRank: null });
    this.bindShell(row);
    const localHigh = stats?.high_score ?? 0;

    // Best score + weekly/monthly ranks come from the LEADERBOARD — the single
    // source of truth. This is what stops the profile and the board disagreeing
    // (e.g. board #1 at 44,933 while the profile still shows 16,542). Runs after
    // paint; stays local/"—" offline; also lifts the cached local best so it can
    // never display below the server.
    Promise.all([
      this.leaderboard.myBest(),
      this.leaderboard.myRank("weekly"),
      this.leaderboard.myRank("monthly"),
    ]).then(([best, wr, mr]) => {
      if (best && best.score > 0) {
        this.profile.recordBest(best.score, best.dist, best.dust);   // persist up
        const hs = this.el.querySelector("#pfHighScore");
        if (hs) hs.textContent = this.num(Math.max(best.score, localHigh));
      }
      const w = this.el.querySelector("#pfWeeklyRank");
      if (w) w.textContent = wr !== null && wr !== undefined ? `#${wr}` : "—";
      const m = this.el.querySelector("#pfMonthlyRank");
      if (m) m.textContent = mr !== null && mr !== undefined ? `#${mr}` : "—";
    }).catch(() => { /* offline → best stays local, ranks stay "—" */ });
  }

  /** Re-render if the panel is open (e.g. right after a successful submission). */
  async refresh(): Promise<void> { if (this.isOpen()) await this.render(); }

  private shell(
    avatar: string, nickname: string | null, addr: string, loading: boolean,
    d?: { stats: ProfileStats | null; row: ProfileRow | null; currentRank: number | null },
  ): string {
    const name = nickname || `${addr.slice(0, 6)}…${addr.slice(-4)}`;
    const configWarn = this.profile.available ? "" : `<div class="pfWarn">${t("profile.notConfigured")}</div>`;
    const head = `
      <div class="pfHead">
        <div class="pfIdent">
          <div class="pfAvatarWrap"><img class="pfAvatarBig" src="${esc(avatar)}" alt="avatar"><button id="pfAvatarBtn" class="pfAvatarEdit" aria-label="${t("profile.changeAvatar")}">✎</button></div>
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

    const { stats, currentRank, row } = d;
    const rk = (n: number | null) => (n === null || n === undefined ? "—" : `#${n}`);
    const meta = `
      <div class="pfMeta">
        <div class="pfMetaRow"><span>${t("profile.wallet")}</span><b class="pfAddr">${esc(addr)}</b></div>
        <div class="pfMetaRow"><span>${t("profile.memberSince")}</span><b>${this.date(row?.created_at ?? null)}</b></div>
      </div>`;
    void currentRank;
    // Ranks come straight from the leaderboard (server) — hydrated in render().
    const ranks = `
      <div class="pfRanks">
        <div class="pfRank"><div class="pfRankV" id="pfWeeklyRank">—</div><div class="pfRankL">${t("profile.rankWeekly")}</div></div>
        <div class="pfRank"><div class="pfRankV" id="pfMonthlyRank">—</div><div class="pfRankL">${t("profile.rankMonthly")}</div></div>
      </div>`;

    const tiles: Array<[string, string, string, string?]> = [
      ["⭐", t("stats.highScore"), this.num(stats?.high_score ?? 0), "pfHighScore"],
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
        <div class="pfGrid">${tiles.map(([ic, l, v, id]) => `
          <div class="pfTile"><div class="pfTileIc">${ic}</div><div class="pfTileV"${id ? ` id="${id}"` : ""}>${v}</div><div class="pfTileL">${l}</div></div>`).join("")}
        </div></div>`;

    // Big Bang Credits — the player's balance; tap to see purchase history.
    const credits = `
      <button class="pfCredits" id="pfCredits">
        <span class="pfCredIc">💥</span>
        <span class="pfCredCol">
          <span class="pfCredV">${this.credits.available(addr)} <em>${t("profile.creditsUnit")}</em></span>
          <span class="pfCredL">${t("profile.credits")}</span>
        </span>
        <span class="pfCredArrow">›</span>
      </button>`;

    // Owner-only shortcut: when the TREASURY wallet is connected, show a discreet
    // "Admin — Payouts" button that opens the payout console (?admin=1). Hidden for
    // every other wallet, so players never see it.
    const isTreasury = addr.toLowerCase() === TREASURY_ADDRESS.toLowerCase();
    const admin = isTreasury
      ? `<button id="pfAdmin" class="pfBtn pfBtnGold" style="width:100%;margin-top:8px">🏆 ${t("profile.adminPayouts")}</button>`
      : "";

    // Game history + reward history are intentionally out of scope for now
    // (frontend-first). They'll return with the Supabase-backed profile.
    // Disconnect lives here — never on the home screen.
    const disconnect = `<button id="pfDisconnect" class="pfBtn pfDanger">${t("menu.logout")}</button>`;
    return `<div class="pfCard">${head}${configWarn}${meta}${credits}${ranks}${statsGrid}${admin}${disconnect}</div>`;
  }

  private bindShell(row?: ProfileRow | null): void {
    this.el.querySelector("#pfClose")?.addEventListener("click", () => this.close());
    // Disconnect wallet (only available inside the profile).
    this.el.querySelector("#pfDisconnect")?.addEventListener("click", async () => {
      try { await this.wallet.disconnect(); } catch { /* ignore */ }
      this.onIdentityChange?.();
      this.close();
    });
    // Edit nickname inline.
    this.el.querySelector("#pfEditNick")?.addEventListener("click", () => this.inlineNickname(row ?? null));
    // Avatar upload.
    const fileBtn = this.el.querySelector("#pfAvatarBtn") as HTMLButtonElement | null;
    const file = this.el.querySelector("#pfAvatarFile") as HTMLInputElement | null;
    fileBtn?.addEventListener("click", () => file?.click());
    file?.addEventListener("change", () => this.onAvatarFile(file));
    // Big Bang Credits → purchase history.
    this.el.querySelector("#pfCredits")?.addEventListener("click", () => this.showHistory());
    // Owner-only: open the payout console (reloads with ?admin=1).
    this.el.querySelector("#pfAdmin")?.addEventListener("click", () => {
      location.href = location.pathname + "?admin=1";
    });
  }

  /* ===================== Big Bang credits: purchase history ===================== */
  private showHistory(): void {
    const addr = this.wallet.getAddress();
    const bal = this.credits.available(addr ?? undefined);
    const items = this.credits.history(addr ?? undefined);
    const rows = items.length
      ? items.map((h) => `
          <div class="pfHistRow">
            <span class="pfHistIc">${h.emoji}</span>
            <span class="pfHistMid">
              <span class="pfHistName">${esc(t(`store.pack.${h.packId}`))}</span>
              <span class="pfHistSub">${this.date(new Date(h.ts).toISOString())} · +${h.credits} 💥</span>
            </span>
            <span class="pfHistCro">${this.num(h.cro)} CRO</span>
          </div>`).join("")
      : `<div class="pfMuted pfPad">${t("history.empty")}</div>`;
    this.el.innerHTML = `
      <div class="pfCard">
        <div class="pfHead">
          <button id="pfBack" class="pfX" aria-label="${t("common.close")}">‹</button>
          <div class="pfName" style="flex:1;text-align:center">${t("profile.creditHistory")}</div>
          <div style="width:36px"></div>
        </div>
        <div class="pfCredBig">💥 ${bal} <span>${t("profile.creditsUnit")}</span></div>
        <div class="pfHistList">${rows}</div>
        <button id="pfBuyMore" class="pfBtn pfBtnGold">${t("store.buyMore")}</button>
      </div>`;
    this.el.querySelector("#pfBack")?.addEventListener("click", () => this.render());
    this.el.querySelector("#pfBuyMore")?.addEventListener("click", () => { this.openStore?.(); });
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
      .pfCredits{width:100%;display:flex;align-items:center;gap:12px;margin:0 0 14px;padding:13px 15px;cursor:pointer;
        font-family:inherit;border-radius:14px;text-align:left;
        background:radial-gradient(120% 200% at 0% 0%, rgba(160,110,255,.32), transparent 55%),linear-gradient(180deg,rgba(52,34,96,.55),rgba(24,16,56,.6));
        border:1px solid rgba(170,130,255,.4);box-shadow:0 6px 18px rgba(40,24,96,.35)}
      .pfCredits:active{transform:scale(.99)}
      .pfCredIc{font-size:24px;line-height:1;filter:drop-shadow(0 0 8px rgba(170,120,255,.7))}
      .pfCredCol{display:flex;flex-direction:column;flex:1;min-width:0}
      .pfCredV{font-size:19px;font-weight:800;color:#fff}
      .pfCredV em{font-style:normal;font-size:11px;font-weight:700;color:#c9b8ff;letter-spacing:1px}
      .pfCredL{font-size:9px;letter-spacing:1.5px;color:#a99ad0;font-weight:700;text-transform:uppercase;margin-top:1px}
      .pfCredArrow{font-size:22px;color:#a99ad0;font-weight:400}
      .pfCredBig{text-align:center;font-size:26px;font-weight:800;color:var(--gold);margin:6px 0 16px}
      .pfCredBig span{font-size:12px;color:#c9b8ff;letter-spacing:1px}
      .pfHistList{display:flex;flex-direction:column;gap:8px;margin-bottom:16px;max-height:50vh;overflow-y:auto}
      .pfHistRow{display:flex;align-items:center;gap:11px;padding:11px 12px;border-radius:12px;
        background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06)}
      .pfHistIc{font-size:22px;line-height:1}
      .pfHistMid{display:flex;flex-direction:column;flex:1;min-width:0}
      .pfHistName{font-size:13px;font-weight:800;color:#eaf0ff}
      .pfHistSub{font-size:10px;color:#8b93b8;margin-top:1px}
      .pfHistCro{font-size:13px;font-weight:800;color:var(--gold);white-space:nowrap}
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
      .pfDanger{width:100%;margin-top:8px;color:#e5849a;border-color:rgba(224,112,138,.35);background:rgba(224,112,138,.08)}
      .pfDanger:hover{border-color:rgba(224,112,138,.6)}
      @media (prefers-reduced-motion: reduce){.pfOverlay{backdrop-filter:none}}
    `;
    document.head.appendChild(s);
  }
}

function esc(s: string): string { return s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] || c)); }
