/* Trail — ported verbatim from reference/supernova.html (validated build).
   GOLDEN RULE: behavior and visuals must remain identical. */
import * as THREE from "three";
import { TEX, PlanetFactory, canvasTex, glowTex } from "../core/textures";

export class Trail {
  [key: string]: any;
  constructor(scene){
    // Blue-cyan comet trail to match the recoloured plasma core.
    this.layers = [
      this._make(scene, TEX.star, "0.34, 0.70, 1.20", 4.0, 160),
      this._make(scene, TEX.star, "0.72, 0.95, 1.20", 2.0, 100),
    ];
    this.hist = [];
  }
  _make(scene, tex, tint, baseSize, n){
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n*3), size = new Float32Array(n), alpha = new Float32Array(n);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geo.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
    const pts = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms:{ uTex:{value:tex} },
      vertexShader:`
        attribute float aSize; attribute float aAlpha; varying float vA;
        void main(){
          vA = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * (150.0 / -mv.z);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader:`
        uniform sampler2D uTex; varying float vA;
        void main(){
          vec4 c = texture2D(uTex, gl_PointCoord);
          gl_FragColor = vec4(c.rgb * vec3(${tint}), c.a * vA);
        }`,
      transparent:true, depthWrite:false, blending:THREE.AdditiveBlending
    }));
    pts.frustumCulled = false;
    scene.add(pts);
    return {geo, pos, size, alpha, n, baseSize};
  }
  reset(){ this.hist.length = 0; }
  update(playerPos){
    this.hist.unshift([playerPos.x, playerPos.y, playerPos.z]);
    if (this.hist.length > this.layers[0].n) this.hist.pop();
    for (const L of this.layers){
      for (let i = 0; i < L.n; i++){
        const h = this.hist[Math.min(i, this.hist.length-1)] || [playerPos.x, playerPos.y, playerPos.z];
        const j = 0.14 + i*0.016;
        L.pos[i*3]   = h[0] + (Math.random()-0.5)*j;
        L.pos[i*3+1] = h[1] + (Math.random()-0.5)*j;
        L.pos[i*3+2] = h[2];
        const fade = 1 - i/L.n;
        L.size[i] = (L.baseSize + Math.sin(i*0.7)*0.5)*fade + 0.3;
        L.alpha[i] = fade*fade*0.95;
      }
      L.geo.attributes.position.needsUpdate = true;
      L.geo.attributes.aSize.needsUpdate = true;
      L.geo.attributes.aAlpha.needsUpdate = true;
    }
  }
}
