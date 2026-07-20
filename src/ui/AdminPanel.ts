/* AdminPanel — owner-only mission-control console, shown with ?admin=1 (or via the
   discreet "Admin — Payouts" button in the profile when the treasury wallet is
   connected). Zero cost when the flag is absent (GameEngine never constructs it).

   A complete dashboard, not just a payout list:
     • Overview KPIs — monthly prize pool, Big Bang revenue, community bonus,
       players this week/month, pending payouts, live CRO price.
     • Pending payouts — auto-selected winners; the owner sends each prize FROM
       their own wallet (no key ever held by the app), amount pre-filled.
     • Live standings — current weekly + monthly top players.
     • Recent winners — the last paid/pending payouts with Cronoscan links.
   All figures come from the real backend (Supabase + live price); it fails soft
   (shows “—”/0) when offline. */
import { Payouts, type Payout } from "../net/Payouts";
import { PrizePool, type PoolInfo } from "../net/PrizePool";
import { Leaderboard, type BoardRow } from "../net/Leaderboard";
import { WalletManager, shortAddr } from "../net/WalletManager";
import { TREASURY_ADDRESS, WEEKLY_PRIZE_USD, MONTHLY_PRIZE_USD } from "../config";

export class AdminPanel {
  private el: HTMLElement;

  constructor(
    private payouts: Payouts,
    private wallet: WalletManager,
    private prizePool: PrizePool,
    private leaderboard: Leaderboard,
  ) {
    this.injectStyles();
    const el = document.createElement("div");
    el.id = "adminPanel";
    el.className = "admOverlay";
    document.body.appendChild(el);
    this.el = el;
    this.wallet.onChange(() => this.render());
    this.render();
  }

  private fr(n: number): string { return Math.round(n || 0).toLocaleString("fr-FR"); }
  private croLine(cro: number | null, usd?: number): string {
    if (cro === null || cro === undefined) return usd ? `${this.fr(usd)} $` : "—";
    return `≈ ${this.fr(cro)} CRO`;
  }

  private header(addr: string | null): string {
    const isT = !!addr && addr.toLowerCase() === TREASURY_ADDRESS.toLowerCase();
    const chip = isT
      ? `<span class="admChip admChipOk"><span class="admDot"></span>Trésorerie connectée · ${shortAddr(addr!)}</span>`
      : `<span class="admChip admChipWarn">Wallet non-trésorerie</span>`;
    return `
      <div class="admHead">
        <div class="admHeadTop">
          <button id="admBack" class="admIconBtn" aria-label="Retour au jeu">‹</button>
          <div class="admTitleWrap">
            <div class="admKicker">SUPER NOVUS</div>
            <div class="admTitle">CONSOLE ADMIN</div>
          </div>
          <button id="admRefresh" class="admIconBtn" aria-label="Rafraîchir">⟳</button>
        </div>
        <div class="admChips">${chip}<span class="admChip">Trésorerie ${shortAddr(TREASURY_ADDRESS)}</span></div>
      </div>`;
  }

