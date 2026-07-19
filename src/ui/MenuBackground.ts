/* MenuBackground — a living, cinematic cosmos behind the home-screen UI.
   Subtle by design: three parallax star layers with gentle twinkle + drift, two
   slow-moving nebula clouds (pre-rendered once, then just translated), a field of
   tiny cosmic dust, and occasional shooting stars. The UI floats above it.
   Performance-first for mobile: one canvas, DPR capped, particle counts scaled to
   screen area, a single rAF loop that pauses when the menu is hidden or the tab is
   backgrounded, and a static single-frame fallback under prefers-reduced-motion. */

interface Star { x: number; y: number; r: number; depth: number; tw: number; twPhase: number; base: number; }
interface Dust { x: number; y: number; vx: number; vy: number; a: number; }
interface Shooter { x: number; y: number; vx: number; vy: number; life: number; max: number; len: number; }

export class MenuBackground {
  private ctx: CanvasRenderingContext2D;
  private w = 0; private h = 0; private dpr = 1;
  private stars: Star[] = [];
  private dust: Dust[] = [];
  private shooters: Shooter[] = [];
  private nebula: Array<{ sprite: HTMLCanvasElement; x: number; y: number; vx: number; vy: number; ph: number }> = [];
  private raf = 0;
  private last = 0;
  private t = 0;
  private nextShoot = 2.5;
  private running = false;
  private visible = true;
  private reduced: boolean;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d", { alpha: true })!;
    this.reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.resize();
    addEventListener("resize", () => this.resize());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.stop(); else if (this.visible) this.start();
    });
  }

  /** Build/refresh the field for the current canvas size. */
  private resize(): void {
    this.dpr = Math.min(2, devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.build();
    if (!this.running) this.drawStaticFrame();  // keep something on screen while paused
  }

  private build(): void {
    const area = this.w * this.h;
    const starN = Math.min(180, Math.round(area / 4200));   // ~150 on a phone, capped
    const dustN = Math.min(46, Math.round(area / 16000));
    const R = this.rand;

    // Three depth layers: far (tiny, faint, slow) → near (larger, brighter, faster).
    this.stars = [];
    for (let i = 0; i < starN; i++) {
      const depth = R();                       // 0 far … 1 near
      this.stars.push({
        x: R() * this.w, y: R() * this.h,
        r: 0.4 + depth * 1.5,
        depth: 0.15 + depth * 0.85,
        tw: 0.6 + R() * 1.8,
        twPhase: R() * Math.PI * 2,
        base: 0.35 + R() * 0.5,
      });
    }

    this.dust = [];
    for (let i = 0; i < dustN; i++) {
      this.dust.push({
        x: R() * this.w, y: R() * this.h,
        vx: (R() - 0.5) * 4, vy: (R() - 0.5) * 4,
        a: 0.08 + R() * 0.22,
      });
    }

    // Two soft nebula clouds — pre-rendered to sprites, then only translated.
    const cols: Array<[number, number, number]> = [[120, 90, 220], [56, 120, 224]];
    this.nebula = cols.map((c, i) => {
      const size = Math.round(Math.min(this.w, this.h) * (0.9 + i * 0.35));
      return {
        sprite: this.makeNebula(size, c),
        x: this.w * (i ? 0.78 : 0.24), y: this.h * (i ? 0.7 : 0.26),
        vx: (i ? -1 : 1) * 1.6, vy: (i ? 1 : -1) * 1.0, ph: R() * Math.PI * 2,
      };
    });
  }

  /** Pre-render a soft radial nebula blob to an offscreen canvas (drawn once). */
  private makeNebula(size: number, [r, g, b]: [number, number, number]): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const x = c.getContext("2d")!;
    const grd = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grd.addColorStop(0, `rgba(${r},${g},${b},0.22)`);
    grd.addColorStop(0.45, `rgba(${r},${g},${b},0.08)`);
    grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = grd;
    x.fillRect(0, 0, size, size);
    return c;
  }

  private rand = (): number => {
    // No Math.random ban here (browser runtime), but keep a small LCG so the field
    // is stable across a session and cheap.
    this._seed = (this._seed * 1664525 + 1013904223) >>> 0;
    return this._seed / 4294967296;
  };
  private _seed = 0x9e3779b9;

  start(): void {
    this.visible = true;
    if (this.reduced) { this.drawStaticFrame(); return; }
    if (this.running || document.hidden) return;
    this.running = true;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Pause the animation (menu hidden / gameplay running / tab backgrounded). */
  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  /** Called when the menu is hidden by the app (e.g. a run starts). */
  setVisible(v: boolean): void { this.visible = v; if (v) this.start(); else this.stop(); }

  private frame = (now: number): void => {
    if (!this.running) return;
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.05) dt = 0.05;                 // clamp after a tab switch
    this.t += dt;
    this.render(dt);
    this.raf = requestAnimationFrame(this.frame);
  };

  private drawStaticFrame(): void {
    // One calm frame for reduced-motion / paused states.
    this.t = 0; this.render(0);
  }

  private render(dt: number): void {
    const ctx = this.ctx, w = this.w, h = this.h;
    ctx.clearRect(0, 0, w, h);

    // Nebula clouds — slow lissajous drift; wrap softly around the viewport.
    ctx.globalCompositeOperation = "lighter";
    for (const n of this.nebula) {
      n.x += n.vx * dt; n.y += n.vy * dt; n.ph += dt * 0.05;
      const ox = Math.sin(n.ph) * 18, oy = Math.cos(n.ph * 0.8) * 14;
      const s = n.sprite.width;
      const px = ((n.x % (w + s) + (w + s)) % (w + s)) - s / 2 + ox;
      const py = ((n.y % (h + s) + (h + s)) % (h + s)) - s / 2 + oy;
      ctx.drawImage(n.sprite, px - s / 2, py - s / 2);
    }

    // Stars — parallax drift + gentle twinkle.
    for (const st of this.stars) {
      st.y += st.depth * 3.2 * dt;             // slow downward depth movement
      st.x += st.depth * 0.5 * dt;
      if (st.y > h + 2) { st.y = -2; st.x = this.rand() * w; }
      if (st.x > w + 2) st.x = -2;
      const tw = 0.72 + 0.28 * Math.sin(this.t * st.tw + st.twPhase);
      ctx.globalAlpha = st.base * tw;
      ctx.fillStyle = st.depth > 0.7 ? "#eaf2ff" : "#cdd8ff";
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r, 0, 6.2832);
      ctx.fill();
    }

    // Cosmic dust — tiny slow motes.
    for (const d of this.dust) {
      d.x += d.vx * dt; d.y += d.vy * dt;
      if (d.x < 0) d.x = w; else if (d.x > w) d.x = 0;
      if (d.y < 0) d.y = h; else if (d.y > h) d.y = 0;
      ctx.globalAlpha = d.a;
      ctx.fillStyle = "#9fb6ff";
      ctx.fillRect(d.x, d.y, 1.3, 1.3);
    }

    // Shooting stars — occasional, quick, fading streaks.
    ctx.globalCompositeOperation = "lighter";
    this.nextShoot -= dt;
    if (this.nextShoot <= 0 && dt > 0) this.spawnShooter();
    for (let i = this.shooters.length - 1; i >= 0; i--) {
      const s = this.shooters[i];
      s.x += s.vx * dt; s.y += s.vy * dt; s.life += dt;
      const k = 1 - s.life / s.max;
      if (k <= 0) { this.shooters.splice(i, 1); continue; }
      const tx = s.x - s.vx * (s.len / 900), ty = s.y - s.vy * (s.len / 900);
      const grd = ctx.createLinearGradient(s.x, s.y, tx, ty);
      grd.addColorStop(0, `rgba(233,242,255,${0.85 * k})`);
      grd.addColorStop(1, "rgba(233,242,255,0)");
      ctx.strokeStyle = grd;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y); ctx.lineTo(tx, ty); ctx.stroke();
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  private spawnShooter(): void {
    this.nextShoot = 4 + this.rand() * 6;      // one every ~4–10 s
    const fromLeft = this.rand() > 0.5;
    const speed = 320 + this.rand() * 220;
    const ang = (fromLeft ? 0.32 : Math.PI - 0.32) + (this.rand() - 0.5) * 0.24;
    this.shooters.push({
      x: fromLeft ? -40 : this.w + 40,
      y: this.rand() * this.h * 0.5,
      vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
      life: 0, max: 0.9 + this.rand() * 0.5, len: 140 + this.rand() * 120,
    });
  }
}
