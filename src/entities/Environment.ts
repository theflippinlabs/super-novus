/* Environment — ported verbatim from reference/supernova.html (validated build).
   GOLDEN RULE: behavior and visuals must remain identical. */
import * as THREE from "three";
import { rand, clamp, reduceMotion } from "../core/util";
import { CFG } from "../core/legacyCfg";
import { TEX, PlanetFactory, canvasTex, glowTex } from "../core/textures";

export class Environment {
  [key: string]: any;
  constructor(scene){
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    /* --- nébuleuses très subtiles (4, faible opacité) --- */
    const nebs = [
      [TEX.nebula(258, 292), 620, -120, 60, -340, .36],
      [TEX.nebula(210, 245), 680, 180, -80, -390, .32],
      [TEX.nebula(272, 305), 540, -220, -110, -320, .28],
      [TEX.nebula(196, 226), 580, 90, 170, -370, .26],
      [TEX.nebula(300, 338), 640, -40, -200, -360, .22],   // violet/magenta accent for colour depth
    ];
    for (const [t, s, x, y, z, o] of nebs){
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({map:t, transparent:true, opacity:o, depthWrite:false, blending:THREE.AdditiveBlending}));
      sp.scale.setScalar(s);
      sp.position.set(x, y, z);
      this.group.add(sp);
    }

    /* --- galaxies lointaines discrètes --- */
    for (const [s, x, y, z, rot, o] of [[190, 230, 150, -440, .4, .5], [130, -270, -130, -420, -.7, .42], [90, 60, -220, -430, 1.1, .34], [150, -130, 205, -455, .28, .3]]){
      const gal = new THREE.Sprite(new THREE.SpriteMaterial({map:TEX.galaxy, transparent:true, opacity:o, depthWrite:false, blending:THREE.AdditiveBlending, rotation:rot}));
      gal.scale.setScalar(s);
      gal.position.set(x, y, z);
      this.group.add(gal);
    }

    /* --- ÉTOILE-REPÈRE (point de repère galactique) — atténuée : le grand
       flare blanc et le halo cramaient l'écran et gênaient la lisibilité. --- */
    this.landmark = new THREE.Group();
    const lmCore = new THREE.Sprite(new THREE.SpriteMaterial({map:TEX.white, transparent:true, opacity:.55, depthWrite:false, blending:THREE.AdditiveBlending}));
    lmCore.scale.setScalar(38);
    this.landmark.add(lmCore);
    this.lmFlare = new THREE.Sprite(new THREE.SpriteMaterial({map:TEX.flareCross, transparent:true, opacity:.38, depthWrite:false, blending:THREE.AdditiveBlending}));
    this.lmFlare.scale.setScalar(90);
    this.landmark.add(this.lmFlare);
    /* halo volumétrique très subtil */
    const lmHalo = new THREE.Sprite(new THREE.SpriteMaterial({map:TEX.white, transparent:true, opacity:.05, depthWrite:false, blending:THREE.AdditiveBlending}));
    lmHalo.scale.setScalar(240);
    this.landmark.add(lmHalo);
    this.landmark.position.set(-150, 170, -430);
    this.group.add(this.landmark);

    /* --- étoiles : ~3200 points, 3 couches --- */
    const mkStars = (n, size, spread, colors, op) => {
      const g = new THREE.BufferGeometry();
      const a = new Float32Array(n*3), c = new Float32Array(n*3);
      const col = new THREE.Color();
      for (let i = 0; i < n; i++){
        const r = spread + Math.random()*200, th = Math.random()*Math.PI*2, ph = Math.acos(2*Math.random()-1);
        a[i*3] = r*Math.sin(ph)*Math.cos(th); a[i*3+1] = r*Math.sin(ph)*Math.sin(th); a[i*3+2] = r*Math.cos(ph);
        col.set(colors[(Math.random()*colors.length)|0]);
        c[i*3] = col.r; c[i*3+1] = col.g; c[i*3+2] = col.b;
      }
      g.setAttribute("position", new THREE.BufferAttribute(a,3));
      g.setAttribute("color", new THREE.BufferAttribute(c,3));
      this.group.add(new THREE.Points(g, new THREE.PointsMaterial({vertexColors:true, size, sizeAttenuation:true, transparent:true, opacity:op, depthWrite:false})));
    };
    // Cooler, blue/violet-leaning star field — denser for more depth (Points are cheap).
    mkStars(2100, 0.9, 330, [0xffffff, 0xdfe8ff, 0xcfe0ff, 0xe8f4ff], .95);
    mkStars(1100, 1.7, 270, [0xbdd4ff, 0xbfe0ff, 0xe6d8ff, 0xc8f0ff], .72);
    mkStars(900, 0.5, 400, [0xffffff, 0xcfd8ee, 0xb9c6ee], .8);

    /* --- planètes de décor réalistes, distances variées --- */
    this.decor = [];
    this.nextDecorZ = -300;

