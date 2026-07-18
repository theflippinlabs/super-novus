/* Diagnostics — ?diag=1 end-to-end score-pipeline check, ON DEVICE, nothing hidden.
   Opening super-novus.vercel.app/?diag=1 shows exactly which stage fails:
   environment config, Supabase client, table + RLS read, the submit-score Edge
   Function (deployed? JWT-protected?), wallet auth, and a REAL signed submission
   with the exact server response. Zero cost unless the flag is present. */
import { Leaderboard } from "../net/Leaderboard";
import { WalletManager, shortAddr } from "../net/WalletManager";
import { SUPPORTED_CHAIN_ID } from "../config";

export class Diagnostics {
  private el: HTMLElement;

  constructor(private lb: Leaderboard, private wallet: WalletManager) {
    const el = document.createElement("div");
    el.id = "diagPanel";
    el.style.cssText = [
      "position:fixed", "inset:0", "z-index:45", "overflow-y:auto",
      "background:rgba(3,4,14,.97)", "color:#e7ecff", "padding:18px 16px 40px",
      "font-family:ui-monospace,Menlo,monospace", "font-size:12px", "line-height:1.5",
      "-webkit-backdrop-filter:blur(4px)", "backdrop-filter:blur(4px)",
    ].join(";");
    document.body.appendChild(el);
    this.el = el;
    this.wallet.onChange(() => this.render());
    this.render();
  }

  private line(label: string, ok: boolean | null, detail: string): string {
    const mark = ok === null ? "•" : ok ? "✓" : "✗";
    const col = ok === null ? "#8b93b8" : ok ? "#9fdc8a" : "#ff8095";
    return `<div style="margin:7px 0;border-bottom:1px solid rgba(255,255,255,.06);padding-bottom:7px">
      <span style="color:${col};font-weight:800">${mark} ${esc(label)}</span>
      <div style="color:#c4cbe8;word-break:break-word;margin-top:2px">${esc(detail)}</div></div>`;
  }

  private async render(): Promise<void> {
    const head = `
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px">
        <b style="letter-spacing:2px;font-size:14px">SUPER NOVUS — DIAGNOSTIC</b>
        <a href="/" style="color:#8b93b8;text-decoration:none">↩ jeu</a>
      </div>
      <div style="color:#8b93b8;margin-bottom:12px">Pipeline de soumission des scores — rien n'est masqué.</div>`;
    this.el.innerHTML = head + `<div style="color:#8b93b8">Analyse en cours…</div>`;

    const cfg = this.lb.configInfo();
    const addr = this.wallet.getAddress();
    const chain = this.wallet.getChainId();

    // Run the network checks in parallel, each with a timeout so the panel never
    // hangs if Supabase is slow/unreachable — it reports "timeout" instead.
    const [table, probe] = await Promise.all([
      withTimeout(this.lb.tableCheck(), 9000, { ok: false, message: "délai dépassé — Supabase injoignable" }),
      withTimeout(this.lb.probeFunction(), 9000, { ok: false, status: null as number | null, reason: "délai dépassé — injoignable" }),
    ]);

    let html = head;
    html += this.line("Environnement", true,
      `URL ${cfg.usingEnvUrl ? "(env Vercel)" : "(défaut intégré)"} : ${cfg.url}\nClé : ${cfg.keyMasked} ${cfg.usingEnvKey ? "(env Vercel)" : "(défaut intégré)"}`);
    html += this.line("Client Supabase", this.lb.available, this.lb.available ? "initialisé" : "NON configuré (URL/clé absente)");
    html += this.line("Table sn_leaderboard + RLS (lecture)", table.ok,
      table.ok ? "lecture autorisée ✓" : `ÉCHEC : ${table.message || "?"}${table.code ? ` [${table.code}]` : ""}\n→ ${table.hint || ""}`);
    html += this.line("Edge Function submit-score", probe.ok, `${probe.reason}${probe.status ? ` (HTTP ${probe.status})` : ""}`);
    html += this.line("Wallet", Boolean(addr),
      addr ? `connecté ${shortAddr(addr)} · réseau ${chain === SUPPORTED_CHAIN_ID ? "Cronos ✓" : chain ?? "?"}` : "NON connecté (nécessaire pour soumettre)");

    // Actions
    html += `<div style="margin-top:14px;display:flex;flex-direction:column;gap:9px">`;
    if (!addr) {
      html += `<button id="dgConnect" class="dgBtn">CONNECTER LE WALLET</button>`;
    }
    html += `<button id="dgSubmit" class="dgBtn dgGold"${addr ? "" : " disabled"}>TESTER UNE SOUMISSION RÉELLE</button>`;
    html += `<div id="dgResult" style="color:#c4cbe8;white-space:pre-wrap;word-break:break-word;margin-top:4px"></div>`;
    html += `</div>`;
    html += `<style>
      .dgBtn{pointer-events:auto;font-family:inherit;font-size:12px;font-weight:800;letter-spacing:1px;padding:13px;border-radius:11px;
        color:#dfe6ff;background:rgba(40,50,100,.6);border:1px solid rgba(150,170,255,.4);cursor:pointer}
      .dgBtn:disabled{opacity:.45;cursor:default}
      .dgGold{color:#241a00;background:linear-gradient(180deg,#FFEDB0,#F0B429);border:none}
    </style>`;

    this.el.innerHTML = html;

    const conn = this.el.querySelector("#dgConnect") as HTMLButtonElement | null;
    conn?.addEventListener("click", async () => {
      conn.disabled = true; conn.textContent = "Connexion…";
      try { await this.wallet.connect(); } catch (e) { this.result(`Connexion échouée : ${msg(e)}`); conn.disabled = false; conn.textContent = "CONNECTER LE WALLET"; }
    });

    const sub = this.el.querySelector("#dgSubmit") as HTMLButtonElement | null;
    sub?.addEventListener("click", async () => {
      sub.disabled = true; sub.textContent = "Test en cours (signe dans le wallet)…";
      this.result("1) Signature demandée…\n");
      const ok = await this.lb.submit(1, 1, 0, 0);   // real signed submit (score 1)
      if (ok) {
        this.result("✓ SOUMISSION RÉUSSIE — le pipeline fonctionne.\nRécupération du classement…");
        const [w, m] = await Promise.all([this.lb.myRank("weekly"), this.lb.myRank("monthly")]);
        this.result(`✓ SOUMISSION RÉUSSIE — le pipeline fonctionne de bout en bout.\nRang hebdo : ${w ?? "—"}   ·   Rang mensuel : ${m ?? "—"}`);
      } else {
        this.result(`✗ ÉCHEC : ${this.lb.lastSubmitReason || "raison inconnue"}\n\nRegarde la ligne « Edge Function » ci-dessus : si elle est NON DÉPLOYÉE (404) ou protégée JWT (401), c'est la cause. Sinon, si la signature a été refusée, réessaie et approuve dans le wallet.`);
      }
      sub.disabled = false; sub.textContent = "TESTER UNE SOUMISSION RÉELLE";
    });
  }

  private result(text: string): void {
    const r = this.el.querySelector("#dgResult");
    if (r) r.textContent = text;
  }
}

function esc(s: string): string { return String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] || c)); }
function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }
function withTimeout<T>(pr: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([pr, new Promise<T>((res) => setTimeout(() => res(fallback), ms))]);
}
