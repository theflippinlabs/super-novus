/* GameEngine — ported from reference/supernova.html (validated build).
   Gameplay loop, spawn, collisions, death sequence: VERBATIM.
   Adapted: wallet/guest menu wiring, offline-first local best. */
import * as THREE from "three";
import { rand, clamp, reduceMotion } from "./util";
import { CFG } from "./legacyCfg";
import { AudioManager } from "../audio/AudioManager";
import { ParticleSystem } from "../fx/ParticleEngine";
import { Player } from "../entities/Player";
import { Trail } from "../entities/Trail";
import { ObstacleManager } from "../entities/ObstacleManager";
import { StarDustSystem } from "../entities/StarDustSystem";
import { Environment } from "../entities/Environment";
import { CameraController } from "./CameraController";
import { SpawnManager } from "./SpawnManager";
import { UIManager } from "../ui/UIManager";
import { WalletManager } from "../net/WalletManager";
import { Leaderboard } from "../net/Leaderboard";
import {
  STAR_DUST_ENERGY, STAR_ENERGY_MAX,
  NOVA_RADIUS, NOVA_BLAST_FORWARD, NOVA_DAMAGE_SCORE,
  FOV_NOVA_PUNCH, TONE_EXPOSURE, TONE_EXPOSURE_NOVA,
  DOUBLE_TAP_DELAY, DOUBLE_TAP_MAX_DIST, TAP_MAX_MOVE,
  BASE_SPEED, MAX_SPEED, LEVEL_DURATION,
  SPEED_MULTIPLIERS, SPEED_MULT_STEP, SPEED_MULT_CAP,
  OBSTACLE_DENSITIES, DENSITY_STEP, DENSITY_CAP,
} from "../config";

const SPAWN_STEP_BASE = 14; // reference band spacing at level-1 density

export class GameEngine {
  [key: string]: any;
  constructor(){
    this.renderer = new THREE.WebGLRenderer({antialias:true, powerPreference:"high-performance"});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    document.body.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x02020e);
    this.scene.fog = new THREE.Fog(0x05051a, 170, 420);

    this.camera = new THREE.PerspectiveCamera(84, innerWidth/innerHeight, 0.1, 1400);

    /* éclairage : lumière directionnelle depuis l'étoile-repère → terminateur réaliste */
    this.scene.add(new THREE.AmbientLight(0x2c3050, 0.85));
    const sunLight = new THREE.DirectionalLight(0xf2ecdc, 1.7);
    sunLight.position.set(-150, 170, 60);
    this.scene.add(sunLight);
    const fill = new THREE.DirectionalLight(0x8090c0, 0.22);
    fill.position.set(120, -60, -40);
    this.scene.add(fill);

    this.audio = new AudioManager();
    this.wallet = new WalletManager();
    this.leaderboard = new Leaderboard(this.wallet);
    this.particles = new ParticleSystem(this.scene);
    this.player = new Player(this.scene);
    this.trail = new Trail(this.scene);
    this.obstacles = new ObstacleManager(this.scene, this.particles);
    this.stardust = new StarDustSystem(this.scene, this.particles, this.audio);
    this.fixedSeed = this._parseSeed();      // ?seed=N pins a deterministic run
    this.spawn = new SpawnManager({obstacles:this.obstacles, stardust:this.stardust}, this.fixedSeed ?? undefined);
    this.env = new Environment(this.scene);
    this.camCtl = new CameraController(this.camera);
    this.ui = new UIManager();

    this.running = false; this.paused = false;
    this.score = 0; this.dist = 0; this.dust = 0; this.best = 0;
    this.energy = 0; this.charged = false;
    this.lives = CFG.lives; this.level = 1;
    this.speed = CFG.baseSpeed;
    this.shake = 0; this.timeScale = 1; this.slowmoT = 0;
    this.fovPunch = 0;
    this.nextZ = -70; this.levelT = 0;
    this.clock = new THREE.Clock();
    this.elapsed = 0;