  private async render(): Promise<void> {
    const addr = this.wallet.getAddress();

    if (!this.payouts.available) {
      this.el.innerHTML = this.header(addr) +
        `<div class="admBody"><div class="admNotice admWarn">Supabase non configuré — impossible de charger le tableau de bord.</div></div>`;
      this.bindChrome();
      return;
    }

    if (!this.payouts.isTreasury()) {
      this.el.innerHTML = this.header(addr) + `
        <div class="admBody">
          <div class="admCard admConnect">
            <div class="admLockIc">🔐</div>
            <h3 class="admCardH">Accès réservé à la trésorerie</h3>
            <p class="admMuted">Connecte le wallet trésorerie<br><b>${shortAddr(TREASURY_ADDRESS)}</b> pour gérer la cagnotte et payer les gagnants.</p>
            <button id="admConnect" class="admBtn admBtnGold">CONNECTER LE WALLET</button>
            <div id="admConnErr" class="admErr"></div>
          </div>
        </div>`;
      this.bindChrome();
      const cb = this.el.querySelector("#admConnect") as HTMLButtonElement | null;
      cb?.addEventListener("click", async () => {
        cb.disabled = true; cb.textContent = "Connexion…";
        try { await this.wallet.connect(); /* onChange re-renders */ }
        catch (e) {
          const err = this.el.querySelector("#admConnErr");
          if (err) err.textContent = e instanceof Error ? e.message : String(e);
          cb.disabled = false; cb.textContent = "CONNECTER LE WALLET";
        }
      });
      return;
    }

    // Treasury connected — show the dashboard shell, then hydrate with live data.
    this.el.innerHTML = this.header(addr) + `<div class="admBody" id="admBody"><div class="admLoading">Chargement du tableau de bord…</div></div>`;
    this.bindChrome();

    const [pool, pending, recent, weekN, monthN, topW, topM] = await Promise.all([
      this.prizePool.compute().catch(() => this.prizePool.staticPool()),
      this.payouts.listPending().catch(() => [] as Payout[]),
      this.payouts.listRecent(6).catch(() => [] as Payout[]),
      this.leaderboard.count("weekly").catch(() => 0),
      this.leaderboard.count("monthly").catch(() => 0),
      this.leaderboard.top("weekly", 5).catch(() => [] as BoardRow[]),
      this.leaderboard.top("monthly", 5).catch(() => [] as BoardRow[]),
    ]);

    const body = this.el.querySelector("#admBody");
    if (!body) return;
    body.innerHTML =
      this.kpis(pool, pending.length, weekN, monthN) +
      this.pendingSection(pending) +
      this.standingsSection(topW, topM) +
      this.recentSection(recent);

    this.bindPending(pending);
  }

  /* ------------------------------- KPIs ------------------------------- */
  private kpis(pool: PoolInfo, pendingCount: number, weekN: number, monthN: number): string {
    const monthlyTotalCRO = pool.monthlyGuaranteedCRO !== null
      ? pool.monthlyGuaranteedCRO + pool.bonusCRO : null;
    const price = pool.croUsd !== null ? `1 CRO ≈ ${pool.croUsd.toFixed(4)} $` : "prix indisponible";
    const tiles: Array<{ ic: string; label: string; val: string; sub?: string; hot?: boolean }> = [
      { ic: "🏆", label: "Cagnotte du mois", val: this.croLine(monthlyTotalCRO, MONTHLY_PRIZE_USD), sub: `${this.fr(MONTHLY_PRIZE_USD)} $ garantis + bonus` },
      { ic: "💥", label: "Revenus Big Bang (mois)", val: `${this.fr(pool.monthlyRevenueCRO)} CRO` },
      { ic: "🎁", label: "Bonus communauté (30%)", val: `${this.fr(pool.bonusCRO)} CRO` },
      { ic: "🥇", label: "Prix semaine", val: this.croLine(pool.weeklyCRO, WEEKLY_PRIZE_USD), sub: `${this.fr(WEEKLY_PRIZE_USD)} $ garantis` },
      { ic: "🎮", label: "Joueurs (semaine)", val: this.fr(weekN) },
      { ic: "🌙", label: "Joueurs (mois)", val: this.fr(monthN) },
      { ic: "⏳", label: "À payer", val: this.fr(pendingCount), hot: pendingCount > 0 },
      { ic: "📈", label: "Prix CRO", val: pool.croUsd !== null ? `${pool.croUsd.toFixed(4)} $` : "—", sub: price },
    ];
    return `
      <div class="admSection">
        <div class="admSecH">Vue d'ensemble</div>
        <div class="admKpiGrid">
          ${tiles.map((t) => `
            <div class="admKpi${t.hot ? " admKpiHot" : ""}">
              <div class="admKpiIc">${t.ic}</div>
              <div class="admKpiV">${t.val}</div>
              <div class="admKpiL">${t.label}</div>
              ${t.sub ? `<div class="admKpiSub">${t.sub}</div>` : ""}
            </div>`).join("")}
        </div>
      </div>`;
  }

