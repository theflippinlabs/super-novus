/* Player — cœur plasma. Ported from the validated reference; geometry, motion,
   collision radius and feel are UNCHANGED. The plasma palette was intentionally
   recoloured from gold to electric blue-cyan to match the SUPERNOVUS logo
   (colours only — the shader math, sizes and light intensities are identical). */
import * as THREE from "three";
import { TEX, canvasTex } from "../core/textures";
import { PLAYER_RADIUS, PLAYER_VISUAL_SCALE, PLAYER_LIGHT_INTENSITY, PLAYER_LIGHT_INTENSITY_CHARGED } from "../config";

export class Player {
  group: THREE.Group;
  r: number;
  pos: THREE.Vector3;
  invuln = 0;
  private coreMat: THREE.ShaderMaterial;
  private core: THREE.Mesh;
  private g1: THREE.Sprite;
  private g2: THREE.Sprite;
  private g3: THREE.Sprite;
  private orbiters: Array<{ s: THREE.Sprite; rad: number; sp: number; ph: number; inc: number; tw: number }> = [];
  private light: THREE.PointLight;

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group();
    this.r = PLAYER_RADIUS;

    this.coreMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: `
        varying vec3 vN; varying vec3 vP; varying vec3 vW;
        void main(){
          vN = normalize(normalMatrix * normal);
          vP = position;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          vW = mv.xyz;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform float uTime;
        varying vec3 vN; varying vec3 vP; varying vec3 vW;
        float hash(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
        float noise(vec3 p){
          vec3 i = floor(p), f = fract(p);
          f = f*f*(3.0-2.0*f);
          return mix(
            mix(mix(hash(i), hash(i+vec3(1,0,0)), f.x),
                mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
            mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x),
                mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
        }
        float fbm(vec3 p){
          float v = 0.0, a = 0.55;
          for (int i = 0; i < 5; i++){ v += a*noise(p); p *= 2.1; a *= 0.5; }
          return v;
        }
        void main(){
          // Slow overall pulse — the whole core "breathes" with energy.
          float pulse = 0.5 + 0.5*sin(uTime*2.0);
          float n  = fbm(vP*3.0 + vec3(0.0, uTime*0.8, uTime*0.5));
          float n2 = fbm(vP*7.0 - vec3(uTime*1.2, 0.0, uTime*0.7));
          float heat = n*0.7 + n2*0.5;
          // Electric blue-cyan plasma core (matches the SUPERNOVUS logo).
          vec3 hot  = vec3(0.92, 0.99, 1.00);   // white-cyan hottest
          vec3 mid  = vec3(0.26, 0.66, 1.00);   // electric blue
          vec3 cool = vec3(0.24, 0.28, 0.95);   // deep indigo edges
          vec3 col = mix(hot, mid, smoothstep(0.35, 0.62, heat));
          col = mix(col, cool, smoothstep(0.62, 0.86, heat));
          // Bright energy filaments crawling over the surface.
          float veins = pow(fbm(vP*11.0 + vec3(uTime*1.6, -uTime*0.9, uTime*1.1)), 3.0);
          col += vec3(0.55, 0.85, 1.00) * veins * (1.2 + 0.6*pulse);
          // Pulsing cyan-blue fresnel rim (volumetric edge glow).
          float fr = pow(1.0 - abs(dot(normalize(vN), normalize(-vW))), 2.0);
          col += vec3(0.34, 0.70, 1.05) * fr * (1.7 + 0.5*pulse);
          col *= 1.30 + 0.10*pulse;             // subtle brightness breathing
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.core = new THREE.Mesh(new THREE.SphereGeometry(this.r, 40, 30), this.coreMat);
    this.group.add(this.core);

    // Layered additive glow — inner white-cyan, a mid blue halo, and a large faint
    // volumetric outer bloom. Toned down ~30% so the plasma shader detail reads
    // clearly instead of blowing out to white. No cross/lens-flare — just a soft
    // living-star halo.
    this.g1 = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.star, color: 0xbfe0ff, transparent: true, opacity: .24, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.g1.scale.setScalar(5.2);
    this.g2 = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.star, color: 0x4a9cff, transparent: true, opacity: .55, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.g2.scale.setScalar(13.5);
    this.g3 = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.star, color: 0x2a66ff, transparent: true, opacity: .2, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.g3.scale.setScalar(23);
    this.group.add(this.g3, this.g1, this.g2);

    // Small energy particles orbiting the core — the star feels alive without any
    // artificial rays. Each is a tiny additive spark on its own tilted orbit.
    const spark = canvasTex(64, 64, (ctx) => {
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, "rgba(230,245,255,1)");
      g.addColorStop(0.35, "rgba(150,205,255,0.6)");
      g.addColorStop(1, "rgba(150,205,255,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    });
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: spark, color: i % 2 ? 0xbfe6ff : 0x88c4ff, transparent: true, opacity: .9, depthWrite: false, blending: THREE.AdditiveBlending }));
      s.scale.setScalar(0.7 + (i % 3) * 0.18);
      this.group.add(s);
      this.orbiters.push({ s, rad: 1.7 + (i % 3) * 0.35, sp: (i % 2 ? 1 : -1) * (1.4 + i * 0.28), ph: (i / 6) * Math.PI * 2, inc: (i * 0.7), tw: 4 + i });
    }

    // Wider reach so more nearby asteroids catch the travelling player light.
    this.light = new THREE.PointLight(0x6aa8ff, PLAYER_LIGHT_INTENSITY, 132, 1.6);
    this.group.add(this.light);

    // Render the whole visual group ~20% smaller (agility/space) WITHOUT
    // touching the collision radius (this.r) used by the physics.
    this.group.scale.setScalar(PLAYER_VISUAL_SCALE);

    scene.add(this.group);
    this.pos = this.group.position;
  }

  /** STAR ENERGY full: brighten without touching the core shader. */
  setCharged(charged: boolean): void {
    this.light.intensity = charged ? PLAYER_LIGHT_INTENSITY_CHARGED : PLAYER_LIGHT_INTENSITY;
    this.g2.material.opacity = charged ? 0.72 : 0.55;
    this.g3.material.opacity = charged ? 0.3 : 0.2;
  }

  update(dt: number, t: number): void {
    this.coreMat.uniforms.uTime.value = t;
    this.core.rotation.y += dt * 0.6;
    this.core.rotation.x += dt * 0.25;
    // Subtle energy breathing — the core and glows pulse gently in sync (toned down).
    this.core.scale.setScalar(1 + Math.sin(t * 3.4) * 0.03);
    this.g1.material.opacity = 0.24 + Math.sin(t * 7) * 0.05;
    this.g2.scale.setScalar(13.5 + Math.sin(t * 4.3) * 1.9);
    this.g3.scale.setScalar(23 + Math.sin(t * 2.1) * 2.2);
    // Energy particles orbiting the core on tilted rings, twinkling as they go.
    for (const o of this.orbiters) {
      const a = t * o.sp + o.ph;
      const x = Math.cos(a) * o.rad;
      const z = Math.sin(a) * o.rad;
      o.s.position.set(x, Math.sin(a * 1.3 + o.inc) * o.rad * 0.35, z);
      o.s.material.opacity = 0.55 + 0.4 * (0.5 + 0.5 * Math.sin(t * o.tw + o.ph));
    }
    if (this.invuln > 0) {
      this.invuln -= dt;
      const blink = Math.sin(t * 24) > 0;
      this.core.visible = blink;
      this.g1.material.opacity *= blink ? 1 : 0.15;
    } else this.core.visible = true;
  }
}