    this._bindInput();
    this._bindUI();
    this._initAuth();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);

    addEventListener("resize", () => {
      this.camera.aspect = innerWidth/innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });

    // Tab visibility: suspend/resume the shared AudioContext (never recreate).
    document.addEventListener("visibilitychange", () => {
      if (document.hidden){
        this.audio.suspendContext();
      } else {
        this.audio.resumeContext(!this.paused); // don't relaunch music while paused
        this.clock.getDelta();                  // avoid a dt jump on return
      }
    });
  }

  async _initAuth(){
    const refresh = () => this.ui.setAuth(this.wallet.getAddress(), this.wallet.available, this.wallet.getChainId());
    this.wallet.onChange(refresh);
    refresh();
    if (this.leaderboard.available)
      this.ui.renderBoard(this.ui.lbListMenu, await this.leaderboard.top(8), this.wallet.getAddress());
    else
      this.ui.hideBoards();
    // best local (offline-first) affiché dès le menu
    this.best = this.leaderboard.getLocalBest().score;
    const addr = await this.wallet.tryReconnect();
    if (addr) refresh();
  }

  _bindInput(){
    this.drag = null;
    this._lastTap = null; // {x,y,time} of the previous stationary tap (Nova Blast)
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", e => {
      this.audio.init();
      if (!this.running || this.paused) return;
      // Track this pointer's origin + max drift so pointerup can tell a tap
      // (near-stationary) from a drag. Nova detection lives ONLY on pointerup;
      // it never blocks or delays the direct-position drag below.
      this.drag = {sx:e.clientX, sy:e.clientY, px:this.player.pos.x, py:this.player.pos.y,
        dx:e.clientX, dy:e.clientY, moved:0};
    });
    addEventListener("pointermove", e => {
      if (!this.drag || !this.running || this.paused) return;
      this.drag.moved = Math.max(this.drag.moved, Math.hypot(e.clientX - this.drag.dx, e.clientY - this.drag.dy));
      const kx = (CFG.fieldX*2) / (innerWidth*0.62);
      const ky = (CFG.fieldY*2) / (innerHeight*0.55);
      this.player.pos.x = clamp(this.drag.px + (e.clientX - this.drag.sx)*kx, -CFG.fieldX+1.2, CFG.fieldX-1.2);
      this.player.pos.y = clamp(this.drag.py - (e.clientY - this.drag.sy)*ky, -CFG.fieldY+1.2, CFG.fieldY-1.2);
    });
    addEventListener("pointerup", e => {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      // A tap must have barely moved; a drag can never fire Nova.
      if (d.moved >= TAP_MAX_MOVE){ this._lastTap = null; return; }
      const now = performance.now();
      const prev = this._lastTap;
      if (prev && (now - prev.time) < DOUBLE_TAP_DELAY &&
          Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < DOUBLE_TAP_MAX_DIST){
        this._lastTap = null;
        this._tryNova();
      } else {
        this._lastTap = {x:e.clientX, y:e.clientY, time:now};
      }
    });
    addEventListener("pointercancel", () => { this.drag = null; this._lastTap = null; });

    this.keys = {};
    addEventListener("keydown", e => {
      if (e.key === " " || e.code === "Space"){ e.preventDefault(); this._tryNova(); }
      this.keys[e.key] = true;
    });
    addEventListener("keyup", e => this.keys[e.key] = false);
  }

  /** Gate: only fire Nova when fully charged and actively playing. */
  _tryNova(){
    if (this.charged && this.running && !this.paused) this.novaBlast();
  }

  _bindUI(){
    this.ui.playBtn.addEventListener("click", () => { this.audio.init(); this.start(); });
    document.getElementById("retryBtn")!.addEventListener("click", () => this.start());
    this.ui.pauseBtn.addEventListener("click", () => {
      if (!this.running) return;
      this.paused = true;
      this.ui.pauseScreen.style.display = "flex";
      this.audio.setHum(0, false);   // cut the speed hum
      this.audio.stopMusic();        // suspend the generative-music timer
    });
    document.getElementById("resumeBtn")!.addEventListener("click", () => {
      this.paused = false;
      this.ui.pauseScreen.style.display = "none";
      this.audio.startMusic();       // relaunch the music loop
      this.clock.getDelta();         // resync so dt doesn't jump on resume
    });
    this.ui.walletBtn.addEventListener("click", async () => {
      this.ui.walletBtn.disabled = true;
      this.ui.walletState.textContent = "Connexion en cours…";
      try {
        await this.wallet.connect();
        this.ui.setAuth(this.wallet.getAddress(), this.wallet.available, this.wallet.getChainId());
        if (this.leaderboard.available)
          this.ui.renderBoard(this.ui.lbListMenu, await this.leaderboard.top(8), this.wallet.getAddress());
      } catch (e) {
        this.ui.setAuth(null, this.wallet.available, null);
        this.ui.setWalletError(e instanceof Error ? e.message : "erreur inconnue");
      } finally {
        this.ui.walletBtn.disabled = !this.wallet.available;
      }
    });
    this.ui.logoutBtn.addEventListener("click", async () => {
      await this.wallet.disconnect();
      this.ui.setAuth(null, this.wallet.available, null);
    });
  }

  start(){
    this.obstacles.clear();
    this.stardust.clear();
    this.env.clearDecor();
    this.trail.reset();
    this.score = 0; this.dist = 0; this.dust = 0;
    this.energy = 0; this.charged = false;
    this.player.setCharged(false);
    this.ui.setEnergy(0); this.ui.setNovaReady(false);
    this.lives = CFG.lives; this.level = 1; this.levelT = 0;
    this.speed = CFG.baseSpeed;
    this.shake = 0; this.timeScale = 1; this.slowmoT = 0;
    this.fovPunch = 0;
    this._clearNovaFx();
    this.renderer.toneMappingExposure = TONE_EXPOSURE;
    this.player.pos.set(0,0,0);
    this.player.invuln = 0;
    this.player.group.visible = true;
    this._newSpawn();
    this.nextZ = -70;
    for (let z = -70; z > -340; z -= 15) this.spawn.populate(z, this.level);
    this.nextZ = -340;
    this.env.spawnDecor(-170); this.env.spawnDecor(-300);
    this.ui.setLives(this.lives, CFG.lives);
    this.ui.menu.style.display = "none";
    this.ui.gameover.style.display = "none";
    this.ui.hud.style.display = "block";
    this.ui.pauseBtn.style.display = "flex";
    this.running = true; this.paused = false;
    this.clock.getDelta();
  }

  /** Parse an optional fixed seed from ?seed=N (uint32); null = random each run. */
  _parseSeed(){
    const s = new URLSearchParams(location.search).get("seed");
    if (s === null) return null;
    const n = Number(s);
    return Number.isFinite(n) ? (n >>> 0) : null;
  }

  /** Fresh spawn stream for a new run: reuse the fixed seed if pinned,
      otherwise draw a new random seed so each run differs. */
  _newSpawn(){
    const seed = this.fixedSeed !== null ? this.fixedSeed : undefined;
    this.spawn = new SpawnManager({obstacles:this.obstacles, stardust:this.stardust}, seed);
  }

  /** Calibrated speed multiplier for a level: table for 1..5, then
      +SPEED_MULT_STEP per level, capped at SPEED_MULT_CAP. */
  _speedMult(level){
    if (level <= SPEED_MULTIPLIERS.length) return SPEED_MULTIPLIERS[level-1];
    return Math.min(SPEED_MULT_CAP,
      SPEED_MULTIPLIERS[SPEED_MULTIPLIERS.length-1] + (level - SPEED_MULTIPLIERS.length)*SPEED_MULT_STEP);
  }

  /** Calibrated obstacle density: table for 1..5, then +DENSITY_STEP per
      level, capped at DENSITY_CAP. */
  _density(level){
    if (level <= OBSTACLE_DENSITIES.length) return OBSTACLE_DENSITIES[level-1];
    return Math.min(DENSITY_CAP,
      OBSTACLE_DENSITIES[OBSTACLE_DENSITIES.length-1] + (level - OBSTACLE_DENSITIES.length)*DENSITY_STEP);
  }

  /** Spawn band spacing from density: baseline at L1, tighter as density
      rises. At L1 (density 5) this equals the reference's 14-unit step. */
  _spawnStep(){
    return Math.max(4, SPAWN_STEP_BASE * OBSTACLE_DENSITIES[0] / this._density(this.level));
  }

  collectDust(){
    this.dust++;
    this.score += 100;
    // STAR ENERGY charges only from dust; fills at ~12 clusters.
    if (this.energy < STAR_ENERGY_MAX){
      this.energy = Math.min(STAR_ENERGY_MAX, this.energy + STAR_DUST_ENERGY);
      this.ui.setEnergy(this.energy / STAR_ENERGY_MAX);
      if (this.energy >= STAR_ENERGY_MAX && !this.charged){
        this.charged = true;
        this.player.setCharged(true); // brighten only — never touches the core shader
        this.ui.setNovaReady(true);
      }
    }
  }

  /** NOVA BLAST — consume full STAR ENERGY, clear nearby threats, big FX. */
  novaBlast(){
    if (!this.charged || !this.running || this.paused) return;
    this.energy = 0; this.charged = false;
    this.player.setCharged(false);
    this.ui.setEnergy(0); this.ui.setNovaReady(false);

    const p = this.player.pos.clone();
    this.ui.flashNova(); // white-gold full-screen flash ~400ms

    // Shockwave ring — additive torus, scale 1 → ~90.
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.5, 12, 64),
      new THREE.MeshBasicMaterial({color:0xFFE9B0, transparent:true, opacity:1, blending:THREE.AdditiveBlending, depthWrite:false}));
    ring.position.copy(p);
    this.scene.add(ring);
    this._novaRing = {mesh:ring, t:0};

    // Expansion sphere — additive, grows to the blast radius.
    const sph = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20),
      new THREE.MeshBasicMaterial({color:0xFFCF80, transparent:true, opacity:0.5, blending:THREE.AdditiveBlending, depthWrite:false}));
    sph.position.copy(p);
    this.scene.add(sph);
    this._novaSphere = {mesh:sph, t:0};

    // Exposure boost 1.15 → 1.6 → 1.15 over 600ms.
    this._novaExpoT = 0;
    // FOV punch +10 with elastic return + camera shake.
    this.fovPunch = FOV_NOVA_PUNCH;
    this._fovPunchT = 0;
    this.shake = Math.max(this.shake, 1.2);

    // 80+ golden particles through the existing pool.
    this.particles.burst(p, 90, 42, 3, 0xffe0a0, 1);
    this.particles.burst(p, 44, 26, 1.8, 0xffffff, 1);
    this.audio.boom(true);
    if (navigator.vibrate) navigator.vibrate([40, 20, 60]);

    this._novaDestroy(p);
  }

  /** Destroy asteroids, comets and debris inside the blast zone (planets,
      moons and black holes survive). Zone: radial <= NOVA_RADIUS,
      -NOVA_RADIUS <= dz <= NOVA_BLAST_FORWARD, dz = obj.z - player.z. */
  _novaDestroy(p){
    for (let i = this.obstacles.list.length - 1; i >= 0; i--){
      const o = this.obstacles.list[i];
      if (o.kind !== "rock" && o.kind !== "comet" && o.kind !== "debris") continue;
      const ox = o.mesh ? o.mesh.position.x : o.x;
      const oy = o.mesh ? o.mesh.position.y : o.y;
      const oz = o.mesh ? o.mesh.position.z : o.z;
      const radial = Math.hypot(ox - p.x, oy - p.y);
      const dz = oz - p.z;
      if (radial <= NOVA_RADIUS && dz <= NOVA_BLAST_FORWARD && dz >= -NOVA_RADIUS){
        this.obstacles.removeAndExplode(i, this.particles);
        this.score += NOVA_DAMAGE_SCORE;
      }
    }
  }

  _clearNovaFx(){
    if (this._novaRing){ this.scene.remove(this._novaRing.mesh); this._novaRing = null; }
    if (this._novaSphere){ this.scene.remove(this._novaSphere.mesh); this._novaSphere = null; }
    this._novaExpoT = null;
  }

  onGraze(pos){
    if (this.slowmoT > 0) return;
    this.slowmoT = CFG.slowmoTime;
    this.timeScale = CFG.slowmoScale;
    this.score += 40;
    this.particles.burst(pos, 10, 22, 1.4, 0xfff2c0, 0.4);
    this.audio.whoosh();
    if (navigator.vibrate) navigator.vibrate(18);
  }

  onHit(o, index){
    this.obstacles.removeAndExplode(index, this.particles);
    this.audio.boom(false);
    this.lives--;
    this.ui.setLives(this.lives, CFG.lives);
    if (this.lives <= 0){
      this._deathSequence();
      return;
    }
    this.player.invuln = CFG.invuln;
    this.shake = 0.8;
    this.ui.flashHit();
    if (navigator.vibrate) navigator.vibrate([60, 30, 80]);
  }

  async _deathSequence(){
    this.running = false;
    this.audio.boom(true);
    this.audio.setHum(0, false);
    if (navigator.vibrate) navigator.vibrate([120, 40, 200]);
    const p = this.player.pos.clone();
    this.particles.burst(p, 60, 44, 4.5, 0xffcf70);
    this.particles.burst(p, 40, 30, 2.6, 0xff8030);
    this.particles.burst(p, 30, 20, 1.6, 0xffffff);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.5, 8, 56),
      new THREE.MeshBasicMaterial({color:0xFFEDC0, transparent:true, opacity:1, blending:THREE.AdditiveBlending, depthWrite:false}));
    ring.position.copy(p);
    this.scene.add(ring);
    this._deathRing = {mesh:ring, t:0};
    this.player.group.visible = false;
    this.shake = 1.6;
    this.ui.flashWhite(160);

    const finalScore = Math.floor(this.score);
    const localBest = this.leaderboard.saveLocalBest(finalScore, Math.floor(this.dist), this.dust);
    /* enregistrement + classement pendant l'animation */
    let saved = false;
    if (this.leaderboard.pseudo)
      saved = await this.leaderboard.submit(finalScore, Math.floor(this.dist), this.dust);
    const top = this.leaderboard.available ? await this.leaderboard.top(8) : [];

    setTimeout(() => {
      this.best = Math.max(this.best, finalScore, localBest.score);
      document.getElementById("finalScore")!.textContent = finalScore.toLocaleString("fr-FR");
      document.getElementById("finalDist")!.textContent = Math.floor(this.dist).toLocaleString("fr-FR") + " m";
      document.getElementById("finalDust")!.textContent = this.dust;
      document.getElementById("bestScore")!.textContent = "RECORD · " + this.best.toLocaleString("fr-FR");
      document.getElementById("seedLine")!.textContent = "SEED · " + this.spawn.seed;
      const ss = this.ui.saveState;
      if (saved){ ss.textContent = "SCORE ENREGISTRÉ ✓"; ss.className = "ok"; }
      else if (this.leaderboard.available){ ss.textContent = "CONNECTE TON WALLET POUR ENREGISTRER TON SCORE"; ss.className = "no"; }
      else { ss.textContent = ""; ss.className = "no"; }
      this.ui.renderBoard(this.ui.lbListOver, top, this.wallet.getAddress());
      this.ui.gameover.style.display = "flex";
      this.ui.hud.style.display = "none";
      this.ui.pauseBtn.style.display = "none";
      if (this.leaderboard.available)
        this.leaderboard.top(8).then((rows: any) => this.ui.renderBoard(this.ui.lbListMenu, rows, this.wallet.getAddress()));
    }, 1400);
  }

  _loop(){
    requestAnimationFrame(this._loop);
    let dt = Math.min(this.clock.getDelta(), 0.05);
    if (this.paused){ this.renderer.render(this.scene, this.camera); return; }

    if (this.slowmoT > 0){
      this.slowmoT -= dt;
      if (this.slowmoT <= 0) this.timeScale = 1;
    }
    dt *= this.timeScale;
    this.elapsed += dt;
    const t = this.elapsed;

    this.player.update(dt, t);

    if (this.running){
      this.levelT += dt;
      if (this.levelT >= CFG.levelEvery){
        this.levelT = 0;
        this.level++;
        this.ui.showToast("NIVEAU " + this.level + " — VITESSE ++");
      }
      // Calibrated progression: interpolate smoothly between this level's and
      // the next level's speed multiplier across the level's duration. Base
      // speed and the 30s tier are unchanged (L1 t=0 => BASE_SPEED exactly).
      const m0 = this._speedMult(this.level);
      const m1 = this._speedMult(this.level + 1);
      const frac = clamp(this.levelT / LEVEL_DURATION, 0, 1);
      this.speed = Math.min(MAX_SPEED, BASE_SPEED * (m0 + (m1 - m0)*frac));
      this.dist += this.speed*dt;
      this.score += this.speed*dt*1.5;
      this.player.pos.z -= this.speed*dt;

      const kv = 50*dt;
      if (this.keys.ArrowLeft || this.keys.q || this.keys.a) this.player.pos.x -= kv;
      if (this.keys.ArrowRight || this.keys.d) this.player.pos.x += kv;
      if (this.keys.ArrowUp || this.keys.z || this.keys.w) this.player.pos.y += kv;
      if (this.keys.ArrowDown || this.keys.s) this.player.pos.y -= kv;

      while (this.nextZ > this.player.pos.z - 360){
        this.spawn.populate(this.nextZ, this.level);
        this.nextZ -= this._spawnStep();
      }

      this.obstacles.update(dt, t, this.player, this);
      this.stardust.update(dt, t, this.player, this);

      if (Math.random() < 0.5)
        this.particles.emit(
          this.player.pos.clone().add(new THREE.Vector3(rand(-0.6,0.6), rand(-0.6,0.6), 0.5)),
          new THREE.Vector3(rand(-3,3), rand(-3,3), rand(8,16)),
          rand(.3,.6), rand(.8,1.6), Math.random() < .5 ? 0xffb050 : 0xfff0c0);

      this.audio.setHum((this.speed - CFG.baseSpeed)/(CFG.maxSpeed - CFG.baseSpeed), true);
      this.ui.setStats(this.score, this.dist, this.dust);
    }

    if (this._deathRing){
      const r = this._deathRing;
      r.t += dt;
      const s = 1 + r.t*90;
      r.mesh.scale.set(s, s, s*0.3);
      r.mesh.material.opacity = Math.max(0, 1 - r.t*1.2);
      if (r.t > 1){ this.scene.remove(r.mesh); this._deathRing = null; }
    }

    // Nova Blast transient FX
    if (this._novaRing){
      const r = this._novaRing;
      r.t += dt;
      const s = 1 + r.t*90;
      r.mesh.scale.set(s, s, s);
      r.mesh.material.opacity = Math.max(0, 1 - r.t*1.3);
      if (r.t > 0.9){ this.scene.remove(r.mesh); this._novaRing = null; }
    }
    if (this._novaSphere){
      const r = this._novaSphere;
      r.t += dt;
      const s = Math.min(NOVA_RADIUS, 1 + r.t*(NOVA_RADIUS - 1)/0.4);
      r.mesh.scale.setScalar(s);
      r.mesh.material.opacity = Math.max(0, 0.5*(1 - r.t/0.5));
      if (r.t > 0.55){ this.scene.remove(r.mesh); this._novaSphere = null; }
    }
    if (this._novaExpoT !== null && this._novaExpoT !== undefined){
      this._novaExpoT += dt;
      const q = this._novaExpoT / 0.6;
      if (q >= 1){ this.renderer.toneMappingExposure = TONE_EXPOSURE; this._novaExpoT = null; }
      else {
        const tri = 1 - Math.abs(q*2 - 1); // 0 → 1 → 0
        this.renderer.toneMappingExposure = TONE_EXPOSURE + (TONE_EXPOSURE_NOVA - TONE_EXPOSURE)*tri;
      }
    }
    if (this.fovPunch){
      this._fovPunchT += dt;
      // Elastic settle back to 0: decaying cosine.
      this.fovPunch = FOV_NOVA_PUNCH * Math.exp(-6*this._fovPunchT) * Math.cos(this._fovPunchT*14);
      if (this._fovPunchT > 0.9) this.fovPunch = 0;
    }

    this.trail.update(this.player.pos);
    this.particles.update(dt);
    this.env.update(dt, this.player, this.speed, this.running);
    this.camCtl.update(dt, this.player, this.speed, this);

    this.renderer.render(this.scene, this.camera);
  }
}