  /* --------------------------- pending payouts --------------------------- */
  private pendingSection(pending: Payout[]): string {
    if (!pending.length) {
      return `
        <div class="admSection">
          <div class="admSecH">Paiements en attente</div>
          <div class="admEmpty">
            <div class="admEmptyIc">✓</div>
            <div class="admEmptyT">Aucun paiement en attente</div>
            <div class="admMuted">Les gagnants apparaîtront ici à la fin de chaque période.</div>
          </div>
        </div>`;
    }
    const rows = pending.map((p) => `
      <div class="admPay" data-id="${p.id}">
        <div class="admPayTop">
          <span class="admBadge ${p.period_type === "weekly" ? "admBadgeW" : "admBadgeM"}">${p.period_type === "weekly" ? "🏆 SEMAINE" : "👑 MOIS"}</span>
          <span class="admPayPeriod">${p.period_start}</span>
        </div>
        <div class="admPayWin">Gagnant <b>${shortAddr(p.wallet)}</b></div>
        <div class="admPayScore">Score ${this.fr(p.best_score)}</div>
        <div class="admPayRow">
          <input class="admAmt" type="number" value="" placeholder="calcul…" min="0" step="1" inputmode="numeric">
          <span class="admCro">CRO</span>
          <button class="admPayBtn admBtnGold">PAYER</button>
        </div>
        <div class="admHint"></div>
        <div class="admStatus"></div>
      </div>`).join("");
    return `
      <div class="admSection">
        <div class="admSecH">Paiements en attente <span class="admCount">${pending.length}</span></div>
        <div class="admPayList">${rows}</div>
      </div>`;
  }

  private bindPending(pending: Payout[]): void {
    for (const p of pending) {
      const row = this.el.querySelector(`.admPay[data-id="${p.id}"]`) as HTMLElement | null;
      if (!row) continue;
      const input = row.querySelector(".admAmt") as HTMLInputElement;
      const hint = row.querySelector(".admHint") as HTMLElement;
      const btn = row.querySelector(".admPayBtn") as HTMLButtonElement;
      const status = row.querySelector(".admStatus") as HTMLElement;

      this.payouts.suggestedPrizeCRO(p.period_type, p.period_start).then((amt) => {
        if (amt > 0 && !input.value) input.value = String(amt);
        hint.textContent = p.period_type === "weekly"
          ? `Suggestion : ≈ ${this.fr(WEEKLY_PRIZE_USD)} $ en CRO au taux du jour.`
          : `Suggestion : ≈ ${this.fr(MONTHLY_PRIZE_USD)} $ en CRO + 30 % des Big Bangs du mois.`;
      }).catch(() => { /* owner enters manually */ });

      btn.addEventListener("click", async () => {
        const amt = Number(input.value);
        if (!(amt > 0)) { status.textContent = "Entre un montant CRO supérieur à 0."; status.className = "admStatus admStatusErr"; return; }
        if (!confirm(`Envoyer ${this.fr(amt)} CRO à ${shortAddr(p.wallet)} ?`)) return;
        btn.disabled = true; input.disabled = true;
        status.className = "admStatus"; status.textContent = "Paiement en cours — confirme dans ton wallet…";
        try {
          const tx = await this.payouts.pay(p, amt);
          status.className = "admStatus admStatusOk";
          status.innerHTML = `Payé ✓ — <a href="https://cronoscan.com/tx/${tx}" target="_blank" rel="noopener" class="admTx">${tx.slice(0, 12)}…</a>`;
          btn.textContent = "PAYÉ"; btn.style.filter = "grayscale(.5)";
        } catch (e) {
          status.className = "admStatus admStatusErr";
          status.textContent = "Échec : " + (e instanceof Error ? e.message : String(e));
          btn.disabled = false; input.disabled = false;
        }
      });
    }
  }