    /* --- astéroïdes d'arrière/avant-plan (non-collision, profondeur) --- */
    this.bgRockCount = 26;
    this.bgRocks = new THREE.InstancedMesh(
      new THREE.IcosahedronGeometry(1, 1),
      new THREE.MeshStandardMaterial({map:TEX.rock, roughness:.95, metalness:.03, emissive:0x0e0a06, emissiveIntensity:.45}),
      this.bgRockCount);
    this.bgRocks.frustumCulled = false;
    this.bgRocks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.bgRocks);
    this.bgSlots = Array.from({length:this.bgRockCount}, () => this._newBgRock(true));
    this._dummy = new THREE.Object3D();

    /* --- météores rapides en diagonale --- */
    this.meteors = [];
    for (let i = 0; i < 5; i++){
      const head = new THREE.Sprite(new THREE.SpriteMaterial({map:TEX.white, transparent:true, opacity:0, depthWrite:false, blending:THREE.AdditiveBlending}));
      head.scale.setScalar(1.6);
      const trailSp = new THREE.Sprite(new THREE.SpriteMaterial({map:TEX.white, transparent:true, opacity:0, depthWrite:false, blending:THREE.AdditiveBlending, color:0xcfe2ff}));
      scene.add(head, trailSp);
      this.meteors.push({head, trail:trailSp, active:false, v:new THREE.Vector3(), life:0});
    }
    this.meteorTimer = rand(1.2, 3);

    /* --- poussière cosmique : deux couches de parallaxe --- */
    this.DUST_N = 420; this.DUST_BOX = 190;
    this.speedGeo = new THREE.BufferGeometry();
    const dArr = new Float32Array(this.DUST_N*3);
    for (let i = 0; i < this.DUST_N; i++){
      dArr[i*3] = rand(-1,1)*this.DUST_BOX*0.5;
      dArr[i*3+1] = rand(-1,1)*this.DUST_BOX*0.35;
      dArr[i*3+2] = -Math.random()*this.DUST_BOX;
    }
    this.speedGeo.setAttribute("position", new THREE.BufferAttribute(dArr, 3));
    const sd = new THREE.Points(this.speedGeo, new THREE.PointsMaterial({color:0xbcd0ff, size:0.46, transparent:true, opacity:.62, depthWrite:false}));
    sd.frustumCulled = false;
    scene.add(sd);
    this.dustMat = sd.material;   // scaled with speed for a stronger streak feel

    this.DUST2_N = 180; this.DUST2_BOX = 340;
    this.dust2Geo = new THREE.BufferGeometry();
    const d2 = new Float32Array(this.DUST2_N*3);
    for (let i = 0; i < this.DUST2_N; i++){
      d2[i*3] = rand(-1,1)*this.DUST2_BOX*0.5;
      d2[i*3+1] = rand(-1,1)*this.DUST2_BOX*0.35;
      d2[i*3+2] = -Math.random()*this.DUST2_BOX;
    }
    this.dust2Geo.setAttribute("position", new THREE.BufferAttribute(d2, 3));
    const sd2 = new THREE.Points(this.dust2Geo, new THREE.PointsMaterial({color:0x9aa0d8, size:0.85, transparent:true, opacity:.32, depthWrite:false}));
    sd2.frustumCulled = false;
    scene.add(sd2);
  }

  _newBgRock(init){
    return {
      x: (Math.random()<.5?-1:1) * rand(CFG.fieldX+6, CFG.fieldX+42),
      y: rand(-CFG.fieldY-24, CFG.fieldY+24),
      z: init ? -rand(0, 300) : -rand(280, 360),
      s: rand(0.8, 4.5),
      rx: Math.random()*3, ry: Math.random()*3,
      sx: rand(-0.8,0.8), sy: rand(-0.8,0.8),
    };
  }

  clearDecor(){
    for (const d of this.decor) this.scene.remove(d.mesh);
    this.decor.length = 0;
    this.nextDecorZ = -300;
  }
  /* Decor planets in three depth tiers → real parallax + open space:
     - distant : far & small (background depth), common but never clutter
     - medium  : occasional
     - close   : big cinematic planet, rare special event
     None are collidable (pure visual). */
  spawnDecor(playerZ, tier = "distant"){
    const T = ({
      distant: { r:[18,34], x:[150,330], ahead:[440,780], spin:[0.006,0.018] },
      medium:  { r:[26,44], x:[95,185],  ahead:[320,540], spin:[0.012,0.030] },
      close:   { r:[46,66], x:[52,110],  ahead:[190,300], spin:[0.020,0.045] },
    })[tier] || { r:[18,34], x:[150,330], ahead:[440,780], spin:[0.006,0.018] };
    const r = rand(T.r[0], T.r[1]);
    const {group, body} = PlanetFactory.build(PlanetFactory.randomType(), r);
    const side = Math.random() < .5 ? -1 : 1;
    group.position.set(side * rand(T.x[0], T.x[1]), rand(-80, 80), playerZ - rand(T.ahead[0], T.ahead[1]));
    this.scene.add(group);
    this.decor.push({mesh:group, body, spin:rand(T.spin[0], T.spin[1])});
  }

  update(dt, player, speed, running){
    this.group.position.copy(player.pos);
    this.group.rotation.y += dt*0.002;
    this.lmFlare.material.rotation += dt*0.05;

    // Speed streaks: the near cosmic dust grows + brightens with velocity, so the
    // faster the run the stronger the sense of motion (visual only).
    const spd01 = Math.max(0, Math.min(1, (speed - CFG.baseSpeed) / (CFG.maxSpeed - CFG.baseSpeed)));
    // Stronger streaks at speed — the faster the run, the more the dust stretches
    // into passing light-lines for a real sense of hurtling through space.
    this.dustMat.size = 0.42 + spd01 * spd01 * 1.0;
    this.dustMat.opacity = 0.54 + spd01 * 0.32;

    if (running && player.pos.z < this.nextDecorZ){
      // Weighted composition: mostly open space, distant planets for depth,
      // rare close cinematic planets (≈ open / distant / close).
      const roll = Math.random();
      if (roll < 0.50) { /* open space — spawn nothing */ }
      else if (roll < 0.88) this.spawnDecor(player.pos.z, "distant");
      else if (roll < 0.95) this.spawnDecor(player.pos.z, "medium");
      else this.spawnDecor(player.pos.z, "close");
      this.nextDecorZ = player.pos.z - rand(300, 520); // sparse beats
    }
    for (let i = this.decor.length-1; i >= 0; i--){
      const d = this.decor[i];
      d.body.rotation.y += d.spin*dt;
      if (d.mesh.position.z > player.pos.z + 150){
        this.scene.remove(d.mesh);
        this.decor.splice(i,1);
      }
    }

    /* astéroïdes de profondeur */
    let mi = 0;
    for (const s of this.bgSlots){
      s.rx += s.sx*dt; s.ry += s.sy*dt;
      const wz = player.pos.z + s.z % 1;
      if (s.z > player.pos.z + 30) Object.assign(s, this._newBgRock(false), {z: player.pos.z - rand(280, 360)});
      this._dummy.position.set(s.x, s.y, s.z);
      this._dummy.rotation.set(s.rx, s.ry, 0);
      this._dummy.scale.setScalar(s.s);
      this._dummy.updateMatrix();
      this.bgRocks.setMatrixAt(mi++, this._dummy.matrix);
    }
    this.bgRocks.instanceMatrix.needsUpdate = true;

    /* météores diagonaux */
    this.meteorTimer -= dt;
    if (this.meteorTimer <= 0 && running){
      this.meteorTimer = rand(1.6, 4.2);
      const m = this.meteors.find(m => !m.active);
      if (m){
        m.active = true;
        m.life = rand(0.9, 1.4);
        const z = player.pos.z - rand(60, 160);
        m.head.position.set(rand(-70, 70), rand(30, 60), z);
        m.v.set(rand(-1,1) < 0 ? rand(-90,-55) : rand(55,90), rand(-70,-40), rand(-8,8));
        m.head.material.opacity = .95;
        m.trail.material.opacity = .4;
      }
    }
    for (const m of this.meteors){
      if (!m.active) continue;
      m.life -= dt;
      m.head.position.addScaledVector(m.v, dt);
      const len = 9;
      m.trail.position.copy(m.head.position).addScaledVector(m.v.clone().normalize(), -len*0.5);
      m.trail.material.rotation = Math.atan2(m.v.y, m.v.x);
      m.trail.scale.set(len, 0.55, 1);
      if (m.life < 0.3){
        m.head.material.opacity = m.life/0.3 * .95;
        m.trail.material.opacity = m.life/0.3 * .4;
      }
      if (m.life <= 0){
        m.active = false;
        m.head.material.opacity = 0;
        m.trail.material.opacity = 0;
      }
    }

    /* poussière cosmique, 2 couches */
    const dp = this.speedGeo.attributes.position;
    for (let i = 0; i < this.DUST_N; i++){
      let z = dp.getZ(i) + (running ? speed*dt : dt*14);
      if (z > player.pos.z + 12){
        z -= this.DUST_BOX;
        dp.setX(i, player.pos.x + rand(-1,1)*this.DUST_BOX*0.5);
        dp.setY(i, player.pos.y + rand(-1,1)*this.DUST_BOX*0.35);
      }
      dp.setZ(i, z);
    }
    dp.needsUpdate = true;
    const dp2 = this.dust2Geo.attributes.position;
    for (let i = 0; i < this.DUST2_N; i++){
      let z = dp2.getZ(i) + (running ? speed*dt*0.4 : dt*6);
      if (z > player.pos.z + 20){
        z -= this.DUST2_BOX;
        dp2.setX(i, player.pos.x + rand(-1,1)*this.DUST2_BOX*0.5);
        dp2.setY(i, player.pos.y + rand(-1,1)*this.DUST2_BOX*0.35);
      }
      dp2.setZ(i, z);
    }
    dp2.needsUpdate = true;
  }
}
