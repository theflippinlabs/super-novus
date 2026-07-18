/* Player — cœur plasma. PORTED VERBATIM from validated reference.
   GOLDEN RULE: rendering, shaders and feel must not change.
   Only additions: typed fields + config-driven light intensity for
   the STAR ENERGY "charged" brightness boost (does NOT touch shader). */
import * as THREE from "three";
import { TEX, canvasTex } from "../core/textures";
import { PLAYER_RADIUS, PLAYER_LIGHT_INTENSITY, PLAYER_LIGHT_INTENSITY_CHARGED } from "../config";

export class Player {
  group: THREE.Group;
  r: number;
  pos: THREE.Vector3;
  invuln = 0;
  private coreMat: THREE.ShaderMaterial;
  private core: THREE.Mesh;
  private g1: THREE.Sprite;
  private g2: THREE.Sprite;
  private flare: THREE.Sprite;
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
          for (int i = 0; i < 4; i++){ v += a*noise(p); p *= 2.1; a *= 0.5; }
          return v;
        }
        void main(){
          float n = fbm(vP*3.0 + vec3(0.0, uTime*0.8, uTime*0.5));
          float n2 = fbm(vP*7.0 - vec3(uTime*1.2, 0.0, uTime*0.7));
          float heat = n*0.7 + n2*0.5;
          vec3 hot  = vec3(1.0, 0.98, 0.88);
          vec3 mid  = vec3(1.0, 0.72, 0.25);
          vec3 cool = vec3(0.95, 0.32, 0.05);
          vec3 col = mix(hot, mid, smoothstep(0.35, 0.62, heat));
          col = mix(col, cool, smoothstep(0.62, 0.85, heat));
          float fr = pow(1.0 - abs(dot(normalize(vN), normalize(-vW))), 2.2);
          col += vec3(1.0, 0.55, 0.15) * fr * 1.6;
          gl_FragColor = vec4(col*1.35, 1.0);
        }`,
    });
    this.core = new THREE.Mesh(new THREE.SphereGeometry(this.r, 40, 30), this.coreMat);
    this.group.add(this.core);

    // Smaller, dimmer white halo — keeps the core visible without washing out
    // nearby obstacles (gameplay readability over bloom).
    this.g1 = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.star, transparent: true, opacity: .5, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.g1.scale.setScalar(6);
    this.g2 = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.ember, transparent: true, opacity: .75, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.g2.scale.setScalar(15);
    this.group.add(this.g1, this.g2);

    // Warmer, dimmer, smaller lens flare (was bright white and oversized).
    this.flare = new THREE.Sprite(new THREE.SpriteMaterial({
      map: canvasTex(128, 128, (ctx) => {
        ctx.strokeStyle = "rgba(255,208,150,.7)";
        for (const [w, l] of [[2.4, 62], [1.2, 40]]) {
          ctx.lineWidth = w;
          ctx.beginPath();
          ctx.moveTo(64 - l, 64); ctx.lineTo(64 + l, 64);
          ctx.moveTo(64, 64 - l); ctx.lineTo(64, 64 + l);
          ctx.stroke();
        }
      }),
      transparent: true, opacity: .32, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.flare.scale.setScalar(9);
    this.group.add(this.flare);

    this.light = new THREE.PointLight(0xFFC873, PLAYER_LIGHT_INTENSITY, 110, 1.6);
    this.group.add(this.light);

    scene.add(this.group);
    this.pos = this.group.position;
  }

  /** STAR ENERGY full: brighten without touching the core shader. */
  setCharged(charged: boolean): void {
    this.light.intensity = charged ? PLAYER_LIGHT_INTENSITY_CHARGED : PLAYER_LIGHT_INTENSITY;
    this.g2.material.opacity = charged ? 0.95 : 0.75;
  }

  update(dt: number, t: number): void {
    this.coreMat.uniforms.uTime.value = t;
    this.core.rotation.y += dt * 0.6;
    this.core.rotation.x += dt * 0.25;
    this.g1.material.opacity = 0.5 + Math.sin(t * 7) * 0.06;
    this.g2.scale.setScalar(15 + Math.sin(t * 4.3) * 1.8);
    this.flare.material.rotation += dt * 0.3;
    if (this.invuln > 0) {
      this.invuln -= dt;
      const blink = Math.sin(t * 24) > 0;
      this.core.visible = blink;
      this.g1.material.opacity *= blink ? 1 : 0.15;
    } else this.core.visible = true;
  }
}
