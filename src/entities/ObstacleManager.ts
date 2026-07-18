/* ObstacleManager — ported verbatim from reference/supernova.html (validated build).
   GOLDEN RULE: behavior and visuals must remain identical. */
import * as THREE from "three";
import { rand, clamp, reduceMotion } from "../core/util";
import { CFG } from "../core/legacyCfg";
import { TEX, PlanetFactory, canvasTex, glowTex } from "../core/textures";

/* Gameplay randomness (positions, sizes, velocities, variants) flows through
   the seeded RNG when one is provided, so a fixed seed replays identically.
   Purely-visual randomness (rotation, panel angles, textures) stays on
   Math.random() and must never touch the seeded stream. */
const rr = (rng: any, a: number, b: number): number => (rng ? rng.range(a, b) : rand(a, b));
const rn = (rng: any): number => (rng ? rng.next() : Math.random());

export class ObstacleManager {
  [key: string]: any;
  constructor(scene, particles){
    this.scene = scene;
    this.particles = particles;
    this.list = [];

    const g = new THREE.IcosahedronGeometry(1, 1);
    const pos = g.attributes.position;
    const seen = new Map();
    for (let i = 0; i < pos.count; i++){
      const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
      if (!seen.has(key)) seen.set(key, 0.7 + Math.random()*0.6);
      const s = seen.get(key);
      pos.setXYZ(i, pos.getX(i)*s, pos.getY(i)*s, pos.getZ(i)*s);
    }
    g.computeVertexNormals();
    this.rockGeo = g;
    this.rockCount = 80;
    this.rocks = new THREE.InstancedMesh(g,
      new THREE.MeshStandardMaterial({map:TEX.rock, roughness:.92, metalness:.05, emissive:0x1a140c, emissiveIntensity:.62}),
      this.rockCount);
    this.rocks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rocks.frustumCulled = false;
    scene.add(this.rocks);
    this.rockSlots = Array.from({length:this.rockCount}, () => ({
      used:false, x:0, y:0, z:1e9, s:1, rx:0, ry:0, sx:0, sy:0, vx:0, vy:0
    }));
    this._dummy = new THREE.Object3D();
  }

  clear(){
    for (const o of this.list) if (o.mesh) this.scene.remove(o.mesh);
    this.list.length = 0;
    for (const s of this.rockSlots){ s.used = false; s.z = 1e9; }
  }

