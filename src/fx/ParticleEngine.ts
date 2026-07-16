/* ParticleSystem — ported verbatim from reference/supernova.html (validated build).
   GOLDEN RULE: behavior and visuals must remain identical. */
import * as THREE from "three";
import { rand, clamp, reduceMotion } from "../core/util";
import { TEX, PlanetFactory, canvasTex, glowTex } from "../core/textures";

export class ParticleSystem {
  [key: string]: any;
  constructor(scene, n = 700){
    this.n = n;
    this.data = Array.from({length:n}, () => ({
      p:new THREE.Vector3(1e9,0,0), v:new THREE.Vector3(), life:0, max:1, size:1, c:new THREE.Color(1,1,1)
    }));
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(n*3);
    this.col = new Float32Array(n*3);
    this.sz  = new Float32Array(n);
    this.al  = new Float32Array(n);
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute("aColor", new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute("aSize", new THREE.BufferAttribute(this.sz, 1));
    this.geo.setAttribute("aAlpha", new THREE.BufferAttribute(this.al, 1));
    this.mesh = new THREE.Points(this.geo, new THREE.ShaderMaterial({
      uniforms:{ uTex:{value:TEX.spark} },
      vertexShader:`
        attribute float aSize; attribute float aAlpha; attribute vec3 aColor;
        varying float vA; varying vec3 vC;
        void main(){
          vA = aAlpha; vC = aColor;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (160.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader:`
        uniform sampler2D uTex; varying float vA; varying vec3 vC;
        void main(){
          vec4 c = texture2D(uTex, gl_PointCoord);
          gl_FragColor = vec4(c.rgb * vC, c.a * vA);
        }`,
      transparent:true, depthWrite:false, blending:THREE.AdditiveBlending
    }));
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.cursor = 0;
  }
  emit(pos, vel, life, size, color){
    const d = this.data[this.cursor];
    this.cursor = (this.cursor+1) % this.n;
    d.p.copy(pos); d.v.copy(vel);
    d.life = d.max = life; d.size = size; d.c.set(color);
  }
  burst(pos, n, speed, size, color, spread = 1){
    for (let i = 0; i < n; i++){
      const v = new THREE.Vector3(rand(-1,1), rand(-1,1), rand(-1,1)*spread).normalize()
        .multiplyScalar(rand(speed*0.4, speed));
      this.emit(pos, v, rand(.4,.9), size*rand(.6,1.4), color);
    }
  }
  /** Live particle count (debug overlay only — not called in normal play). */
  activeCount(){
    let c = 0;
    for (let i = 0; i < this.n; i++) if (this.data[i].life > 0) c++;
    return c;
  }
  update(dt){
    for (let i = 0; i < this.n; i++){
      const d = this.data[i];
      if (d.life > 0){
        d.life -= dt;
        d.p.addScaledVector(d.v, dt);
        d.v.multiplyScalar(1 - dt*1.5);
        if (d.life <= 0) d.p.set(1e9,0,0);
      }
      this.pos[i*3] = d.p.x; this.pos[i*3+1] = d.p.y; this.pos[i*3+2] = d.p.z;
      const f = Math.max(0, d.life/d.max);
      this.sz[i] = d.size * (0.4 + f*0.6);
      this.al[i] = f;
      this.col[i*3] = d.c.r; this.col[i*3+1] = d.c.g; this.col[i*3+2] = d.c.b;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
  }
}
