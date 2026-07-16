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
import { UIManager } from "../ui/UIManager";
import { WalletManager } from "../net/WalletManager";
import { Leaderboard } from "../net/Leaderboard";

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
    this.env = new Environment(this.scene);
    this.camCtl = new CameraController(this.camera);
    this.ui = new UIManager();

    this.running = false; this.paused = false;
    this.score = 0; this.dist = 0; this.dust = 0; this.best = 0;
    this.lives = CFG.lives; this.level = 1;
    this.speed = CFG.baseSpeed;
    this.shake = 0; this.timeScale = 1; this.slowmoT = 0;
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
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", e => {
      this.audio.init();
      if (!this.running || this.paused) return;
      this.drag = {sx:e.clientX, sy:e.clientY, px:this.player.pos.x, py:this.player.pos.y};
    });
    addEventListener("pointermove", e => {
      if (!this.drag || !this.running || this.paused) return;
      const kx = (CFG.fieldX*2) / (innerWidth*0.62);
      const ky = (CFG.fieldY*2) / (innerHeight*0.55);
      this.player.pos.x = clamp(this.drag.px + (e.clientX - this.drag.sx)*kx, -CFG.fieldX+1.2, CFG.fieldX-1.2);
      this.player.pos.y = clamp(this.drag.py - (e.clientY - this.drag.sy)*ky, -CFG.fieldY+1.2, CFG.fieldY-1.2);
    });
    const end = () => this.drag = null;
    addEventListener("pointerup", end);
    addEventListener("pointercancel", end);

    this.keys = {};
    addEventListener("keydown", e => this.keys[e.key] = true);
    addEventListener("keyup", e => this.keys[e.key] = false);
  }

  _bindUI(){
    this.ui.playBtn.addEventListener("click", () => { this.audio.init(); this.start(); });
    document.getElementById("retryBtn")!.addEventListener("click", () => this.start());
    this.ui.pauseBtn.addEventListener("click", () => {
      if (!this.running) return;
      this.paused = true;
      this.ui.pauseScreen.style.display = "flex";
      this.audio.setHum(0, false);
    });
    document.getElementById("resumeBtn")!.addEventListener("click", () => {
      this.paused = false;
      this.ui.pauseScreen.style.display = "none";
      this.clock.getDelta();
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
    this.lives = CFG.lives; this.level = 1; this.levelT = 0;
    this.speed = CFG.baseSpeed;
    this.shake = 0; this.timeScale = 1; this.slowmoT = 0;
    this.player.pos.set(0,0,0);
    this.player.invuln = 0;
    this.player.group.visible = true;
    this.nextZ = -70;
    for (let z = -70; z > -340; z -= 15) this._populate(z);
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

  _populate(z){
    const r = Math.random();
    if (r < 0.11) this.obstacles.planet(z);
    else if (r < 0.17) this.obstacles.planet(z, true);
    else if (r < 0.32) this.obstacles.field(z);
    else if (r < 0.68) this.obstacles.rock(z);
    else if (r < 0.72) this.obstacles.debris(z);
    if (this.level >= 2 && Math.random() < 0.05 + this.level*0.008) this.obstacles.comet(z - 7);
    if (this.level >= 3 && Math.random() < 0.035) this.obstacles.blackHole(z - 10);
    if (Math.random() < 0.22) this.stardust.spawnChain(z - 6);
  }

  collectDust(){
    this.dust++;
    this.score += 100;
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
      this.speed = Math.min(CFG.maxSpeed, CFG.baseSpeed + (this.level-1)*9 + this.levelT*0.25);
      this.dist += this.speed*dt;
      this.score += this.speed*dt*1.5;
      this.player.pos.z -= this.speed*dt;

      const kv = 50*dt;
      if (this.keys.ArrowLeft || this.keys.q || this.keys.a) this.player.pos.x -= kv;
      if (this.keys.ArrowRight || this.keys.d) this.player.pos.x += kv;
      if (this.keys.ArrowUp || this.keys.z || this.keys.w) this.player.pos.y += kv;
      if (this.keys.ArrowDown || this.keys.s) this.player.pos.y -= kv;

      while (this.nextZ > this.player.pos.z - 360){
        this._populate(this.nextZ);
        this.nextZ -= 14;
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

    this.trail.update(this.player.pos);
    this.particles.update(dt);
    this.env.update(dt, this.player, this.speed, this.running);
    this.camCtl.update(dt, this.player, this.speed, this);

    this.renderer.render(this.scene, this.camera);
  }
}