  /* --------------------------- live standings --------------------------- */
  private standingsSection(topW: BoardRow[], topM: BoardRow[]): string {
    const list = (rows: BoardRow[]) => rows.length
      ? rows.map((r, i) => `
          <div class="admRank">
            <span class="admRankN">${["🥇", "🥈", "🥉"][i] ?? `#${i + 1}`}</span>
            <span class="admRankA">${r.nickname ? escapeHtml(r.nickname) : shortAddr(r.wallet)}</span>
            <span class="admRankS">${this.fr(r.score)}</span>
          </div>`).join("")
      : `<div class="admMuted admPad">Aucune entrée pour l'instant.</div>`;
    return `
      <div class="admSection">
        <div class="admSecH">Classement en direct</div>
        <div class="admTwoCol">
          <div class="admBoard">
            <div class="admBoardH">🏆 Semaine</div>
            ${list(topW)}
          </div>
          <div class="admBoard">
            <div class="admBoardH">👑 Mois</div>
            ${list(topM)}
          </div>
        </div>
      </div>`;
  }

  /* ---------------------------- recent winners ---------------------------- */
  private recentSection(recent: Payout[]): string {
    if (!recent.length) return "";
    const rows = recent.map((p) => {
      const paid = p.status !== "pending" && p.tx_hash;
      const badge = paid
        ? `<span class="admStatePill admPaid">Payé</span>`
        : `<span class="admStatePill admPending">En attente</span>`;
      const tx = paid ? `<a href="https://cronoscan.com/tx/${p.tx_hash}" target="_blank" rel="noopener" class="admTx">${p.tx_hash!.slice(0, 10)}…</a>` : "—";
      return `
        <div class="admRecRow">
          <span class="admRecPeriod">${p.period_type === "weekly" ? "🏆" : "👑"} ${p.period_start}</span>
          <span class="admRecWin">${shortAddr(p.wallet)}</span>
          ${badge}
          <span class="admRecTx">${tx}</span>
        </div>`;
    }).join("");
    return `
      <div class="admSection">
        <div class="admSecH">Historique des gagnants</div>
        <div class="admRecList">${rows}</div>
      </div>`;
  }

  /* ------------------------------- chrome ------------------------------- */
  private bindChrome(): void {
    this.el.querySelector("#admBack")?.addEventListener("click", () => { location.href = location.pathname; });
    this.el.querySelector("#admRefresh")?.addEventListener("click", () => this.render());
  }

  private injectStyles(): void {
    if (document.getElementById("admStyles")) return;
    const s = document.createElement("style");
    s.id = "admStyles";
    s.textContent = `
      .admOverlay{position:fixed;inset:0;z-index:40;overflow-y:auto;color:#eaf0ff;font-family:inherit;
        background:radial-gradient(ellipse at 50% -8%,rgba(60,44,120,.5),rgba(3,3,18,.985) 60%);
        -webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px)}
      .admHead{position:sticky;top:0;z-index:2;padding:max(14px,calc(env(safe-area-inset-top) + 10px)) 16px 12px;
        background:linear-gradient(180deg,rgba(6,7,22,.96),rgba(6,7,22,.72) 70%,transparent);
        -webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
      .admHeadTop{display:flex;align-items:center;gap:10px}
      .admTitleWrap{flex:1;text-align:center;min-width:0}
      .admKicker{font-size:9px;letter-spacing:5px;color:#8fa0d8;font-weight:700}
      .admTitle{font-size:16px;letter-spacing:3px;font-weight:800;color:#fff;margin-top:1px}
      .admIconBtn{pointer-events:auto;cursor:pointer;flex-shrink:0;width:38px;height:38px;border-radius:12px;
        border:1px solid rgba(140,170,255,.2);background:rgba(20,24,52,.6);color:#c8cfe8;font-size:18px;font-family:inherit}
      .admIconBtn:active{transform:scale(.94)}
      .admChips{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-top:10px}
      .admChip{font-size:10px;letter-spacing:.5px;color:#9fb0e0;background:rgba(20,26,58,.6);
        border:1px solid rgba(140,170,255,.16);border-radius:20px;padding:4px 10px;display:inline-flex;align-items:center;gap:6px}
      .admChipOk{color:#9fdc8a;border-color:rgba(120,220,120,.3);background:rgba(120,220,120,.08)}
      .admChipWarn{color:#f5c542;border-color:rgba(245,197,66,.3);background:rgba(245,197,66,.08)}
      .admDot{width:7px;height:7px;border-radius:50%;background:#4bd76b;box-shadow:0 0 8px #4bd76b}
      .admBody{max-width:560px;margin:0 auto;padding:8px 14px calc(env(safe-area-inset-bottom) + 40px)}
      .admLoading{text-align:center;color:#8b93b8;padding:40px 0;font-size:13px}
      .admSection{margin:18px 0}
      .admSecH{font-size:10px;letter-spacing:3px;color:#8fa0d8;font-weight:700;margin-bottom:10px;text-transform:uppercase;display:flex;align-items:center;gap:8px}
      .admCount{background:rgba(245,197,66,.16);color:var(--gold,#f5c542);border-radius:20px;font-size:10px;padding:1px 8px;letter-spacing:0}
      .admKpiGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
      @media(min-width:440px){.admKpiGrid{grid-template-columns:repeat(4,1fr)}}
      .admKpi{background:linear-gradient(180deg,rgba(18,22,48,.7),rgba(12,15,36,.7));border:1px solid rgba(140,170,255,.14);
        border-radius:16px;padding:13px 12px;min-width:0}
      .admKpiHot{border-color:rgba(245,197,66,.45);background:linear-gradient(180deg,rgba(60,48,20,.5),rgba(30,22,8,.5))}
      .admKpiIc{font-size:17px}
      .admKpiV{font-size:17px;font-weight:800;color:#fff;margin-top:5px;font-variant-numeric:tabular-nums;line-height:1.15;word-break:break-word}
      .admKpiL{font-size:9.5px;letter-spacing:.5px;color:#8fa0d8;font-weight:700;margin-top:3px;text-transform:uppercase}
      .admKpiSub{font-size:9.5px;color:#6f7aa0;margin-top:3px}
      .admCard{background:rgba(10,13,32,.7);border:1px solid rgba(140,170,255,.18);border-radius:18px;padding:22px 18px;text-align:center}
      .admConnect{max-width:360px;margin:30px auto}
      .admLockIc{font-size:34px}
      .admCardH{font-size:15px;font-weight:800;letter-spacing:1px;margin:10px 0 6px}
      .admMuted{color:#8b93b8;font-size:12.5px;line-height:1.6}
      .admPad{padding:10px 4px}
      .admBtn{pointer-events:auto;cursor:pointer;font-family:inherit;border:1px solid rgba(140,170,255,.4);
        background:rgba(30,40,80,.7);color:#dfe6ff;border-radius:12px;padding:12px 20px;font-weight:800;letter-spacing:1px;font-size:12px}
      .admBtnGold{border:none;background:linear-gradient(180deg,#FFEDB0,#F5C542 60%,#D89B1E);color:#050418}
      .admBtn:active{transform:scale(.98)}
      .admErr{color:#e0708a;font-size:11px;margin-top:10px}
      .admNotice{border-radius:12px;padding:12px 14px;font-size:12.5px;margin:20px 0}
      .admWarn{color:#f5c542;background:rgba(245,197,66,.08);border:1px solid rgba(245,197,66,.25)}
      .admEmpty{text-align:center;padding:26px 16px;background:rgba(12,16,38,.5);border:1px dashed rgba(140,170,255,.2);border-radius:16px}
      .admEmptyIc{width:46px;height:46px;line-height:46px;margin:0 auto 8px;border-radius:50%;font-size:22px;font-weight:800;color:#4bd76b;
        background:rgba(75,215,107,.12);border:1px solid rgba(75,215,107,.4)}
      .admEmptyT{font-size:14px;font-weight:800;color:#cfe8c8;margin-bottom:4px}
      .admPayList{display:flex;flex-direction:column;gap:12px}
      .admPay{background:linear-gradient(180deg,rgba(18,22,48,.72),rgba(12,15,36,.72));border:1px solid rgba(245,197,66,.28);
        border-radius:16px;padding:14px 14px}
      .admPayTop{display:flex;align-items:center;gap:8px;margin-bottom:8px}
      .admBadge{font-size:10px;font-weight:800;letter-spacing:1px;padding:4px 10px;border-radius:20px}
      .admBadgeW{color:#ffd98a;background:rgba(245,197,66,.14);border:1px solid rgba(245,197,66,.35)}
      .admBadgeM{color:#c9b8ff;background:rgba(160,120,255,.16);border:1px solid rgba(160,120,255,.4)}
      .admPayPeriod{font-size:11px;color:#8b93b8;font-variant-numeric:tabular-nums}
      .admPayWin{font-size:13px;color:#e6ebff}.admPayWin b{color:#fff}
      .admPayScore{font-size:12px;color:#9fb0e0;margin:2px 0 10px;font-variant-numeric:tabular-nums}
      .admPayRow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
      .admAmt{pointer-events:auto;width:110px;padding:10px;border-radius:10px;background:#0a0e24;color:#fff;
        border:1px solid #2a3a6a;font-family:inherit;font-size:14px;font-weight:700}
      .admCro{color:#8b93b8;font-size:12px}
      .admPayBtn{pointer-events:auto;cursor:pointer;border:none;border-radius:10px;padding:10px 20px;font-weight:800;
        letter-spacing:1px;font-size:12px;font-family:inherit;margin-left:auto}
      .admHint{font-size:11px;color:#8b93b8;margin-top:8px}
      .admStatus{font-size:11.5px;color:#9fb0e0;margin-top:6px;min-height:1px}
      .admStatusOk{color:#9fdc8a}.admStatusErr{color:#e0708a}
      .admTx{color:#9db8ff;text-decoration:underline}
      .admTwoCol{display:grid;grid-template-columns:1fr;gap:12px}
      @media(min-width:440px){.admTwoCol{grid-template-columns:1fr 1fr}}
      .admBoard{background:rgba(12,16,38,.55);border:1px solid rgba(140,170,255,.14);border-radius:14px;padding:12px}
      .admBoardH{font-size:11px;font-weight:800;letter-spacing:1px;color:#cfd8ff;margin-bottom:8px}
      .admRank{display:flex;align-items:center;gap:8px;padding:6px 4px;border-bottom:1px solid rgba(255,255,255,.05);font-size:12.5px}
      .admRank:last-child{border-bottom:none}
      .admRankN{width:26px;flex-shrink:0;font-weight:800}
      .admRankA{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#dfe6ff}
      .admRankS{color:var(--gold,#f5c542);font-weight:800;font-variant-numeric:tabular-nums}
      .admRecList{display:flex;flex-direction:column;gap:8px}
      .admRecRow{display:flex;align-items:center;gap:8px;padding:10px 12px;background:rgba(16,20,44,.5);
        border:1px solid rgba(140,170,255,.1);border-radius:12px;font-size:12px}
      .admRecPeriod{color:#c8cfe8;font-variant-numeric:tabular-nums;flex-shrink:0}
      .admRecWin{flex:1;min-width:0;color:#9fb0e0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .admStatePill{font-size:9px;font-weight:800;letter-spacing:1px;padding:3px 8px;border-radius:20px;flex-shrink:0}
      .admPaid{color:#9fdc8a;background:rgba(120,220,120,.12)}
      .admPending{color:#f5c542;background:rgba(245,197,66,.12)}
      .admRecTx{flex-shrink:0}
      @media(prefers-reduced-motion:reduce){.admOverlay{backdrop-filter:none}}
    `;
    document.head.appendChild(s);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] || c));
}
