/* MenuBackground — a living, cinematic cosmos behind the home-screen + Game Over UI.
   Layers (back → front): soft galaxy clouds (slow-rotating pre-rendered sprites),
   two drifting nebula clouds, three parallax star layers with twinkle + occasional
   bright flares, tiny cosmic dust, slow distant comets, and frequent shooting stars
   at varied speeds. The UI floats above it.
   Performance-first for mobile: one canvas, DPR capped at 2, counts scaled to screen
   area, all soft glows pre-rendered to sprites, a single rAF loop that pauses when
   hidden/backgrounded, and a static single-frame fallback under prefers-reduced-motion. */

interface Star { x: number; y: number; r: number; depth: number; tw: number; twPhase: number; base: number; flare: number; }
interface Dust { x: number; y: number; vx: number; vy: number; a: number; }
interface Shooter { x: number; y: number; vx: number; vy: number; life: number; max: number; len: number; w: number; hue: string; }
interface Comet { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; }
interface Galaxy { sprite: HTMLCanvasElement; x: number; y: number; rot: number; vr: number; vx: number; vy: number; }

export class MenuBackground {
  private ctx: CanvasRenderingContext2D;
  private w = 0; private h = 0; private dpr = 1;
  private stars: Star[] = [];
  private dust: Dust[] = [];
  private shooters: Shooter[] = [];
  private comets: Comet[] = [];
  private nebula: Array<{ sprite: HTMLCanvasElement; x: number; y: number; vx: number; vy: number; ph: number }> = [];
  private galaxies: Galaxy[] = [];
  private glow!: HTMLCanvasElement;       // shared soft round glow sprite
  private raf = 0;
  private last = 0;
  private t = 0;
  private nextShoot = 1.6;
  private nextComet = 9;
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
    const starN = Math.min(230, Math.round(area / 3400));   // denser field, still capped
    const dustN = Math.min(60, Math.round(area / 13000));
    const R = this.rand;

    this.glow = this.makeGlow(64);

