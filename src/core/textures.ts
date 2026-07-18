/* Textures & PlanetFactory — ported verbatim from validated reference.
   Visual output MUST remain identical (Golden Rule). */
// NOTE: ported-verbatim canvas drawing code — implicit-any tolerated here to
// preserve byte-identical visual output (Golden Rule). Boundaries are typed.
import * as THREE from "three";
import { rand } from "./util";

/* eslint-disable @typescript-eslint/no-explicit-any */
function canvasTex(w: number, h: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d"); if (!ctx) throw new Error("2d ctx unavailable"); draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}
function glowTex(inner: string, mid: string): THREE.CanvasTexture {
  return canvasTex(128, 128, ctx => {
    const g = ctx.createRadialGradient(64,64,0, 64,64,64);
    g.addColorStop(0, inner);
    g.addColorStop(0.32, mid);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0,0,128,128);
  });
}
const TEX: Record<string, any> = {
  star:   glowTex("rgba(255,252,240,1)", "rgba(255,180,60,.6)"),
  ember:  glowTex("rgba(255,205,140,.95)", "rgba(255,100,30,.42)"),
  gold:   glowTex("rgba(255,244,200,1)", "rgba(245,197,66,.55)"),
  blue:   glowTex("rgba(235,248,255,1)", "rgba(110,185,255,.55)"),
  spark:  glowTex("rgba(255,255,255,1)", "rgba(255,220,150,.6)"),
  white:  glowTex("rgba(255,255,255,1)", "rgba(220,235,255,.5)"),
  flareCross: canvasTex(256, 256, ctx => {
    const grads = [
      [0, 128, 256, 128], [128, 0, 128, 256],
    ];
    for (const [x1,y1,x2,y2] of grads){
      const g = ctx.createLinearGradient(x1,y1,x2,y2);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.5, "rgba(235,242,255,.9)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.strokeStyle = g;
      ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
    }
  }),
  galaxy: canvasTex(256, 256, ctx => {
    ctx.translate(128,128);
    for (let arm = 0; arm < 3; arm++){
      for (let i = 0; i < 520; i++){
        const t = i/520, a = t*4.6 + arm*(Math.PI*2/3), r = 6 + t*114;
        ctx.fillStyle = `hsla(${rand(200,280)}, 60%, ${rand(60,92)}%, ${(1-t)*0.3})`;
        ctx.fillRect(Math.cos(a)*r + rand(-6,6), Math.sin(a)*r*0.55 + rand(-4,4), rand(1,3), rand(1,3));
      }
    }
    const g = ctx.createRadialGradient(0,0,0, 0,0,40);
    g.addColorStop(0, "rgba(235,240,255,.85)");
    g.addColorStop(1, "transparent");
    ctx.fillStyle = g;
    ctx.fillRect(-40,-40,80,80);
  }),
  nebula: (h1: number, h2: number) => canvasTex(256, 256, (ctx) => {
    for (let i = 0; i < 20; i++){
      const x = rand(30,226), y = rand(30,226), r = rand(30,95);
      const g = ctx.createRadialGradient(x,y,0, x,y,r);
      g.addColorStop(0, `hsla(${Math.random()<.5?h1:h2}, 70%, ${rand(38,55)}%, ${rand(.03,.08)})`);
      g.addColorStop(1, "transparent");
      ctx.fillStyle = g;
      ctx.fillRect(0,0,256,256);
    }
  }),
  rock: canvasTex(128, 128, (ctx, w, h) => {
    // Cool blue-grey space rock (was warm brown) — reads premium under the blue star.
    ctx.fillStyle = "#3b404e"; ctx.fillRect(0,0,w,h);
    for (let i = 0; i < 2600; i++){
      ctx.fillStyle = `hsla(${rand(212,242)}, ${rand(8,20)}%, ${rand(9,44)}%, ${rand(.25,.65)})`;
      ctx.fillRect(Math.random()*w, Math.random()*h, rand(1,5), rand(1,3));
    }
    for (let i = 0; i < 14; i++){
      const x = rand(8,120), y = rand(8,120), r = rand(3,9);
      const g = ctx.createRadialGradient(x,y,0,x,y,r);
      g.addColorStop(0, "rgba(0,0,0,.55)");
      g.addColorStop(.7, "rgba(0,0,0,.2)");
      g.addColorStop(1, "rgba(110,125,160,.26)");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x,y,r,0,7); ctx.fill();
    }
  }),
};