  rock(z: number, cx: number | null = null, cy: number | null = null, rng: any = null){
    const slot = this.rockSlots.find(s => !s.used);
    if (!slot) return;
    slot.used = true;
    slot.s = rr(rng, 1.2, 3.4);
    slot.x = cx === null ? rr(rng, -CFG.fieldX, CFG.fieldX) : clamp(cx + rr(rng, -6,6), -CFG.fieldX, CFG.fieldX);
    slot.y = cy === null ? rr(rng, -CFG.fieldY, CFG.fieldY) : clamp(cy + rr(rng, -5,5), -CFG.fieldY, CFG.fieldY);
    slot.z = z + (cx === null ? 0 : rr(rng, -4,4));
    slot.rx = Math.random()*3; slot.ry = Math.random()*3;   // visual spin only
    slot.sx = rand(-1,1); slot.sy = rand(-1,1);              // visual spin only
    slot.vx = rr(rng, -2.5,2.5); slot.vy = rr(rng, -1.8,1.8);
    this.list.push({kind:"rock", slot, r:slot.s*0.8,
      get x(){return this.slot.x}, get y(){return this.slot.y}, get z(){return this.slot.z}});
  }
  field(z, rng: any = null){
    const cx = rr(rng, -CFG.fieldX*0.6, CFG.fieldX*0.6), cy = rr(rng, -CFG.fieldY*0.6, CFG.fieldY*0.6);
    const n = 3 + (rn(rng)*4|0);
    for (let i = 0; i < n; i++) this.rock(z, cx, cy, rng);
  }
  planet(z, moon = false, rng: any = null){
    const r = moon ? rr(rng, 2.2, 3.6) : rr(rng, 4.5, 9);
    let group, body;
    if (moon){
      group = new THREE.Group();
      body = new THREE.Mesh(new THREE.SphereGeometry(r, 26, 18),
        new THREE.MeshStandardMaterial({map:PlanetFactory.mercury(), roughness:.95, metalness:.02,
          bumpMap:PlanetFactory.bump(), bumpScale:.08, emissive:0x0a0a10, emissiveIntensity:.5}));
      group.add(body);
    } else {
      const built = PlanetFactory.build(PlanetFactory.randomType(), r);
      group = built.group; body = built.body;
    }
    group.position.set(rr(rng, -CFG.fieldX, CFG.fieldX), rr(rng, -CFG.fieldY, CFG.fieldY), z);
    this.scene.add(group);
    this.list.push({kind: moon ? "moon" : "planet", mesh:group, body, r:r*0.92, spin:rand(0.04,0.14),
      gravity: !moon, gravR: r*4.5});
  }
  comet(z, rng: any = null){
    const big = rn(rng) < 0.18;                             /* comète spectaculaire */
    const scale = big ? 1.7 : 1;
    const g = new THREE.Group();
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({map:TEX.blue, transparent:true, opacity:big?1:.9, depthWrite:false, blending:THREE.AdditiveBlending}));
    glow.scale.setScalar(5.5*scale);
    g.add(glow);
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.8*scale, 14, 10), new THREE.MeshBasicMaterial({color:0xEAF6FF})));
    const fromLeft = rn(rng) < .5;
    const tailLen = big ? 22 : 13;
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.65*scale, tailLen, 10, 1, true),
      new THREE.MeshBasicMaterial({color:0x8FC6FF, transparent:true, opacity:big?.4:.32, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide}));
    tail.rotation.z = fromLeft ? -Math.PI/2 : Math.PI/2;
    tail.position.x = (fromLeft ? -1 : 1) * tailLen*0.55;
    g.add(tail);
    /* seconde queue de poussière, décalée */
    const tail2 = new THREE.Mesh(new THREE.ConeGeometry(0.4*scale, tailLen*0.8, 8, 1, true),
      new THREE.MeshBasicMaterial({color:0xE8DCC0, transparent:true, opacity:.18, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide}));
    tail2.rotation.z = (fromLeft ? -Math.PI/2 : Math.PI/2) + (fromLeft ? -0.18 : 0.18);
    tail2.position.set((fromLeft ? -1 : 1) * tailLen*0.45, tailLen*0.09, 0);
    g.add(tail2);
    g.position.set(fromLeft ? -CFG.fieldX-18 : CFG.fieldX+18, rr(rng, -CFG.fieldY, CFG.fieldY), z);
    this.scene.add(g);
    this.list.push({kind:"comet", mesh:g, r:1.4*scale, vx:(fromLeft?1:-1)*rr(rng, 16,26)*(big?0.85:1), vy:rr(rng, -3,3), sparkle:big});
  }
  debris(z, rng: any = null){
    const g = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({color:0x8a90a8, roughness:.5, metalness:.8, emissive:0x0a0c18, emissiveIntensity:.5});
    g.add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 2.2), mat));
    const panMat = new THREE.MeshStandardMaterial({color:0x1a3a8a, roughness:.4, metalness:.6, emissive:0x0a1a4a, emissiveIntensity:.7});
    const p1 = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.08, 1.3), panMat);
    p1.position.x = 2.1; p1.rotation.z = rand(-0.6, 0.2);
    const p2 = p1.clone();
    p2.position.x = -2.1; p2.rotation.z = rand(-0.2, 0.6);
    g.add(p1, p2);
    g.position.set(rr(rng, -CFG.fieldX, CFG.fieldX), rr(rng, -CFG.fieldY, CFG.fieldY), z);
    g.rotation.set(Math.random()*3, Math.random()*3, Math.random()*3);   // visual only
    this.scene.add(g);
    this.list.push({kind:"debris", mesh:g, r:1.8, spin:rand(0.8, 2.0), vx:rr(rng, -1.5,1.5), vy:rr(rng, -1,1)});
  }
  blackHole(z, rng: any = null){
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.SphereGeometry(2.4, 24, 18), new THREE.MeshBasicMaterial({color:0x000000})));
    const diskMat = new THREE.ShaderMaterial({
      uniforms:{ uTime:{value:0} },
      vertexShader:`
        varying vec3 vP;
        void main(){ vP = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader:`
        uniform float uTime; varying vec3 vP;
        void main(){
          float r = length(vP.xy);
          float a = atan(vP.y, vP.x);
          float swirl = sin(a*3.0 + uTime*4.0 - r*2.2)*0.5 + 0.5;
          float band = smoothstep(2.6, 3.0, r) * (1.0 - smoothstep(5.2, 6.4, r));
          vec3 col = mix(vec3(1.0,0.55,0.12), vec3(0.85,0.6,0.3), swirl);
          col += vec3(1.0,0.9,0.7) * pow(band*swirl, 3.0);
          gl_FragColor = vec4(col*1.3, band * (0.5 + swirl*0.45));
        }`,
      transparent:true, depthWrite:false, blending:THREE.AdditiveBlending, side:THREE.DoubleSide
    });
    const disk = new THREE.Mesh(new THREE.RingGeometry(2.6, 6.4, 64, 4), diskMat);
    disk.rotation.x = Math.PI/2 + rand(-0.5, 0.5);
    g.add(disk);
    g.position.set(rr(rng, -CFG.fieldX*0.7, CFG.fieldX*0.7), rr(rng, -CFG.fieldY*0.7, CFG.fieldY*0.7), z);
    this.scene.add(g);
    this.list.push({kind:"blackhole", mesh:g, diskMat, r:2.6, pullR:26, pull:26});
  }

  update(dt, t, player, game){
    for (const s of this.rockSlots){
      if (!s.used) continue;
      s.rx += s.sx*dt; s.ry += s.sy*dt;
      s.x += s.vx*dt; s.y += s.vy*dt;
      if (Math.abs(s.x) > CFG.fieldX){ s.vx *= -1; s.x = Math.sign(s.x)*CFG.fieldX; }
      if (Math.abs(s.y) > CFG.fieldY){ s.vy *= -1; s.y = Math.sign(s.y)*CFG.fieldY; }
    }
    let mi = 0;
    for (const s of this.rockSlots){
      this._dummy.position.set(s.used ? s.x : 0, s.used ? s.y : 0, s.used ? s.z : 1e9);
      this._dummy.rotation.set(s.rx, s.ry, 0);
      this._dummy.scale.setScalar(s.s || 1);
      this._dummy.updateMatrix();
      this.rocks.setMatrixAt(mi++, this._dummy.matrix);
    }
    this.rocks.instanceMatrix.needsUpdate = true;

    const cullZ = player.pos.z + 36;
    for (let i = this.list.length-1; i >= 0; i--){
      const o = this.list[i];
      const oz = o.mesh ? o.mesh.position.z : o.z;
      if (oz > cullZ || (o.mesh && Math.abs(o.mesh.position.x) > CFG.fieldX + 40)){
        this._remove(i);
        continue;
      }
      if (o.mesh){
        if (o.spin){ o.mesh.rotation.y += o.spin*dt; if (o.kind === "debris") o.mesh.rotation.x += o.spin*0.7*dt; }
        if (o.body) o.body.rotation.y += 0.08*dt;
        if (o.vx || o.vy){ o.mesh.position.x += o.vx*dt; o.mesh.position.y += o.vy*dt; }
        if (o.diskMat) o.diskMat.uniforms.uTime.value = t;
        if (o.sparkle && Math.random() < 0.4)
          this.particles.emit(o.mesh.position.clone().add(new THREE.Vector3(rand(-1,1), rand(-1,1), rand(-1,1))),
            new THREE.Vector3(-o.vx*0.3 + rand(-2,2), rand(-2,2), rand(-2,2)), 0.5, 1.4, 0xbfe0ff);
      }
      const ox = o.mesh ? o.mesh.position.x : o.x;
      const oy = o.mesh ? o.mesh.position.y : o.y;
      const dx = ox - player.pos.x, dy = oy - player.pos.y, dz = oz - player.pos.z;
      const dist = Math.max(0.001, Math.sqrt(dx*dx + dy*dy + dz*dz));

      if (o.gravity && dist < o.gravR){
        const pull = (1 - dist/o.gravR) * 7;
        player.pos.x += (dx/dist) * pull * dt;
        player.pos.y += (dy/dist) * pull * dt;
        game.shake = Math.max(game.shake, (1 - dist/o.gravR)*0.18);
        if (Math.random() < 0.3)
          this.particles.emit(
            new THREE.Vector3(ox - dx*rand(.2,.8), oy - dy*rand(.2,.8), oz - dz*rand(.2,.8)),
            new THREE.Vector3(dx, dy, dz).normalize().multiplyScalar(8),
            0.5, 1.2, 0x9ac8ff);
      }
      if (o.kind === "blackhole" && dist < o.pullR){
        const pull = (1 - dist/o.pullR) * o.pull;
        player.pos.x += (dx/dist) * pull * dt;
        player.pos.y += (dy/dist) * pull * dt;
        game.shake = Math.max(game.shake, (1 - dist/o.pullR)*0.4);
      }

      if (player.invuln <= 0 && game.running){
        const hit = (o.r + player.r)*0.8;
        if (dist < hit){
          game.onHit(o, i);
          continue;
        }
        if (!o.grazed && Math.abs(dz) < 2.5 && dist < o.r + player.r + CFG.nearMissDist){
          o.grazed = true;
          game.onGraze(new THREE.Vector3(ox, oy, oz));
        }
      }
    }
    player.pos.x = clamp(player.pos.x, -CFG.fieldX+1.2, CFG.fieldX-1.2);
    player.pos.y = clamp(player.pos.y, -CFG.fieldY+1.2, CFG.fieldY-1.2);
  }
  _remove(i){
    const o = this.list[i];
    if (o.mesh) this.scene.remove(o.mesh);
    if (o.slot){ o.slot.used = false; o.slot.z = 1e9; }
    this.list.splice(i, 1);
  }
  removeAndExplode(i, particles){
    const o = this.list[i];
    const p = o.mesh ? o.mesh.position.clone() : new THREE.Vector3(o.x, o.y, o.z);
    particles.burst(p, 22, 26, 3, 0xffb060);
    particles.burst(p, 12, 16, 1.6, 0xfff0d0);
    this._remove(i);
  }
}
