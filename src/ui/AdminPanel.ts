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
import { Accounting, type AccountingSummary, type AcctTx } from "../net/Accounting";
import { WalletManager, shortAddr } from "../net/WalletManager";
import { generateNickname } from "./Identity";
import { generateAvatar } from "./Avatar";
import { TREASURY_ADDRESS, WEEKLY_PRIZE_USD, MONTHLY_PRIZE_USD } from "../config";

export class AdminPanel {
  private el: HTMLElement;
  private lastCsv: AcctTx[] = [];
  /** Admin code kept in memory for the open session only — never persisted to
      storage (clear-text secret storage is a security anti-pattern). Typed once
      per admin session. */
  private grantSecret = "";

  constructor(
    private payouts: Payouts,
    private wallet: WalletManager,
    private prizePool: PrizePool,
    private leaderboard: Leaderboard,
    private accounting: Accounting,
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

    const [pool, acct, pending, recent, weekN, monthN, topW, topM] = await Promise.all([
      this.prizePool.compute().catch(() => this.prizePool.staticPool()),
      this.accounting.summary().catch(() => null),
      this.payouts.listPending().catch(() => [] as Payout[]),
      this.payouts.listRecent(6).catch(() => [] as Payout[]),
      this.leaderboard.count("weekly").catch(() => 0),
      this.leaderboard.count("monthly").catch(() => 0),
      this.leaderboard.top("weekly", 50).catch(() => [] as BoardRow[]),
      this.leaderboard.top("monthly", 50).catch(() => [] as BoardRow[]),
    ]);

    // Merge weekly + monthly into a single per-wallet player list (best score kept).
    const byWallet = new Map<string, BoardRow>();
    for (const r of [...topW, ...topM]) {
      const k = r.wallet.toLowerCase();
      const ex = byWallet.get(k);
      if (!ex || r.score > ex.score) byWallet.set(k, r);
    }
    const players = [...byWallet.values()].sort((a, b) => b.score - a.score);

    this.lastCsv = acct?.txs ?? [];
    const body = this.el.querySelector("#admBody");
    if (!body) return;
    body.innerHTML =
      this.kpis(pool, pending.length, weekN, monthN) +
      this.financeSection(acct) +
      this.grantSection() +
      this.pendingSection(pending) +
      this.playersSection(players) +
      this.standingsSection(topW.slice(0, 5), topM.slice(0, 5)) +
      this.recentSection(recent);

    this.bindPending(pending);
    this.bindFinance();
    this.bindGrant();
    this.bindPlayers();
  }

  /* ----------------------------- players ----------------------------- */
  private playersSection(players: BoardRow[]): string {
    if (!players.length) {
      return `<div class="admSection"><div class="admSecH">Joueurs</div>
        <div class="admMuted admPad">Aucun joueur classé pour l'instant.</div></div>`;
    }
    const rows = players.map((p) => `
      <div class="admPlayer" data-w="${p.wallet.replace(/[^0-9a-fA-Fx]/g, "")}">
        <img class="admPAv" src="${escapeHtml(generateAvatar(p.wallet, 64))}" alt="">
        <div class="admPInfo">
          <div class="admPName">${escapeHtml(generateNickname(p.wallet))}</div>
          <div class="admPSub">${shortAddr(p.wallet)} · ${this.fr(p.score)} pts · ${this.fr(p.dist)} m · ${this.fr(p.dust)} ✨</div>
        </div>
        <button class="admPGift" title="Offrir des Big Bangs (tu choisis le nombre)">🎁</button>
        <button class="admPBan" title="Disqualifier (retirer du classement)">🚫</button>
      </div>`).join("");
    return `
      <div class="admSection">
        <div class="admSecH">Joueurs <span class="admCount">${players.length}</span></div>
        <div class="admMuted" style="margin:-4px 0 10px">🎁 offrir des Big Bangs (tu choisis le nombre) · 🚫 disqualifier un tricheur (retire son score)</div>
        <div class="admPlayers">${rows}</div>
      </div>`;
  }

