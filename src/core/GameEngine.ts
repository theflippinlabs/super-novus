/* GameEngine — ported from reference/supernova.html (validated build).
   Gameplay loop, spawn, collisions, death sequence: VERBATIM.
   Adapted: wallet/guest menu wiring, offline-first local best. */
import * as THREE from "three";
import { rand, clamp, reduceMotion } from "./util";
import { CFG } from "./legacyCfg";
import { AudioManager } from "../audio/AudioManager";
import { MusicManager } from "../audio/MusicManager";
import { MUSIC_SRC } from "../config";
import { ParticleSystem } from "../fx/ParticleEngine";
import { Player } from "../entities/Player";
import { Trail } from "../entities/Trail";
import { ObstacleManager } from "../entities/ObstacleManager";
import { StarDustSystem } from "../entities/StarDustSystem";
import { Environment } from "../entities/Environment";
import { CameraController } from "./CameraController";
import { SpawnManager } from "./SpawnManager";
import { speedMult, density, spawnStep, speedAt } from "./progression";
import { isInNovaZone } from "../fx/nova";
import { UIManager } from "../ui/UIManager";
import { DebugOverlay } from "../ui/DebugOverlay";
import { WalletManager } from "../net/WalletManager";
import { Leaderboard } from "../net/Leaderboard";
import { PrizePool } from "../net/PrizePool";
import { Payouts } from "../net/Payouts";
import { AdminPanel } from "../ui/AdminPanel";
import { Profile } from "../net/Profile";
import { ProfilePanel } from "../ui/ProfilePanel";
import { Joystick } from "../input/Joystick";
import { generateAvatar } from "../ui/Avatar";
import { i18n } from "../i18n";
import {
  STAR_DUST_ENERGY, STAR_ENERGY_MAX,
  NOVA_DAMAGE_SCORE,
  FOV_NOVA_PUNCH, TONE_EXPOSURE, TONE_EXPOSURE_NOVA,
  DOUBLE_TAP_DELAY, DOUBLE_TAP_MAX_DIST, TAP_MAX_MOVE,
  NOVA_RADIUS, LEVEL_DURATION,
  BIG_BANG_PRICES, BIG_BANG_MAX, BIG_BANG_RECIPIENT, BIG_BANG_INVULN,
  CONTROL_MODE_KEY, DEFAULT_CONTROL_MODE, JOYSTICK_SPEED_X, JOYSTICK_SPEED_Y,
  type ControlMode, type Lang,
} from "../config";

export class GameEngine {
  [key: string]: any;
  constructor(){
    this.renderer = new THREE.WebGLRenderer({antialias:true, powerPreference:"high-performance"});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    document.body.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x02020e);
    this.scene.fog = new THREE.Fog(0x05051a, 170, 420);

    this.camera = new THREE.PerspectiveCamera(84, innerWidth/innerHeight, 0.1, 1400);

    /* éclairage : lumière directionnelle depuis l'étoile-repère → terminateur réaliste.
       Intensités réduites + teinte réchauffée pour éviter les bords de planètes
       cramés en blanc — la lisibilité du gameplay prime sur le bloom. */
    // Cooler, blue/violet-leaning key + fill for a premium cosmic mood.
    this.scene.add(new THREE.AmbientLight(0x2b3060, 0.5));
    const sunLight = new THREE.DirectionalLight(0xdbe6ff, 1.02);
    sunLight.position.set(-150, 170, 60);
    this.scene.add(sunLight);
    const fill = new THREE.DirectionalLight(0x8a7dff, 0.16);
    fill.position.set(120, -60, -40);
    this.scene.add(fill);

    this.audio = new AudioManager();
    this.music = new MusicManager(MUSIC_SRC);
    this.wallet = new WalletManager();
    this.leaderboard = new Leaderboard(this.wallet);
    this.prizePool = new PrizePool();     // live weekly/monthly prize-pool math
    this.prizePool.flushPending();        // retry any purchase record queued offline
    this.profile = new Profile(this.wallet);
    // Control mode (Direct Touch default; Virtual Joystick is an additive alt).
    this.controlMode = this._loadControlMode();
    this.joystick = new Joystick(() => this._tryNova());
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
    // Zero cost unless ?debug=1: no DOM, no measurement, no global otherwise.
    this.debug = new URLSearchParams(location.search).get("debug") === "1" ? new DebugOverlay() : null;
    if (this.debug) (window as any).__game = this; // debug-only inspection handle
    // Owner prize-payout console (?admin=1) — zero cost otherwise.
    if (new URLSearchParams(location.search).get("admin") === "1"){
      this.payouts = new Payouts(this.wallet, this.prizePool);
      this.admin = new AdminPanel(this.payouts, this.wallet);
    }
    // Player profile dashboard (avatar + nickname + stats/history/rewards).
    this.profilePanel = new ProfilePanel(this.profile, this.wallet, this.leaderboard);
    this.profilePanel.setIdentityListener(() => this._refreshIdentity());