const PlanetFactory: any = {
  _noiseBump: null,
  bump(){
    if (!this._noiseBump){
      this._noiseBump = canvasTex(128, 64, (ctx, w, h) => {
        ctx.fillStyle = "#808080"; ctx.fillRect(0,0,w,h);
        for (let i = 0; i < 3000; i++){
          const v = rand(40, 216)|0;
          ctx.fillStyle = `rgb(${v},${v},${v})`;
          ctx.fillRect(Math.random()*w, Math.random()*h, rand(1,3), rand(1,2));
        }
      });
    }
    return this._noiseBump;
  },

  _blob(ctx: any, cx: number, cy: number, r: number, color: string){
    ctx.fillStyle = color;
    ctx.beginPath();
    const pts = 9 + (Math.random()*5|0);
    for (let i = 0; i <= pts; i++){
      const a = i/pts * Math.PI*2;
      const rr = r * rand(0.55, 1.25);
      const x = cx + Math.cos(a)*rr*1.5, y = cy + Math.sin(a)*rr*0.8;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill();
  },
  _craters(ctx: any, w: number, h: number, n: number, base: string){
    for (let i = 0; i < n; i++){
      const x = rand(0,w), y = rand(6,h-6), r = rand(1.5, 6);
      const g = ctx.createRadialGradient(x,y,0,x,y,r);
      g.addColorStop(0, "rgba(0,0,0,.4)");
      g.addColorStop(.75, "rgba(0,0,0,.15)");
      g.addColorStop(1, `rgba(${base},.3)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x,y,r,0,7); ctx.fill();
    }
  },
  _bands(ctx: any, w: number, h: number, palette: string[], turb: number){
    for (let y = 0; y < h; y++){
      const t = y/h;
      const wob = Math.sin(t*22 + Math.sin(t*7)*2)*0.5 + 0.5;
      const idx = Math.min(palette.length-1, Math.floor((t + wob*turb)*palette.length) % palette.length);
      ctx.fillStyle = palette[Math.abs(idx)];
      ctx.fillRect(0, y, w, 1);
    }
    /* turbulence horizontale */
    const img = ctx.getImageData(0,0,w,h);
    ctx.putImageData(img, 0, 0);
    for (let i = 0; i < 60; i++){
      const y = rand(0,h), len = rand(20, 90), x = rand(0,w);
      ctx.globalAlpha = 0.12;
      ctx.drawImage(ctx.canvas, x, y-1, len, 2, x + rand(-8,8), y, len, 2);
      ctx.globalAlpha = 1;
    }
  },

  earth(){
    return canvasTex(256, 128, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0,0,0,h);
      g.addColorStop(0, "#0e2a52"); g.addColorStop(.5, "#14459c"); g.addColorStop(1, "#0e2a52");
      ctx.fillStyle = g; ctx.fillRect(0,0,w,h);
      for (let i = 0; i < 9; i++)
        this._blob(ctx, rand(0,w), rand(18,h-18), rand(9,22), `hsl(${rand(80,130)}, ${rand(30,45)}%, ${rand(24,36)}%)`);
      for (let i = 0; i < 5; i++)
        this._blob(ctx, rand(0,w), rand(20,h-20), rand(5,10), `hsl(${rand(28,42)}, 40%, 34%)`);
      ctx.fillStyle = "rgba(240,248,255,.9)";
      ctx.fillRect(0, 0, w, 7); ctx.fillRect(0, h-7, w, 7);
      ctx.globalAlpha = .5;
      for (let i = 0; i < 60; i++)
        this._blob(ctx, rand(0,w), rand(0,h), rand(2,6), "rgba(255,255,255,.55)");
      ctx.globalAlpha = 1;
    });
  },
  mars(){
    return canvasTex(256, 128, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0,0,0,h);
      g.addColorStop(0, "#8f3f22"); g.addColorStop(.5, "#c06034"); g.addColorStop(1, "#8f3f22");
      ctx.fillStyle = g; ctx.fillRect(0,0,w,h);
      for (let i = 0; i < 7; i++)
        this._blob(ctx, rand(0,w), rand(15,h-15), rand(8,20), `hsla(${rand(10,22)}, 55%, ${rand(18,28)}%, .7)`);
      this._craters(ctx, w, h, 40, "160,90,50");
      ctx.fillStyle = "rgba(245,240,235,.85)";
      ctx.fillRect(0, 0, w, 5); ctx.fillRect(0, h-4, w, 4);
    });
  },
  jupiter(){
    return canvasTex(256, 128, (ctx, w, h) => {
      this._bands(ctx, w, h, ["#c8a878","#e8d8c0","#a87850","#d8c0a0","#b89068","#e0d0b8","#986848","#d0b890"], .12);
      /* grande tache rouge */
      const x = w*0.68, y = h*0.62;
      const g = ctx.createRadialGradient(x,y,0,x,y,13);
      g.addColorStop(0, "#c0503a"); g.addColorStop(.7, "#a84830"); g.addColorStop(1, "rgba(168,72,48,0)");
      ctx.fillStyle = g;
      ctx.save(); ctx.translate(x,y); ctx.scale(1.7,1); ctx.beginPath(); ctx.arc(0,0,13,0,7); ctx.fill(); ctx.restore();
    });
  },
  saturn(){
    return canvasTex(256, 128, (ctx, w, h) => {
      this._bands(ctx, w, h, ["#d8c090","#e8d8b0","#c8b080","#e0cca0","#d0b888","#ecdcb8"], .08);
    });
  },
  neptune(){
    return canvasTex(256, 128, (ctx, w, h) => {
      this._bands(ctx, w, h, ["#2038b0","#2848c8","#1830a0","#3050d0","#2440b8"], .06);
      ctx.globalAlpha = .6;
      for (let i = 0; i < 4; i++)
        this._blob(ctx, rand(0,w), rand(30,h-30), rand(4,8), "rgba(235,242,255,.8)");
      ctx.globalAlpha = 1;
    });
  },
  uranus(){
    return canvasTex(256, 128, (ctx, w, h) => {
      this._bands(ctx, w, h, ["#9fd4dc","#aadde4","#95ccd6","#a4d8e0"], .03);
    });
  },
  mercury(){
    return canvasTex(256, 128, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0,0,0,h);
      g.addColorStop(0, "#6a6660"); g.addColorStop(.5, "#8f8a82"); g.addColorStop(1, "#6a6660");
      ctx.fillStyle = g; ctx.fillRect(0,0,w,h);
      for (let i = 0; i < 1200; i++){
        ctx.fillStyle = `hsla(30, 6%, ${rand(30,65)}%, ${rand(.15,.4)})`;
        ctx.fillRect(Math.random()*w, Math.random()*h, rand(1,3), rand(1,2));
      }
      this._craters(ctx, w, h, 70, "150,145,135");
    });
  },
  venus(){
    return canvasTex(256, 128, (ctx, w, h) => {
      this._bands(ctx, w, h, ["#d9b26a","#e8c884","#cea65c","#e0bc74"], .1);
      ctx.globalAlpha = .35;
      for (let i = 0; i < 30; i++){
        ctx.strokeStyle = "rgba(245,230,200,.7)";
        ctx.lineWidth = rand(1.5, 4);
        ctx.beginPath();
        const y0 = rand(8, h-8);
        ctx.moveTo(0, y0);
        ctx.bezierCurveTo(w*.3, y0 + rand(-12,12), w*.7, y0 + rand(-12,12), w, y0 + rand(-8,8));
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });
  },
  fictional(){
    const hue = rand(0, 360);
    const style = Math.random();
    return canvasTex(256, 128, (ctx, w, h) => {
      if (style < .5){
        const pal: string[] = [];
        for (let i = 0; i < 6; i++) pal.push(`hsl(${hue + rand(-18,18)}, ${rand(35,65)}%, ${rand(22,52)}%)`);
        this._bands(ctx, w, h, pal, .1);
      } else {
        const g = ctx.createLinearGradient(0,0,0,h);
        g.addColorStop(0, `hsl(${hue}, 45%, 18%)`);
        g.addColorStop(.5, `hsl(${hue}, 55%, 32%)`);
        g.addColorStop(1, `hsl(${hue}, 45%, 18%)`);
        ctx.fillStyle = g; ctx.fillRect(0,0,w,h);
        for (let i = 0; i < 10; i++)
          this._blob(ctx, rand(0,w), rand(12,h-12), rand(7,18), `hsl(${hue + rand(20,60)}, ${rand(40,70)}%, ${rand(30,55)}%)`);
        this._craters(ctx, w, h, 25, "120,120,120");
      }
    });
  },

  saturnRing(){
    return canvasTex(512, 12, (ctx, w) => {
      for (let x = 0; x < w; x++){
        const t = x/w;
        let a = 0.55 + Math.sin(x*0.32)*0.2 + Math.sin(x*0.07+1)*0.15;
        if (t < 0.04 || t > 0.97) a = 0;
        if (t > 0.60 && t < 0.66) a *= 0.08;            /* division de Cassini */
        if (t > 0.30 && t < 0.315) a *= 0.3;
        const l = 66 + Math.sin(x*0.11)*10;
        ctx.fillStyle = `hsla(42, 28%, ${l}%, ${Math.max(0,a).toFixed(3)})`;
        ctx.fillRect(x, 0, 1, 12);
      }
    });
  },
  genericRing(hue: number){
    return canvasTex(512, 8, (ctx, w) => {
      for (let x = 0; x < w; x++){
        const t = x/w;
        let a = 0.4 + Math.sin(x*0.25)*0.22;
        if (t < 0.05 || t > 0.95) a = 0;
        if (t > 0.5 && t < 0.55) a *= 0.15;
        ctx.fillStyle = `hsla(${hue}, 30%, ${60 + Math.sin(x*0.09)*12}%, ${Math.max(0,a).toFixed(3)})`;
        ctx.fillRect(x, 0, 1, 8);
      }
    });
  },

  /* construit un mesh planète complet ; ringed: "saturn"|"generic"|null */
  build(type: string, r: number){
    const group = new THREE.Group();
    const map = this[type]();
    const isRocky = ["earth","mars","mercury","venus","fictional"].includes(type);
    const mat = new THREE.MeshStandardMaterial({
      map,
      roughness: isRocky ? 0.92 : 0.75,
      metalness: 0.02,
      bumpMap: isRocky ? this.bump() : null,
      bumpScale: isRocky ? 0.06 : 0,
      emissive: 0x070910,
      emissiveIntensity: 0.28,   // dimmer — planets must never outshine obstacles
    });
    const body = new THREE.Mesh(new THREE.SphereGeometry(r, 34, 24), mat);
    body.rotation.z = rand(-0.35, 0.35);
    group.add(body);

    let ringed: string | null = null;
    if (type === "saturn") ringed = "saturn";
    else if (type === "uranus" && Math.random() < .6) ringed = "generic";
    else if (type === "fictional" && Math.random() < .35) ringed = "generic";

    if (ringed){
      const inner = r*1.35, outer = type === "saturn" ? r*2.3 : r*1.9;
      const rg = new THREE.RingGeometry(inner, outer, 72, 1);
      const uv = rg.attributes.uv, p = rg.attributes.position;
      for (let i = 0; i < uv.count; i++){
        const d = Math.hypot(p.getX(i), p.getY(i));
        uv.setXY(i, (d - inner) / (outer - inner), 0.5);
      }
      const rt = ringed === "saturn" ? this.saturnRing() : this.genericRing(rand(0,360));
      const ring = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({
        map:rt, transparent:true, side:THREE.DoubleSide, depthWrite:false, opacity:.8}));
      ring.rotation.x = Math.PI/2 + rand(-0.4, 0.4);
      ring.rotation.y = rand(-0.25, 0.25);
      group.add(ring);
    }
    return {group, body};
  },
  randomType(){
    const t = ["earth","mars","jupiter","saturn","neptune","uranus","mercury","venus","fictional","fictional"];
    return t[(Math.random()*t.length)|0];
  }
};

export { canvasTex, glowTex, TEX, PlanetFactory };
