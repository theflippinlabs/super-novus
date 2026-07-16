/* StarDustSystem — ported verbatim from reference/supernova.html (validated build).
   GOLDEN RULE: behavior and visuals must remain identical. */
import * as THREE from "three";
import { rand, clamp, reduceMotion } from "../core/util";
import { CFG } from "../core/legacyCfg";
import { TEX, PlanetFactory, canvasTex, glowTex } from "../core/textures";

export class StarDustSystem {
  [key: string]: any;
  constructor(scene, particles, audio){
    this.scene = scene;
    this.particles = particles;
    this.audio = audio;
    this.clusters = [];
  }
  clear(){
    for (const c of this.clusters) this.scene.remove(c.pts);
    this.clusters.length = 0;
  }
  spawnChain(z, rng: any = null){
    // Chain layout is gameplay (what the player can collect) → seeded RNG.
    // The per-cluster point cloud in spawnCluster stays visual (Math.random).
    const rr = (a, b) => (rng ? rng.range(a, b) : rand(a, b));
    const n = 4 + ((rng ? rng.next() : Math.random())*4|0);
    const x0 = rr(-CFG.fieldX*0.7, CFG.fieldX*0.7), y0 = rr(-CFG.fieldY*0.7, CFG.fieldY*0.7);
    const dx = rr(-2.6, 2.6), dy = rr(-1.8, 1.8), curve = rr(-0.5, 0.5);
    for (let i = 0; i < n; i++){
      this.spawnCluster(
        clamp(x0 + dx*i + curve*i*i*0.4, -CFG.fieldX, CFG.fieldX),
        clamp(y0 + dy*i, -CFG.fieldY, CFG.fieldY),
        z - i*5.5
      );
    }
  }
  spawnCluster(x, y, z){
    const N = 26;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N*3);
    for (let i = 0; i < N; i++){
      const v = new THREE.Vector3(rand(-1,1), rand(-1,1), rand(-1,1)).normalize().multiplyScalar(rand(0.2, 1.6));
      pos[i*3] = v.x; pos[i*3+1] = v.y; pos[i*3+2] = v.z;
    }
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      map:TEX.gold, size:1.3, transparent:true, opacity:.95,
      blending:THREE.AdditiveBlending, depthWrite:false, sizeAttenuation:true
    }));
    pts.position.set(x, y, z);
    this.scene.add(pts);
    this.clusters.push({pts, t:Math.random()*6, r:2.4});
  }
  update(dt, t, player, game){
    const cullZ = player.pos.z + 36;
    for (let i = this.clusters.length-1; i >= 0; i--){
      const c = this.clusters[i];
      c.t += dt;
      c.pts.rotation.y += dt*1.4;
      c.pts.material.size = 1.3 + Math.sin(c.t*5)*0.3;
      if (c.pts.position.z > cullZ){
        this.scene.remove(c.pts);
        this.clusters.splice(i,1);
        continue;
      }
      const d = c.pts.position.distanceTo(player.pos);
      if (d < 7){
        const dir = new THREE.Vector3().subVectors(player.pos, c.pts.position).normalize();
        c.pts.position.addScaledVector(dir, (7-d)*7*dt);
      }
      if (d < c.r + player.r){
        this.particles.burst(c.pts.position, 22, 20, 2.2, 0xffe9a0, 0.6);
        this.particles.burst(c.pts.position, 10, 10, 1.2, 0xffffff, 0.6);
        this.audio.ping();
        if (navigator.vibrate) navigator.vibrate(10);
        game.collectDust();
        this.scene.remove(c.pts);
        this.clusters.splice(i,1);
      }
    }
  }
}