    this.running = false; this.paused = false;
    this.score = 0; this.dist = 0; this.dust = 0; this.best = 0;
    this.energy = 0; this.charged = false; this.bigBangs = 0;
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
        this.audio.suspendContext();   // pause hum/SFX AudioContext
        this.music.suspend();          // pause background music
      } else {
        this.audio.resumeContext(false);
        this.music.resume();           // resume music if it was on
        this.clock.getDelta();         // avoid a dt jump on return
      }
    });
  }

  async _initAuth(){
    this.lbPeriod = "weekly";      // "weekly" | "monthly"
    this._pool = this.prizePool.staticPool(); // instant guaranteed figures; upgraded live below
    this.ui.setPrizePool(this.lbPeriod, this._pool);
    this._bindLbTabs();
    const refresh = () => this.ui.setAuth(this.wallet.getAddress(), this.wallet.available, this.wallet.getChainId());
    this.wallet.onChange(() => {
      refresh();
      this._refreshIdentity();       // avatar + nickname chip (never the address)
      // A wallet just (re)connected → push any score stored while offline.
      this.leaderboard.syncPending().then((ok) => { if (ok) this._refreshBoards(); });
      this._refreshBoards();
    });
    refresh();
    this.leaderboard.diagnose();   // logs exact Supabase connectivity status on boot
    await this._refreshBoards();
    this._refreshPrizePool();      // live weekly/monthly prize pool on the menu board
    // best local (offline-first) affiché dès le menu
    this.best = this.leaderboard.getLocalBest().score;
    const addr = await this.wallet.tryReconnect();  // silent injected/WC reconnect
    if (addr){ refresh(); this._refreshIdentity(); this._refreshBoards(); }
  }

  /** Weekly/monthly tab clicks across both leaderboard panels. */
  _bindLbTabs(){
    for (const btn of document.querySelectorAll<HTMLButtonElement>(".lbTab")){
      btn.addEventListener("click", () => {
        const period = btn.dataset.period;
        if (!period || period === this.lbPeriod) return;
        this.lbPeriod = period;
        this.ui.setLbTab(period);
        this._refreshBoards();
        this.ui.setPrizePool(this.lbPeriod, this._pool ?? null); // re-render for the new tab
      });
    }
  }

  /** Fetch the live prize pool (weekly + monthly community bonus) and show it on
      the leaderboard panel for the active tab. Cheap; safe to call repeatedly. */
  async _refreshPrizePool(){
    try {
      this._pool = await this.prizePool.compute();
      this.ui.setPrizePool(this.lbPeriod, this._pool);
    } catch (e){
      console.warn("[PrizePool] refresh failed:", e);
    }
  }

  /* ---------- controls, language, profile ---------- */
  _loadControlMode(): ControlMode {
    try { const v = localStorage.getItem(CONTROL_MODE_KEY); if (v === "touch" || v === "joystick") return v; }
    catch { /* private mode */ }
    return DEFAULT_CONTROL_MODE;
  }

  _setControlMode(mode: ControlMode){
    this.controlMode = mode;
    try { localStorage.setItem(CONTROL_MODE_KEY, mode); } catch { /* ignore */ }
    this.ui.setControlActive(mode);
    // Swap the on-screen overlay live if a run is in progress.
    if (this.running){
      if (mode === "joystick"){ this.joystick.mount(); this.joystick.setNovaReady(this.charged); }
      else this.joystick.unmount();
    }
  }

  _setLang(lang: Lang){ i18n.set(lang); }  // set() re-applies the DOM + fires onChange

  /** Re-render everything whose text is built dynamically (not [data-i18n]). */
  _onLangChange(){
    this.ui.setLangActive(i18n.get());
    this.ui.setControlActive(this.controlMode);
    if (this._pool) this.ui.setPrizePool(this.lbPeriod, this._pool);
    this._updateBigBangButton();
    this._refreshBoards();
    this._refreshIdentity();
  }

  _openProfile(){ this.profilePanel.open(); }

  /** Mirror Nova-ready state to both the HUD gauge and the joystick NOVA button. */
  _setNovaReady(on: boolean){ this.ui.setNovaReady(on); this.joystick.setNovaReady(on); }

  /** Show the avatar + nickname identity (home chip + auth line). Never the address. */
  async _refreshIdentity(){
    const addr = this.wallet.getAddress();
    if (!addr){ this.ui.setProfileIdentity(false, null, null); return; }
    const cached = this.profile.cachedIdentity(addr);
    const genAvatar = generateAvatar(addr, 64);
    this.ui.setProfileIdentity(true, cached.avatar || genAvatar, cached.nickname);
    // Hydrate from Supabase, then refine the chip + auth note.
    const row = await this.profile.get();
    const nick = row?.nickname ?? cached.nickname ?? null;
    const avatar = row?.avatar_url || cached.avatar || genAvatar;
    this.ui.setProfileIdentity(true, avatar, nick);
    this.ui.setAuth(addr, this.wallet.available, this.wallet.getChainId(), nick);
  }

  /** After an explicit connect: show identity, and prompt for a nickname if none. */
  async _afterConnect(){
    await this._refreshIdentity();
    const addr = this.wallet.getAddress();
    if (!addr || !this.profile.available) return;
    const row = await this.profile.get();
    if (!row || !row.nickname) this.profilePanel.openNicknameSetup();
  }

  /** Fetch the current period's board once and render it into both panels.
      Explicit, non-blocking state when the online leaderboard isn't configured. */
  async _refreshBoards(){
    const me = this.wallet.getAddress();
    if (!this.leaderboard.available){
      this.ui.boardMessage(this.ui.lbListMenu, "Classement en ligne bientôt disponible");
      return;
    }
    const rows = await this.leaderboard.top(this.lbPeriod, 10);
    this.ui.renderBoard(this.ui.lbListMenu, rows, me);
  }

  _bindInput(){
    this.drag = null;
    this._lastTap = null; // {x,y,time} of the previous stationary tap (Nova Blast)
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", e => {
      this.audio.init();
      if (this.controlMode !== "touch") return; // Mode 2 uses the joystick overlay
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
    // Game Over — two choices only: Big Bang (paid continue) or Return to Menu.
    this.ui.bigBangBtn.addEventListener("click", () => this._buyBigBang());
    this.ui.menuBtn.addEventListener("click", () => this._returnToMenu());
    this.ui.pauseBtn.addEventListener("click", () => {
      if (!this.running) return;
      this.paused = true;
      this.ui.pauseScreen.style.display = "flex";
      this.audio.setHum(0, false);   // cut the speed hum (music keeps looping)
    });
    document.getElementById("resumeBtn")!.addEventListener("click", () => {
      this.paused = false;
      this.ui.pauseScreen.style.display = "none";
      this.clock.getDelta();         // resync so dt doesn't jump on resume
    });
    // HUD music ON/OFF (persisted); never interferes with gameplay input.
    this.ui.musicBtn.addEventListener("click", () => {
      const on = this.music.toggle();
      this.ui.setMusicButton(on);
    });
    this.ui.setMusicButton(this.music.isEnabled);
    this.ui.walletBtn.addEventListener("click", async () => {
      this.ui.walletBtn.disabled = true;
      this.ui.walletState.textContent = "Connexion en cours…";
      try {
        await this.wallet.connect();
        this.ui.setAuth(this.wallet.getAddress(), this.wallet.available, this.wallet.getChainId());
        await this._afterConnect();       // identity chip + nickname prompt if new
        await this._refreshBoards();
      } catch (e) {
        this.ui.setAuth(null, this.wallet.available, null);
        // Graceful handling: a user-rejected connection is not an error state.
        const code = (e as { code?: number })?.code;
        const msg = e instanceof Error ? e.message : String(e ?? "");
        if (code === 4001 || /reject|denied|refus|cancel|annul|close/i.test(msg))
          this.ui.walletState.textContent = "Connexion annulée — tu peux réessayer ou continuer en invité.";
        else
          this.ui.setWalletError(msg || "erreur inconnue");
      } finally {
        this.ui.walletBtn.disabled = !this.wallet.available;
      }
    });
    this.ui.logoutBtn.addEventListener("click", async () => {
      await this.wallet.disconnect();
      this.ui.setAuth(null, this.wallet.available, null);
      this.ui.setProfileIdentity(false, null, null);
      this._refreshBoards();
    });

    // Language selector (instant switch, persisted).
    for (const b of document.querySelectorAll<HTMLButtonElement>(".langBtn"))
      b.addEventListener("click", () => { const l = b.dataset.lang; if (l) this._setLang(l as Lang); });
    this.ui.setLangActive(i18n.get());
    i18n.onChange(() => this._onLangChange());

    // Control mode selector.
    for (const b of document.querySelectorAll<HTMLButtonElement>(".ctrlOpt"))
      b.addEventListener("click", () => { const m = b.dataset.mode; if (m) this._setControlMode(m as ControlMode); });
    this.ui.setControlActive(this.controlMode);

    // Profile — open the dashboard from the circular header icon.
    this.ui.profileIcon.addEventListener("click", () => this._openProfile());
    // Menu header music toggle (mirrors the in-game HUD button).
    this.ui.menuMusicBtn.addEventListener("click", () => {
      const on = this.music.toggle();
      this.ui.setMusicButton(on);
    });
  }

  start(){
    this.obstacles.clear();
    this.stardust.clear();
    this.env.clearDecor();
    this.trail.reset();
    this.score = 0; this.dist = 0; this.dust = 0;
    this.bigBangs = 0;   // Big Bang revives used this run (max 3)
    this.energy = 0; this.charged = false;
    this.player.setCharged(false);
    this.ui.setEnergy(0); this._setNovaReady(false);
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
    this.env.spawnDecor(0, "distant"); this.env.spawnDecor(0, "distant"); this.env.spawnDecor(0, "medium");
    this.ui.setLives(this.lives, CFG.lives);
    this.ui.menu.style.display = "none";
    this.ui.gameover.style.display = "none";
    this.ui.hud.style.display = "block";
    this.ui.pauseBtn.style.display = "flex";
    this.ui.musicBtn.style.display = "flex";
    this.music.play();   // starts on this user-gesture (autoplay-compliant)
    this.running = true; this.paused = false;
    // Mode 2 overlay (joystick + NOVA) only in joystick mode; Direct Touch untouched.
    if (this.controlMode === "joystick") this.joystick.mount(); else this.joystick.unmount();
    this._setNovaReady(false);
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

  // Thin wrappers over the pure, unit-tested progression math.
  _speedMult(level){ return speedMult(level); }
  _density(level){ return density(level); }
  _spawnStep(){ return spawnStep(this.level); }

  collectDust(){
    this.dust++;
    this.score += 100;
    this.ui.floatScore("+100", "dust");
    // STAR ENERGY charges only from dust; fills at ~12 clusters.
    if (this.energy < STAR_ENERGY_MAX){
      this.energy = Math.min(STAR_ENERGY_MAX, this.energy + STAR_DUST_ENERGY);
      this.ui.setEnergy(this.energy / STAR_ENERGY_MAX);
      if (this.energy >= STAR_ENERGY_MAX && !this.charged){
        this.charged = true;
        this.player.setCharged(true); // brighten only — never touches the core shader
        this._setNovaReady(true);
      }
    }
  }

  /** NOVA BLAST — consume full STAR ENERGY, clear nearby threats, big FX. */
  novaBlast(){
    if (!this.charged || !this.running || this.paused) return;
    this.energy = 0; this.charged = false;
    this.player.setCharged(false);
    this.ui.setEnergy(0); this._setNovaReady(false);

    const p = this.player.pos.clone();
    this.ui.flashNova(); // white-gold full-screen flash ~400ms
    this.ui.floatScore("NOVA", "nova");

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
      if (isInNovaZone(radial, dz)){
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
    this.joystick.unmount();
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
    const finalDist = Math.floor(this.dist);
    const prevBest = this.best;
    const localBest = this.leaderboard.saveLocalBest(finalScore, finalDist, this.dust);
    const isNewRecord = finalScore > prevBest && finalScore > 0;
    this.best = Math.max(this.best, finalScore, localBest.score);
    // Accumulate local lifetime stats for the profile (frontend-only for now).
    this.profile.recordRun(finalScore, finalDist, this.dust, this.bigBangs);

    // Submit BEFORE leaving the screen (if a wallet is connected); otherwise
    // store locally so it auto-syncs when a wallet reconnects.
    let saved = false;
    const hasWallet = Boolean(this.leaderboard.pseudo);
    if (hasWallet) saved = await this.leaderboard.submit(finalScore, finalDist, this.dust, this.bigBangs);
    else if (this.leaderboard.available && finalScore > 0)
      this.leaderboard.savePending(finalScore, finalDist, this.dust, this.bigBangs);

    // Ranks only make sense once the score is on the board.
    let weeklyR: number | null = null, monthlyR: number | null = null;
    if (saved){
      weeklyR = await this.leaderboard.myRank("weekly");
      monthlyR = await this.leaderboard.myRank("monthly");
    }

    setTimeout(() => {
      document.getElementById("finalScore")!.textContent = finalScore.toLocaleString("fr-FR");
      document.getElementById("finalDist")!.textContent = finalDist.toLocaleString("fr-FR") + " m";
      document.getElementById("finalDust")!.textContent = this.dust;
      const loc = i18n.get() === "fr" ? "fr-FR" : i18n.get() === "ko" ? "ko-KR" : "en-US";
      document.getElementById("bestScore")!.textContent = i18n.t("gameover.record") + " · " + this.best.toLocaleString(loc);
      document.getElementById("seedLine")!.textContent = i18n.t("gameover.seed") + " · " + this.spawn.seed;
      this.ui.showNewRecord(isNewRecord);
      this.ui.setRank("weekly", weeklyR);
      this.ui.setRank("monthly", monthlyR);
      const ss = this.ui.saveState;
      if (saved){ ss.textContent = i18n.t("gameover.saved"); ss.className = "ok"; }
      else if (hasWallet){ ss.textContent = i18n.t("gameover.saveFailed"); ss.className = "no"; }
      else if (this.leaderboard.available){ ss.textContent = i18n.t("gameover.saveGuest"); ss.className = "no"; }
      else { ss.textContent = i18n.t("gameover.lbSoon"); ss.className = "no"; }
      this._updateBigBangButton();
      this.ui.gameover.style.display = "flex";
      this.ui.hud.style.display = "none";
      this.ui.pauseBtn.style.display = "none";
      this._refreshBoards();
    }, 1400);
  }

  /** Reflect Big Bang state: dynamic price per revive (#1/#2/#3), usage count,
      and the permanent "max reached" state after the 3rd. */
  _updateBigBangButton(){
    const btn = this.ui.bigBangBtn;
    this.ui.setBigBangCount(this.bigBangs, BIG_BANG_MAX);
    if (this.bigBangs >= BIG_BANG_MAX){
      btn.textContent = i18n.t("bigbang.max");
      btn.disabled = true;
      return;
    }
    const n = this.bigBangs + 1;                 // this purchase would be #n
    const price = BIG_BANG_PRICES[this.bigBangs]; // 10 / 20 / 40
    if (!BIG_BANG_RECIPIENT){
      btn.textContent = i18n.t("bigbang.soon", { n });
      btn.disabled = true;
    } else if (!this.wallet.getAddress()){
      btn.textContent = i18n.t("bigbang.connect", { n, price });
      btn.disabled = true;
    } else {
      btn.textContent = i18n.t("bigbang.buy", { n, price });
      btn.disabled = false;
    }
  }

  /** OPTION 1 — pay the escalating CRO price, then revive and continue. */
  async _buyBigBang(){
    if (!BIG_BANG_RECIPIENT || !this.wallet.getAddress()) return;
    if (this.bigBangs >= BIG_BANG_MAX) return;
    const btn = this.ui.bigBangBtn;
    const price = BIG_BANG_PRICES[this.bigBangs];
    btn.disabled = true;
    btn.textContent = i18n.t("bigbang.paying");
    try {
      const txHash = await this.wallet.payCRO(BIG_BANG_RECIPIENT, price);
      this.bigBangs++;                 // count this revive
      // Record the purchase so the live Monthly Prize Pool grows (30% community
      // bonus). Fire-and-forget + queued; never blocks the revive.
      const buyer = this.wallet.getAddress();
      if (buyer && txHash){
        this.prizePool.recordPurchase(buyer, txHash, price)
          .then(() => this._refreshPrizePool())
          .catch((err) => console.warn("[BigBang] revenue record failed:", err));
      }
      this._bigBangRevive();
    } catch (e){
      const msg = e instanceof Error ? e.message : String(e);
      const rejected = /reject|denied|refus|cancel|annul|4001/i.test(msg);
      btn.textContent = rejected ? i18n.t("bigbang.cancelled") : i18n.t("bigbang.failed");
      console.warn("[BigBang] payment failed:", msg);
      setTimeout(() => this._updateBigBangButton(), 1800);
    }
  }

  /** Revive exactly where the player died, keeping score/dist/dust/level/energy;
      clears the immediate area and grants temporary invulnerability. */
  _bigBangRevive(){
    if (this._deathRing){ this.scene.remove(this._deathRing.mesh); this._deathRing = null; }
    const zAtDeath = this.player.pos.z;
    // Recenter for a safe respawn, then clear nearby threats (no score awarded).
    this.player.pos.x = 0; this.player.pos.y = 0;
    for (let i = this.obstacles.list.length - 1; i >= 0; i--){
      const o = this.obstacles.list[i];
      if (o.kind !== "rock" && o.kind !== "comet" && o.kind !== "debris") continue;
      const ox = o.mesh ? o.mesh.position.x : o.x;
      const oy = o.mesh ? o.mesh.position.y : o.y;
      const oz = o.mesh ? o.mesh.position.z : o.z;
      if (Math.hypot(ox, oy) <= 30 && (oz - zAtDeath) <= 8 && (oz - zAtDeath) >= -45)
        this.obstacles.removeAndExplode(i, this.particles);
    }
    const p = this.player.pos.clone();
    this.particles.burst(p, 90, 46, 3.2, 0xc3a0ff, 1);
    this.particles.burst(p, 40, 26, 1.8, 0xffffff, 1);
    this.audio.boom(true);
    this.ui.flashNova();
    this.shake = 1.2;

    this.player.invuln = BIG_BANG_INVULN;   // temporary invulnerability
    this.player.group.visible = true;
    this.lives = 1;                          // revived with one life
    this.ui.setLives(this.lives, CFG.lives);

    // Resume the SAME run — score/dist/dust/level/energy/levelT untouched.
    this.ui.gameover.style.display = "none";
    this.ui.hud.style.display = "block";
    this.ui.pauseBtn.style.display = "flex";
    this.running = true; this.paused = false;
    // Resuming the SAME run — restore the joystick overlay if in joystick mode.
    if (this.controlMode === "joystick") this.joystick.mount();
    this.joystick.setNovaReady(this.charged);
    this.clock.getDelta();
  }

  /** OPTION 2 — back to the title screen. A new run starts only on Play. */
  _returnToMenu(){
    if (this._deathRing){ this.scene.remove(this._deathRing.mesh); this._deathRing = null; }
    this.joystick.unmount();
    this.ui.musicBtn.style.display = "none";   // menu uses the header music button
    this.ui.gameover.style.display = "none";
    this.ui.menu.style.display = "flex";
    this._refreshBoards();
  }

  _loop(){
    requestAnimationFrame(this._loop);
    let dt = Math.min(this.clock.getDelta(), 0.05);
    const rawDt = dt;   // unscaled by slow-mo — used for input responsiveness
    if (this.paused){ this.renderer.render(this.scene, this.camera); if (this.debug) this.debug.update(this); return; }

    // Mode 2 — integrate the virtual joystick into the SAME player position the
    // finger-drag sets (identical bounds). Uses raw dt so it stays responsive
    // during slow-mo, exactly like Direct Touch. No gameplay constant changes.
    if (this.running && this.controlMode === "joystick"){
      const v = this.joystick.vec;
      if (v.x || v.y){
        this.player.pos.x = clamp(this.player.pos.x + v.x * JOYSTICK_SPEED_X * rawDt, -CFG.fieldX + 1.2, CFG.fieldX - 1.2);
        this.player.pos.y = clamp(this.player.pos.y + v.y * JOYSTICK_SPEED_Y * rawDt, -CFG.fieldY + 1.2, CFG.fieldY - 1.2);
      }
    }

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
        this.ui.showToast(i18n.t("hud.levelUp", { n: this.level }));
      }
      // Calibrated progression: smooth interpolation between this level's and
      // the next level's speed multiplier across the level's duration. Base
      // speed and the 30s tier are unchanged (L1 t=0 => BASE_SPEED exactly).
      this.speed = speedAt(this.level, this.levelT / LEVEL_DURATION);
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
    if (this.debug) this.debug.update(this);
  }
}