  private bindPlayers(): void {
    for (const row of Array.from(this.el.querySelectorAll<HTMLElement>(".admPlayer"))) {
      const wallet = row.dataset.w || "";
      const name = row.querySelector(".admPName")?.textContent || shortAddr(wallet);
      const gift = row.querySelector(".admPGift") as HTMLButtonElement | null;
      const ban = row.querySelector(".admPBan") as HTMLButtonElement | null;

      gift?.addEventListener("click", async () => {
        const n = Math.floor(Number(prompt(`Combien de Big Bangs offrir à ${name} ? (1 à 90)`, "3")));
        if (!(n >= 1 && n <= 90)) return;   // cancelled or invalid
        const secret = this.askSecret(); if (!secret) return;
        gift.disabled = true; const prev = gift.textContent; gift.textContent = "…";
        try {
          await this.payouts.grantBigBang(wallet, n, "admin gift", secret);
          this.grantSecret = secret;
          gift.textContent = "✓";
          setTimeout(() => { gift.textContent = prev; gift.disabled = false; }, 1400);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/incorrect/i.test(msg)) this.grantSecret = "";
          alert("Échec : " + msg); gift.textContent = prev; gift.disabled = false;
        }
      });

      ban?.addEventListener("click", async () => {
        if (!confirm(`Disqualifier ${name} ?\nSon score sera retiré du classement (semaine + mois).`)) return;
        const secret = this.askSecret(); if (!secret) return;
        ban.disabled = true; ban.textContent = "…";
        try {
          await this.payouts.removePlayer(wallet, secret);
          this.grantSecret = secret;
          row.style.transition = "opacity .3s"; row.style.opacity = ".35";
          ban.textContent = "✓";
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (/incorrect/i.test(msg)) this.grantSecret = "";
          alert("Échec : " + msg); ban.textContent = "🚫"; ban.disabled = false;
        }
      });
    }
  }

  /** The admin code, from memory or a one-time prompt (never persisted). */
  private askSecret(): string {
    if (!this.grantSecret) this.grantSecret = (prompt("Code admin (défini dans Supabase → ADMIN_SECRET) :") || "").trim();
    return this.grantSecret;
  }

  /* ---------------------- distribute free Big Bangs ---------------------- */
  private grantSection(): string {
    return `
      <div class="admSection">
        <div class="admSecH">Offrir des Big Bangs (promo)</div>
        <div class="admGrant">
          <input id="admGWallet" class="admGInput" placeholder="Adresse wallet du destinataire (0x…)" autocomplete="off" spellcheck="false">
          <div class="admGRow">
            <input id="admGCredits" class="admGInput admGNum" type="number" min="1" max="90" value="3" inputmode="numeric">
            <span class="admGUnit">Big Bangs <em>(3 = une partie)</em></span>
          </div>
          <input id="admGNote" class="admGInput" placeholder="Note — ex : promo lancement (optionnel)" autocomplete="off">
          <button id="admGrantBtn" class="admBtn admBtnGold">🎁 OFFRIR</button>
          <div id="admGStatus" class="admStatus"></div>
          <div class="admHint">Le destinataire reçoit ses Big Bangs à sa prochaine ouverture du jeu, connecté avec ce wallet.</div>
        </div>
      </div>`;
  }

  private bindGrant(): void {
    const btn = this.el.querySelector("#admGrantBtn") as HTMLButtonElement | null;
    if (!btn) return;
    btn.addEventListener("click", async () => {
      const w = (this.el.querySelector("#admGWallet") as HTMLInputElement).value.trim();
      const credits = Number((this.el.querySelector("#admGCredits") as HTMLInputElement).value);
      const note = (this.el.querySelector("#admGNote") as HTMLInputElement).value.trim();
      const status = this.el.querySelector("#admGStatus") as HTMLElement;
      if (!/^0x[0-9a-fA-F]{40}$/.test(w)) { status.className = "admStatus admStatusErr"; status.textContent = "Adresse wallet invalide (0x… 40 caractères)."; return; }
      if (!(credits >= 1 && credits <= 90)) { status.className = "admStatus admStatusErr"; status.textContent = "Nombre de Big Bangs : entre 1 et 90."; return; }
      const secret = this.askSecret(); if (!secret) return;
      btn.disabled = true; status.className = "admStatus"; status.textContent = "Envoi…";
      try {
        await this.payouts.grantBigBang(w, credits, note, secret);
        this.grantSecret = secret;   // remember for this session only (in memory)
        status.className = "admStatus admStatusOk";
        status.textContent = `Offert ✓ — ${credits} Big Bang(s) à ${shortAddr(w)}.`;
        (this.el.querySelector("#admGWallet") as HTMLInputElement).value = "";
        (this.el.querySelector("#admGNote") as HTMLInputElement).value = "";
        btn.disabled = false;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/admin/i.test(msg) && /incorrect/i.test(msg)) this.grantSecret = "";
        status.className = "admStatus admStatusErr"; status.textContent = "Échec : " + msg;
        btn.disabled = false;
      }
    });
  }

  /* --------------------------- finance / compta --------------------------- */
  private financeSection(a: AccountingSummary | null): string {
    if (!a) return "";
    const usd = (cro: number) => a.croUsd !== null ? ` <em>(${this.fr(cro * a.croUsd)} $)</em>` : "";
    const bal = a.balanceCRO !== null ? `${this.fr(a.balanceCRO)} CRO${usd(a.balanceCRO)}` : "indisponible";
    const rows = a.txs.slice(0, 12).map((t) => `
      <div class="admLedRow">
        <span class="admLedDate">${(t.date || "").slice(0, 10)}</span>
        <span class="admLedLbl">${t.type === "in" ? "▲" : "▼"} ${t.label}</span>
        <span class="admLedWho">${shortAddr(t.wallet)}</span>
        <span class="admLedAmt ${t.type === "in" ? "admIn" : "admOut"}">${t.type === "in" ? "+" : "−"}${this.fr(t.amountCRO)} CRO</span>
      </div>`).join("") || `<div class="admMuted admPad">Aucune transaction enregistrée pour l'instant.</div>`;
    return `
      <div class="admSection">
        <div class="admSecH">Trésorerie & Compta</div>
        <div class="admBalance">
          <div class="admBalL">Solde du compte trésorerie</div>
          <div class="admBalV">${bal}</div>
          <div class="admBalAddr">${shortAddr(TREASURY_ADDRESS)}</div>
        </div>
        <div class="admBilan">
          <div class="admBil admBilIn">
            <div class="admBilV">+${this.fr(a.revenueTotalCRO)} CRO</div>
            <div class="admBilL">Encaissé (Big Bang)</div>
            <div class="admBilSub">${a.revenueCount} ventes · ${this.fr(a.revenueMonthCRO)} ce mois</div>
          </div>
          <div class="admBil admBilOut">
            <div class="admBilV">−${this.fr(a.paidTotalCRO)} CRO</div>
            <div class="admBilL">Prix versés</div>
            <div class="admBilSub">${a.paidCount} payés · ${a.pendingCount} en attente</div>
          </div>
          <div class="admBil admBilNet">
            <div class="admBilV">${a.netCRO >= 0 ? "+" : ""}${this.fr(a.netCRO)} CRO</div>
            <div class="admBilL">Résultat net</div>
            <div class="admBilSub">encaissé − versé</div>
          </div>
        </div>
        <button id="admCsv" class="admBtn admBtnGhost">⬇ Exporter la compta (CSV)</button>
        <div class="admLedger">${rows}</div>
      </div>`;
  }

  private bindFinance(): void {
    this.el.querySelector("#admCsv")?.addEventListener("click", () => {
      const csv = this.accounting.toCSV(this.lastCsv);
      const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `super-novus-compta-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
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
      .admBalance{background:radial-gradient(130% 200% at 0% 0%,rgba(245,197,66,.16),transparent 55%),linear-gradient(180deg,rgba(40,32,12,.6),rgba(20,16,8,.6));
        border:1px solid rgba(245,197,66,.36);border-radius:16px;padding:16px;text-align:center;margin-bottom:12px}
      .admBalL{font-size:10px;letter-spacing:1.5px;color:#d8c58a;font-weight:700;text-transform:uppercase}
      .admBalV{font-size:26px;font-weight:800;color:#ffe9a8;margin:6px 0 2px;font-variant-numeric:tabular-nums;word-break:break-word}
      .admBalV em{font-style:normal;font-size:14px;color:#c9b88a}
      .admBalAddr{font-size:11px;color:#8b93b8;font-family:ui-monospace,Menlo,monospace}
      .admBilan{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px}
      .admBil{background:rgba(16,20,44,.6);border:1px solid rgba(140,170,255,.14);border-radius:14px;padding:11px 8px;text-align:center;min-width:0}
      .admBilIn{border-color:rgba(120,220,120,.3)}
      .admBilOut{border-color:rgba(224,112,138,.3)}
      .admBilNet{border-color:rgba(245,197,66,.3)}
      .admBilV{font-size:14px;font-weight:800;font-variant-numeric:tabular-nums;word-break:break-word}
      .admBilIn .admBilV{color:#9fdc8a}.admBilOut .admBilV{color:#e88aa0}.admBilNet .admBilV{color:var(--gold,#f5c542)}
      .admBilL{font-size:9px;letter-spacing:.5px;color:#8fa0d8;font-weight:700;margin-top:4px;text-transform:uppercase}
      .admBilSub{font-size:8.5px;color:#6f7aa0;margin-top:3px}
      .admBtnGhost{width:100%;margin-bottom:12px;background:rgba(20,26,58,.6);border:1px solid rgba(140,170,255,.3);color:#cfd8ff;font-weight:700}
      .admLedger{display:flex;flex-direction:column;gap:4px}
      .admLedRow{display:flex;align-items:center;gap:8px;padding:8px 10px;background:rgba(14,18,40,.5);border-radius:9px;font-size:11.5px}
      .admLedDate{color:#8b93b8;font-variant-numeric:tabular-nums;flex-shrink:0;width:66px}
      .admLedLbl{flex:1;min-width:0;color:#dfe6ff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .admLedWho{color:#8fa0d8;flex-shrink:0}
      .admLedAmt{font-weight:800;font-variant-numeric:tabular-nums;flex-shrink:0}
      .admLedAmt.admIn{color:#9fdc8a}.admLedAmt.admOut{color:#e88aa0}
      .admGrant{display:flex;flex-direction:column;gap:9px;background:linear-gradient(180deg,rgba(52,34,96,.4),rgba(20,16,44,.5));
        border:1px solid rgba(170,130,255,.34);border-radius:16px;padding:14px}
      .admGInput{pointer-events:auto;font-family:inherit;font-size:14px;color:#fff;background:#0a0e24;
        border:1px solid #2a3a6a;border-radius:10px;padding:11px 12px;width:100%;outline:none}
      .admGInput::placeholder{color:#6f7aa0}
      .admGRow{display:flex;align-items:center;gap:10px}
      .admGNum{width:88px;flex-shrink:0;font-weight:800;text-align:center}
      .admGUnit{font-size:12px;color:#c9b8ff;font-weight:700}
      .admGUnit em{font-style:normal;color:#8fa0d8;font-weight:400}
      .admPlayers{display:flex;flex-direction:column;gap:8px}
      .admPlayer{display:flex;align-items:center;gap:10px;padding:9px 11px;background:rgba(16,20,44,.55);
        border:1px solid rgba(140,170,255,.14);border-radius:13px}
      .admPAv{width:38px;height:38px;border-radius:11px;flex-shrink:0;object-fit:cover;background:#0a0e24;border:1px solid rgba(140,170,255,.25)}
      .admPInfo{flex:1;min-width:0}
      .admPName{font-size:13px;font-weight:800;color:#eaf0ff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .admPSub{font-size:10.5px;color:#8fa0d8;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .admPGift,.admPBan{pointer-events:auto;cursor:pointer;flex-shrink:0;width:38px;height:38px;border-radius:11px;
        font-size:17px;font-family:inherit;border:1px solid rgba(140,170,255,.22);background:rgba(24,30,60,.7)}
      .admPGift{border-color:rgba(170,130,255,.4)}
      .admPBan{border-color:rgba(224,112,138,.4)}
      .admPGift:active,.admPBan:active{transform:scale(.92)}
      @media(prefers-reduced-motion:reduce){.admOverlay{backdrop-filter:none}}
    `;
    document.head.appendChild(s);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c] || c));
}
