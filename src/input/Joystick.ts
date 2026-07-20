/* Joystick — Mode 2 virtual analog stick (bottom-left) + NOVA button (bottom-right).
   Additive alternative to Direct Touch. Outputs a normalized vector with an
   adjustable dead zone and full diagonal support. Only mounted while a run is
   active in joystick mode. It changes NO gameplay constant — GameEngine integrates
   this vector into the same player position the finger-drag would set. */
import { JOYSTICK_DEAD_ZONE, JOYSTICK_MAX_RADIUS, JOYSTICK_EXPO } from "../config";
import { t } from "../i18n";

export class Joystick {
  private root: HTMLElement;
  private knob: HTMLElement;
  private nova: HTMLButtonElement;
  private pointerId: number | null = null;
  private baseX = 0; private baseY = 0;
  /** Live normalized input, dead-zone applied. x: right+, y: up+ (world axes). */
  vec = { x: 0, y: 0 };
  private ready = false;

  constructor(private onNova: () => void) {
    const root = document.createElement("div");
    root.id = "joystick";
    root.style.cssText = "position:fixed;inset:0;z-index:6;pointer-events:none;display:none";

    const base = document.createElement("div");
    base.id = "joyBase";
    base.style.cssText = [
      "position:absolute", "left:calc(22px + env(safe-area-inset-left))",
      "bottom:calc(30px + env(safe-area-inset-bottom))",
      "width:132px", "height:132px", "border-radius:50%", "pointer-events:auto",
      "background:radial-gradient(circle,rgba(20,26,58,.55),rgba(8,10,28,.32))",
      "border:1px solid rgba(140,170,255,.28)", "touch-action:none",
      "box-shadow:inset 0 0 24px rgba(120,150,255,.15)",
    ].join(";");

    const knob = document.createElement("div");
    knob.id = "joyKnob";
    knob.style.cssText = [
      "position:absolute", "left:50%", "top:50%", "width:58px", "height:58px",
      "margin:-29px 0 0 -29px", "border-radius:50%", "pointer-events:none",
      "background:radial-gradient(circle at 40% 35%,#FFF0C0,var(--gold) 55%,#D89B1E)",
      "box-shadow:0 0 18px rgba(245,197,66,.6)", "transition:transform .04s linear",
    ].join(";");
    base.appendChild(knob);

    const nova = document.createElement("button");
    nova.id = "joyNova";
    nova.type = "button";
    nova.textContent = "NOVA";
    nova.style.cssText = [
      "position:absolute", "right:calc(24px + env(safe-area-inset-right))",
      "bottom:calc(40px + env(safe-area-inset-bottom))",
      "width:96px", "height:96px", "border-radius:50%", "pointer-events:auto",
      "font-family:inherit", "font-weight:800", "letter-spacing:2px", "font-size:14px",
      "color:#050418", "border:none", "cursor:pointer", "touch-action:none",
      "background:linear-gradient(180deg,#FFEDB0,var(--gold) 60%,#D89B1E)",
      "box-shadow:0 0 26px rgba(245,197,66,.6)", "opacity:.4", "filter:grayscale(.5)",
      "transition:opacity .2s,filter .2s,transform .1s",
    ].join(";");
    nova.setAttribute("aria-label", "Nova Blast");

    root.appendChild(base);
    root.appendChild(nova);
    document.body.appendChild(root);
    this.root = root; this.knob = knob; this.nova = nova;

    base.addEventListener("pointerdown", (e) => this.onDown(e, base));
    base.addEventListener("pointermove", (e) => this.onMove(e));
    base.addEventListener("pointerup", (e) => this.onUp(e));
    base.addEventListener("pointercancel", (e) => this.onUp(e));
    nova.addEventListener("click", (e) => { e.preventDefault(); if (this.ready) this.onNova(); });
    // Retranslate the aria label on language change.
    nova.setAttribute("aria-label", t("hud.novaHint"));
  }

  private onDown(e: PointerEvent, base: HTMLElement) {
    e.preventDefault();
    this.pointerId = e.pointerId;
    const rect = base.getBoundingClientRect();
    this.baseX = rect.left + rect.width / 2;
    this.baseY = rect.top + rect.height / 2;
    try { base.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
    this.onMove(e);
  }

  private onMove(e: PointerEvent) {
    if (this.pointerId !== e.pointerId) return;
    e.preventDefault();
    let dx = e.clientX - this.baseX;
    let dy = e.clientY - this.baseY;
    const mag = Math.hypot(dx, dy);
    const max = JOYSTICK_MAX_RADIUS;
    if (mag > max) { dx = (dx / mag) * max; dy = (dy / mag) * max; }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    // Direction (unit vector) is preserved exactly so the ship travels precisely
    // where the stick points. Magnitude: strip the dead zone, rescale to 0..1,
    // then apply an expo curve for fine control near centre / full speed at edge.
    const nx = dx / max, ny = dy / max;
    const nmag = Math.min(1, Math.hypot(nx, ny));
    if (nmag < JOYSTICK_DEAD_ZONE) { this.vec.x = 0; this.vec.y = 0; return; }
    const out = (nmag - JOYSTICK_DEAD_ZONE) / (1 - JOYSTICK_DEAD_ZONE); // 0..1
    const curved = Math.pow(out, JOYSTICK_EXPO);
    const ux = nx / nmag, uy = ny / nmag;                              // unit direction
    this.vec.x = ux * curved;
    this.vec.y = -uy * curved;  // screen-down is world-down → invert for world-up+
  }

  private onUp(e: PointerEvent) {
    if (this.pointerId !== e.pointerId) return;
    this.pointerId = null;
    this.vec.x = 0; this.vec.y = 0;
    this.knob.style.transform = "translate(0,0)";
  }

  /** Show/enable the NOVA button (Star Energy full). */
  setNovaReady(ready: boolean) {
    this.ready = ready;
    this.nova.style.opacity = ready ? "1" : ".4";
    this.nova.style.filter = ready ? "none" : "grayscale(.5)";
    this.nova.disabled = !ready;
  }

  mount() { this.root.style.display = "block"; }
  unmount() { this.root.style.display = "none"; this.reset(); }
  private reset() { this.pointerId = null; this.vec.x = 0; this.vec.y = 0; this.knob.style.transform = "translate(0,0)"; }
}
