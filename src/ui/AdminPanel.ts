/* AdminPanel — owner-only prize payout console, shown with ?admin=1.
   Zero cost when the flag is absent (GameEngine never constructs it).
   Lists auto-selected pending winners; the treasury owner sends each prize
   from their own wallet. No funds are ever moved automatically. */
import { Payouts, type Payout } from "../net/Payouts";
import { WalletManager, shortAddr } from "../net/WalletManager";
import { TREASURY_ADDRESS } from "../config";

export class AdminPanel {
  private el: HTMLElement;

  constructor(private payouts: Payouts, private wallet: WalletManager) {
    const el = document.createElement("div");
    el.id = "adminPanel";
    el.style.cssText = [
      "position:fixed", "inset:0", "z-index:40", "background:rgba(3,3,18,.97)",
      "color:#fff", "overflow-y:auto", "padding:24px 18px",
      "font-family:inherit", "-webkit-backdrop-filter:blur(4px)", "backdrop-filter:blur(4px)",
    ].join(";");
    document.body.appendChild(el);
    this.el = el;
    this.wallet.onChange(() => this.render());
    this.render();
  }

  private async render(): Promise<void> {
    const addr = this.wallet.getAddress();
    const head = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
        <h2 style="letter-spacing:4px;font-weight:800;font-size:16px">SUPER NOVUS — PAIEMENTS</h2>
        <a href="/" style="color:#8b93b8;font-size:12px;text-decoration:none">↩ jeu</a>
      </div>
      <div style="font-size:11px;color:#8b93b8;margin-bottom:18px">Trésorerie ${shortAddr(TREASURY_ADDRESS)} · wallet connecté ${addr ? shortAddr(addr) : "aucun"}</div>`;

    if (!this.payouts.available) {
      this.el.innerHTML = head + `<div style="color:#f5c542">Supabase non configuré — impossible de charger les paiements.</div>`;
      return;
    }
    if (!this.payouts.isTreasury()) {
      this.el.innerHTML = head +
        `<div style="font-size:13px;color:#f5c542;line-height:1.6;margin-bottom:14px">Connecte le <b>wallet trésorerie</b> (${shortAddr(TREASURY_ADDRESS)}) pour voir et payer les gains.</div>
         <button id="adminConnect" style="pointer-events:auto;padding:11px 22px;border:none;border-radius:10px;
           background:linear-gradient(180deg,#FFEDB0,#F5C542 60%,#D89B1E);color:#050418;font-weight:800;cursor:pointer">CONNECTER LE WALLET</button>
         <div id="adminConnErr" style="font-size:11px;color:#e0708a;margin-top:10px"></div>`;
      const cb = this.el.querySelector("#adminConnect") as HTMLButtonElement | null;
      cb?.addEventListener("click", async () => {
        cb.disabled = true; cb.textContent = "Connexion…";
        try { await this.wallet.connect(); /* onChange re-renders */ }
        catch (e) {
          const err = this.el.querySelector("#adminConnErr");
          if (err) err.textContent = e instanceof Error ? e.message : String(e);
          cb.disabled = false; cb.textContent = "CONNECTER LE WALLET";
        }
      });
      return;
    }

    this.el.innerHTML = head + `<div style="font-size:12px;color:#8b93b8">Chargement…</div>`;
    const pending = await this.payouts.listPending();
    this.el.innerHTML = head;
    if (!pending.length) {
      this.el.innerHTML += `<div style="color:#9fdc8a">Aucun paiement en attente. ✓</div>`;
      return;
    }
    for (const p of pending) this.el.appendChild(this.row(p));
  }

  private row(p: Payout): HTMLElement {
    const amount = this.payouts.defaultPrizeCRO(p.period_type);
    const row = document.createElement("div");
    row.style.cssText = "border:1px solid rgba(140,170,255,.2);border-radius:12px;padding:14px;margin-bottom:12px;background:rgba(8,12,30,.5)";
    row.innerHTML = `
      <div style="font-weight:700;letter-spacing:2px">${p.period_type === "weekly" ? "🏆 SEMAINE" : "🏆 MOIS"} · ${p.period_start}</div>
      <div style="font-size:12px;color:#c8cfe8;margin:6px 0">Gagnant <b>${shortAddr(p.wallet)}</b> — score ${p.best_score.toLocaleString("fr-FR")}</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <input class="amt" type="number" value="${amount}" min="0" step="1"
          style="width:100px;padding:9px;border-radius:8px;background:#0a0e24;color:#fff;border:1px solid #2a3a6a;font-family:inherit">
        <span style="color:#8b93b8;font-size:12px">CRO</span>
        <button class="pay" style="pointer-events:auto;padding:9px 18px;border:none;border-radius:8px;
          background:linear-gradient(180deg,#FFEDB0,#F5C542 60%,#D89B1E);color:#050418;font-weight:800;cursor:pointer">PAYER</button>
      </div>
      <div class="status" style="font-size:11px;color:#8b93b8;margin-top:8px"></div>`;

    const input = row.querySelector(".amt") as HTMLInputElement;
    const btn = row.querySelector(".pay") as HTMLButtonElement;
    const status = row.querySelector(".status") as HTMLElement;
    btn.addEventListener("click", async () => {
      const amt = Number(input.value);
      if (!(amt > 0)) { status.textContent = "Entre un montant CRO supérieur à 0."; return; }
      if (!confirm(`Envoyer ${amt} CRO à ${shortAddr(p.wallet)} ?`)) return;
      btn.disabled = true; status.textContent = "Paiement en cours — confirme dans ton wallet…";
      try {
        const tx = await this.payouts.pay(p, amt);
        status.textContent = `Payé ✓ — tx ${tx.slice(0, 12)}…`;
        btn.textContent = "PAYÉ"; btn.style.filter = "grayscale(.4)";
      } catch (e) {
        status.textContent = "Échec : " + (e instanceof Error ? e.message : String(e));
        btn.disabled = false;
      }
    });
    return row;
  }
}
