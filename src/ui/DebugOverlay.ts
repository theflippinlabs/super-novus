/* DebugOverlay — enabled only with ?debug=1.
   Zero cost when disabled: GameEngine never constructs this class nor calls
   update() without the flag, so there is no DOM and no measurement otherwise. */
import { shortAddr } from "../net/WalletManager";
import { DRAW_CALL_BUDGET } from "../config";

export class DebugOverlay {
  private el: HTMLElement;
  private last = performance.now();
  private fps = 0;      // smoothed
  private ft = 0;       // smoothed frame time (ms)

  constructor() {
    const el = document.createElement("div");
    el.id = "debugOverlay";
    el.style.cssText = [
      "position:fixed", "left:8px", "bottom:8px", "z-index:20",
      "font:10px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace",
      "color:#8effc8", "background:rgba(2,4,12,.62)", "padding:7px 9px",
      "border:1px solid rgba(120,220,170,.22)", "border-radius:8px",
      "white-space:pre", "pointer-events:none", "text-shadow:0 0 6px rgba(0,0,0,.9)",
      "letter-spacing:.3px", "backdrop-filter:blur(3px)", "-webkit-backdrop-filter:blur(3px)",
    ].join(";");
    el.textContent = "debug…";
    document.body.appendChild(el);
    this.el = el;
  }

  update(game: any): void {
    const now = performance.now();
    const dt = now - this.last;
    this.last = now;
    // Exponential smoothing so the numbers stay readable.
    this.ft += ((dt) - this.ft) * 0.1;
    const instFps = dt > 0 ? 1000 / dt : 0;
    this.fps += (instFps - this.fps) * 0.1;

    const info = game.renderer.info;
    const calls = info.render.calls;
    const tris = info.render.triangles;
    const geos = info.memory.geometries;
    const texs = info.memory.textures;
    const heap = (performance as any).memory?.usedJSHeapSize;
    const heapMb = heap ? (heap / 1048576).toFixed(0) + "MB" : "n/a";

    const addr = game.wallet?.getAddress?.() ?? null;
    const wallet = addr ? shortAddr(addr) : "invité";
    const lbErr = game.leaderboard?.lastError;
    const net = (game.leaderboard?.available ? "supabase" : "offline") + (lbErr ? ` ⚠ ${lbErr}` : "");
    const seed = game.spawn?.seed ?? "—";
    const density = game._density ? game._density(game.level).toFixed(1) : "—";
    const activeObs = game.obstacles?.list?.length ?? 0;
    const activeParts = game.particles?.activeCount ? game.particles.activeCount() : 0;

    this.el.textContent =
      `SUPER NOVUS · debug\n` +
      `fps ${this.fps.toFixed(0).padStart(3)}  frame ${this.ft.toFixed(1)}ms\n` +
      `draws ${String(calls).padStart(3)}/${DRAW_CALL_BUDGET}  tris ${tris.toLocaleString("en-US")}\n` +
      `geo ${geos}  tex ${texs}  heap ${heapMb}\n` +
      `speed ${game.speed?.toFixed(1) ?? "—"}  lvl ${game.level ?? "—"}  dens ${density}\n` +
      `energy ${Math.round(game.energy ?? 0)}${game.charged ? " ⚡" : ""}\n` +
      `obstacles ${activeObs}  particles ${activeParts}\n` +
      `seed ${seed}\n` +
      `wallet ${wallet}  net ${net}`;
  }
}