    // Three depth layers: far (tiny, faint, slow) → near (larger, brighter, faster).
    this.stars = [];
    for (let i = 0; i < starN; i++) {
      const depth = R();                       // 0 far … 1 near
      this.stars.push({
        x: R() * this.w, y: R() * this.h,
        r: 0.4 + depth * 1.6,
        depth: 0.15 + depth * 0.85,
        tw: 0.6 + R() * 1.8,
        twPhase: R() * Math.PI * 2,
        base: 0.35 + R() * 0.5,
        flare: 0,
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

    // Distant galaxy clouds — faint elliptical spirals, slowly rotating + drifting.
    const gcol: Array<[number, number, number]> = [[150, 120, 255], [80, 150, 235]];
    this.galaxies = gcol.map((c, i) => {
      const size = Math.round(Math.min(this.w, this.h) * (0.7 + i * 0.2));
      return {
        sprite: this.makeGalaxy(size, c),
        x: this.w * (i ? 0.7 : 0.28), y: this.h * (i ? 0.32 : 0.72),
        rot: R() * Math.PI * 2, vr: (i ? -1 : 1) * 0.012,
        vx: (i ? -1 : 1) * 0.8, vy: (i ? 1 : -1) * 0.5,
      };
    });

    this.shooters = []; this.comets = [];
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

  /** Pre-render a faint elliptical "galaxy" — a bright core, an elongated haze and a
      couple of soft spiral sweeps. Drawn once; rotated cheaply each frame. */
  private makeGalaxy(size: number, [r, g, b]: [number, number, number]): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const x = c.getContext("2d")!;
    const cx = size / 2, cy = size / 2;
    // Elongated haze.
    x.save();
    x.translate(cx, cy); x.scale(1, 0.42);
    const halo = x.createRadialGradient(0, 0, 0, 0, 0, size / 2);
    halo.addColorStop(0, `rgba(${r},${g},${b},0.20)`);
    halo.addColorStop(0.5, `rgba(${r},${g},${b},0.06)`);
    halo.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = halo;
    x.beginPath(); x.arc(0, 0, size / 2, 0, 6.2832); x.fill();
    x.restore();
    // Two faint spiral sweeps for structure.
    x.globalCompositeOperation = "lighter";
    x.strokeStyle = `rgba(${r},${g},${b},0.10)`;
    x.lineWidth = Math.max(1, size / 90);
    for (let s = 0; s < 2; s++) {
      x.beginPath();
      for (let a = 0; a < Math.PI * 2.2; a += 0.12) {
        const rad = (a / (Math.PI * 2.2)) * (size * 0.42);
        const px = cx + Math.cos(a + s * Math.PI) * rad;
        const py = cy + Math.sin(a + s * Math.PI) * rad * 0.42;
        a === 0 ? x.moveTo(px, py) : x.lineTo(px, py);
      }
      x.stroke();
    }
    // Bright core.
    const core = x.createRadialGradient(cx, cy, 0, cx, cy, size * 0.14);
    core.addColorStop(0, "rgba(255,255,255,0.5)");
    core.addColorStop(0.4, `rgba(${r},${g},${b},0.28)`);
    core.addColorStop(1, `rgba(${r},${g},${b},0)`);
    x.fillStyle = core;
    x.beginPath(); x.arc(cx, cy, size * 0.14, 0, 6.2832); x.fill();
    return c;
  }

  /** A shared soft round glow used for comet heads and star flares. */
  private makeGlow(size: number): HTMLCanvasElement {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const x = c.getContext("2d")!;
    const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.25, "rgba(210,228,255,0.7)");
    g.addColorStop(1, "rgba(210,228,255,0)");
    x.fillStyle = g;
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

    ctx.globalCompositeOperation = "lighter";

    // Galaxy clouds — far back, slow rotate + drift.
    for (const g of this.galaxies) {
      g.rot += g.vr * dt; g.x += g.vx * dt; g.y += g.vy * dt;
      const s = g.sprite.width;
      if (g.x < -s) g.x = w + s; else if (g.x > w + s) g.x = -s;
      if (g.y < -s) g.y = h + s; else if (g.y > h + s) g.y = -s;
      ctx.save();
      ctx.translate(g.x, g.y); ctx.rotate(g.rot);
      ctx.drawImage(g.sprite, -s / 2, -s / 2);
      ctx.restore();
    }

    // Nebula clouds — slow lissajous drift; wrap softly around the viewport.
    for (const n of this.nebula) {
      n.x += n.vx * dt; n.y += n.vy * dt; n.ph += dt * 0.05;
      const ox = Math.sin(n.ph) * 18, oy = Math.cos(n.ph * 0.8) * 14;
      const s = n.sprite.width;
      const px = ((n.x % (w + s) + (w + s)) % (w + s)) - s / 2 + ox;
      const py = ((n.y % (h + s) + (h + s)) % (h + s)) - s / 2 + oy;
      ctx.drawImage(n.sprite, px - s / 2, py - s / 2);
    }

    ctx.globalCompositeOperation = "source-over";

    // Stars — parallax drift + gentle twinkle + occasional bright flare.
    for (const st of this.stars) {
      st.y += st.depth * 3.2 * dt;             // slow downward depth movement
      st.x += st.depth * 0.5 * dt;
      if (st.y > h + 2) { st.y = -2; st.x = this.rand() * w; }
      if (st.x > w + 2) st.x = -2;
      if (st.flare > 0) st.flare = Math.max(0, st.flare - dt / 0.9);
      const tw = 0.72 + 0.28 * Math.sin(this.t * st.tw + st.twPhase);
      const a = st.base * tw;
      ctx.globalAlpha = a;
      ctx.fillStyle = st.depth > 0.7 ? "#eaf2ff" : "#cdd8ff";
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r, 0, 6.2832);
      ctx.fill();
      // Bright flare: a soft glow + a thin cross sparkle.
      if (st.flare > 0) {
        const f = st.flare;
        const gs = 10 + f * 26;
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.5 * f;
        ctx.drawImage(this.glow, st.x - gs / 2, st.y - gs / 2, gs, gs);
        ctx.strokeStyle = `rgba(240,246,255,${0.7 * f})`;
        ctx.lineWidth = 1;
        const spk = gs * 0.7;
        ctx.beginPath();
        ctx.moveTo(st.x - spk, st.y); ctx.lineTo(st.x + spk, st.y);
        ctx.moveTo(st.x, st.y - spk); ctx.lineTo(st.x, st.y + spk);
        ctx.stroke();
        ctx.globalCompositeOperation = "source-over";
      }
    }
    // Occasionally ignite a flare on a random near-ish star.
    if (dt > 0 && this.rand() < dt * 0.9) {
      const st = this.stars[(this.rand() * this.stars.length) | 0];
      if (st && st.flare <= 0 && st.depth > 0.55) st.flare = 1;
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

    ctx.globalCompositeOperation = "lighter";

    // Distant comets — slow, with a glowing head and a long soft tail.
    this.nextComet -= dt;
    if (this.nextComet <= 0 && dt > 0) this.spawnComet();
    for (let i = this.comets.length - 1; i >= 0; i--) {
      const c = this.comets[i];
      c.x += c.vx * dt; c.y += c.vy * dt; c.life += dt;
      const k = Math.min(1, c.life / 0.8) * Math.max(0, 1 - (c.life - c.max + 1.2) / 1.2);
      if (c.life > c.max) { this.comets.splice(i, 1); continue; }
      const tx = c.x - c.vx * 0.9, ty = c.y - c.vy * 0.9;
      const grd = ctx.createLinearGradient(c.x, c.y, tx, ty);
      grd.addColorStop(0, `rgba(190,220,255,${0.5 * k})`);
      grd.addColorStop(1, "rgba(150,190,255,0)");
      ctx.strokeStyle = grd; ctx.lineWidth = c.size * 0.9;
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(tx, ty); ctx.stroke();
      const hs = c.size * 5;
      ctx.globalAlpha = 0.9 * k;
      ctx.drawImage(this.glow, c.x - hs / 2, c.y - hs / 2, hs, hs);
      ctx.globalAlpha = 1;
    }

    // Shooting stars — frequent, quick, at varied speeds (some slow drifters).
    this.nextShoot -= dt;
    if (this.nextShoot <= 0 && dt > 0) this.spawnShooter();
    for (let i = this.shooters.length - 1; i >= 0; i--) {
      const s = this.shooters[i];
      s.x += s.vx * dt; s.y += s.vy * dt; s.life += dt;
      const k = 1 - s.life / s.max;
      if (k <= 0) { this.shooters.splice(i, 1); continue; }
      const tx = s.x - s.vx * (s.len / 900), ty = s.y - s.vy * (s.len / 900);
      const grd = ctx.createLinearGradient(s.x, s.y, tx, ty);
      grd.addColorStop(0, `rgba(${s.hue},${0.9 * k})`);
      grd.addColorStop(1, `rgba(${s.hue},0)`);
      ctx.strokeStyle = grd;
      ctx.lineWidth = s.w;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y); ctx.lineTo(tx, ty); ctx.stroke();
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }

  private spawnShooter(): void {
    this.nextShoot = 1.2 + this.rand() * 2.6;   // one every ~1.2–3.8 s (frequent)
    const fromLeft = this.rand() > 0.5;
    // Two speed classes: slow graceful streaks and fast bright darts.
    const fast = this.rand() > 0.45;
    const speed = fast ? 460 + this.rand() * 320 : 180 + this.rand() * 120;
    const ang = (fromLeft ? 0.30 : Math.PI - 0.30) + (this.rand() - 0.5) * 0.5;
    const warm = this.rand() > 0.75;            // a few warm-white streaks for variety
    this.shooters.push({
      x: fromLeft ? -40 : this.w + 40,
      y: this.rand() * this.h * 0.72,
      vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
      life: 0, max: (fast ? 0.7 : 1.4) + this.rand() * 0.5,
      len: (fast ? 150 : 90) + this.rand() * 130,
      w: fast ? 2 : 1.4,
      hue: warm ? "255,236,206" : "233,242,255",
    });
  }

  private spawnComet(): void {
    this.nextComet = 12 + this.rand() * 16;     // rare — every ~12–28 s
    const fromLeft = this.rand() > 0.5;
    const speed = 55 + this.rand() * 55;        // slow and distant
    const ang = (fromLeft ? 0.18 : Math.PI - 0.18) + (this.rand() - 0.5) * 0.3;
    this.comets.push({
      x: fromLeft ? -60 : this.w + 60,
      y: this.h * (0.1 + this.rand() * 0.6),
      vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
      life: 0, max: (this.w + 240) / speed, size: 2.2 + this.rand() * 1.6,
    });
  }
}
