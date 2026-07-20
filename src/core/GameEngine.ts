/* GameEngine — ported from reference/supernova.html (validated build).
   Gameplay loop, spawn, collisions, death sequence: VERBATIM.
   Adapted: wallet/guest menu wiring, offline-first local best. */
import * as THREE from "three";
import { rand, clamp, reduceMotion } from "./util";
import { TEX } from "./textures";
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
import { WalletManager, PayError } from "../net/WalletManager";
import { Leaderboard } from "../net/Leaderboard";
import { PrizePool } from "../net/PrizePool";
import { Payouts } from "../net/Payouts";
import { Accounting } from "../net/Accounting";
import { AdminPanel } from "../ui/AdminPanel";
import { Profile } from "../net/Profile";
import { ProfilePanel } from "../ui/ProfilePanel";
import { LeaderboardPage } from "../ui/LeaderboardPage";
import { MenuBackground } from "../ui/MenuBackground";
import { BigBangCredits } from "../net/BigBangCredits";
import { BigBangStore } from "../ui/BigBangStore";
import { Joystick } from "../input/Joystick";
import { Diagnostics } from "../ui/Diagnostics";
import { i18n } from "../i18n";
import {
  STAR_DUST_ENERGY, STAR_ENERGY_MAX,
  NOVA_DAMAGE_SCORE,
  FOV_NOVA_PUNCH, TONE_EXPOSURE, TONE_EXPOSURE_NOVA,
  DOUBLE_TAP_DELAY, DOUBLE_TAP_MAX_DIST, TAP_MAX_MOVE,
  NOVA_RADIUS, LEVEL_DURATION,
  BIG_BANG_PRICES, BIG_BANG_MAX, BIG_BANG_RECIPIENT, BIG_BANG_INVULN,
  CONTROL_MODE_KEY, DEFAULT_CONTROL_MODE, JOYSTICK_SCREEN_FRAC,
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
      this.admin = new AdminPanel(this.payouts, this.wallet, this.prizePool, this.leaderboard, new Accounting(this.prizePool));
    }
    // Big Bang Packs — buy credits in advance; revives then consume them instantly.
    this.credits = new BigBangCredits(this.wallet);
    // Player profile dashboard (avatar + nickname + stats/credits/history).
    this.profilePanel = new ProfilePanel(this.profile, this.wallet, this.leaderboard, this.credits);
    this.profilePanel.setIdentityListener(() => this._refreshIdentity());
    this.profilePanel.setStoreOpener(() => this.bbStore.open());
    // Dedicated competition hub, opened from the home "Galactic Leaderboard" card.
    this.leaderboardPage = new LeaderboardPage(this.leaderboard, this.wallet, this.profile, this.prizePool);
    // Living cosmos behind the home-screen UI (paused during gameplay).
    this.menuBackground = new MenuBackground(document.getElementById("menuBg") as HTMLCanvasElement);
    this.menuBackground.start();
    this.bbStore = new BigBangStore(this.wallet, this.credits, () => this._onCreditsChanged());
    // Score-pipeline diagnostic (?diag=1) — zero cost otherwise.
    if (new URLSearchParams(location.search).get("diag") === "1")
      this.diagnostics = new Diagnostics(this.leaderboard, this.wallet);

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
        // Returning from the wallet app (iOS Safari): re-check for a session.
        this.wallet.resume();          // emits → identity + boards refresh if reconnected
      }
    });
    // iOS Safari restores the page from bfcache with a pageshow event, not always
    // visibilitychange — re-check the wallet session there too.
    addEventListener("pageshow", () => { this.wallet.resume(); });
  }

  async _initAuth(){
    // The home screen only sells the game — all ranking/prize UI lives on the
    // dedicated LeaderboardPage, which fetches its own data + prize pool on open.
    const refresh = () => this.ui.setAuth(this.wallet.getAddress(), this.wallet.available, this.wallet.getChainId());
    this.wallet.onChange(() => {
      refresh();
      this._refreshIdentity();       // avatar + nickname chip (never the address)
      this._updateStoreChip();       // credits are per-wallet — refresh the balance chip
      // NO automatic score submission here: publishing a score needs a signature
      // (a wallet deep link on iOS), which must ONLY happen on an explicit
      // "Save score" tap — never on a silent reconnect / tab resume.
    });
    refresh();
    this._refreshIdentity();       // guest silhouette in the profile button from boot
    this._updateStoreChip();       // show owned credits on the store entry from boot
    this.leaderboard.diagnose();   // logs exact Supabase connectivity status on boot
    // best local (offline-first) affiché dès le menu
    this.best = this.leaderboard.getLocalBest().score;
    const addr = await this.wallet.tryReconnect();  // silent injected/WC reconnect
    if (addr){ refresh(); this._refreshIdentity(); }
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
    this._updateBigBangButton();
    this._refreshIdentity();
  }

  _openProfile(){ this.profilePanel.open(); }

  /** Mirror Nova-ready state to both the HUD gauge and the joystick NOVA button. */
  _setNovaReady(on: boolean){ this.ui.setNovaReady(on); this.joystick.setNovaReady(on); }

  /** Show the avatar + nickname identity (home chip + auth line). Never the address. */
  async _refreshIdentity(){
    const addr = this.wallet.getAddress();
    if (!addr){ this.ui.setProfileIdentity(false, null, null, null); return; }
    const cached = this.profile.cachedIdentity(addr);
    // Connected → avatar (custom else deterministic galaxy) in a gold profile ring.
    this.ui.setProfileIdentity(true, addr, cached.avatar, cached.nickname);
    const row = await this.profile.get();
    const nick = row?.nickname ?? cached.nickname ?? null;
    this.ui.setProfileIdentity(true, addr, row?.avatar_url ?? cached.avatar ?? null, nick);
    this.ui.setAuth(addr, this.wallet.available, this.wallet.getChainId(), nick);
  }

  /** The current player's own identity for their podium/board row (chosen name +
      avatar), or null when playing as guest. Never exposes the address. */
  /** After an explicit connect: show identity, and prompt for a nickname if none. */
  async _afterConnect(){
    await this._refreshIdentity();
    const addr = this.wallet.getAddress();
    if (!addr || !this.profile.available) return;
    const row = await this.profile.get();
    if (!row || !row.nickname) this.profilePanel.openNicknameSetup();
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
    this.ui.saveScoreBtn.addEventListener("click", () => this._saveScore());
    this.ui.bigBangBtn.addEventListener("click", () => this._bigBangAction());
    // Big Bang Store (menu) — buy packs of credits in advance.
    document.getElementById("storeBtn")?.addEventListener("click", () => this.bbStore.open());
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
    // Wallet status chip (avatar + nickname) opens the profile — disconnect lives there.
    this.ui.walletStatus.addEventListener("click", () => this._openProfile());

    // Language selector — a compact flag pill that opens a chooser popover.
    const langPill = document.getElementById("langPill");
    const langMenu = document.getElementById("langMenu");
    langPill?.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".langOpt")) return;  // option handles itself
      langMenu?.classList.toggle("open");
    });
    for (const o of document.querySelectorAll<HTMLButtonElement>(".langOpt"))
      o.addEventListener("click", (e) => {
        e.stopPropagation();
        const l = o.dataset.lang; if (l) this._setLang(l as Lang);
        langMenu?.classList.remove("open");
      });
    // Tap outside the pill closes the chooser.
    document.addEventListener("click", (e) => {
      if (!(e.target as HTMLElement).closest("#langPill")) langMenu?.classList.remove("open");
    });
    this.ui.setLangActive(i18n.get());
    i18n.onChange(() => this._onLangChange());

    // Control mode selector.
    for (const b of document.querySelectorAll<HTMLButtonElement>(".ctrlOpt"))
      b.addEventListener("click", () => { const m = b.dataset.mode; if (m) this._setControlMode(m as ControlMode); });
    this.ui.setControlActive(this.controlMode);

    // Profile — open the dashboard from the circular header icon.
    this.ui.profileIcon.addEventListener("click", () => this._openProfile());
    // Podium is a preview — tapping it (or "view all") opens the full leaderboard.
    // Home "Galactic Leaderboard" card → the dedicated competition page (weekly first).
    document.getElementById("lbCard")?.addEventListener("click", () => this.leaderboardPage.open("weekly"));
    // Menu header music toggle (mirrors the in-game HUD button).
    this.ui.menuMusicBtn.addEventListener("click", () => {
      const on = this.music.toggle();
      this.ui.setMusicButton(on);
    });
    this._armMusicAutostart();
  }

  /** Start the background music on the FIRST user interaction anywhere (browsers
      block autoplay until a gesture, so it can't literally start before any touch).
      From then it loops across the menu AND gameplay; the header / HUD button turns
      it off. Honors the saved OFF preference (play() is a no-op when disabled). */
  private _armMusicAutostart(): void {
    const start = (): void => {
      this.music.play();
      this.ui.setMusicButton(this.music.isEnabled);
      document.removeEventListener("pointerdown", start, true);
      document.removeEventListener("touchstart", start, true);
      document.removeEventListener("keydown", start, true);
    };
    document.addEventListener("pointerdown", start, true);
    document.addEventListener("touchstart", start, true);
    document.addEventListener("keydown", start, true);
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
    this.menuBackground?.setVisible(false);   // pause the cosmos canvas during play
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
    this.shake = Math.max(this.shake, 0.16);   // subtle satisfying collect kick
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
    this.ui.flashNova(); // blue-white full-screen flash ~400ms
    this.ui.floatScore("NOVA", "nova");

    // Shockwave ring — additive torus, scale 1 → ~90 (blue-white supernova).
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.5, 12, 64),
      new THREE.MeshBasicMaterial({color:0xCFE6FF, transparent:true, opacity:1, blending:THREE.AdditiveBlending, depthWrite:false}));
    ring.position.copy(p);
    this.scene.add(ring);
    this._novaRing = {mesh:ring, t:0};

    // Expansion sphere — additive, grows to the blast radius.
    const sph = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20),
      new THREE.MeshBasicMaterial({color:0x8fbcff, transparent:true, opacity:0.5, blending:THREE.AdditiveBlending, depthWrite:false}));
    sph.position.copy(p);
    this.scene.add(sph);
    this._novaSphere = {mesh:sph, t:0};

    // Second, faster outer shock ring — a layered supernova wave.
    const ring2 = new THREE.Mesh(new THREE.TorusGeometry(1, 0.26, 10, 64),
      new THREE.MeshBasicMaterial({color:0x9fd0ff, transparent:true, opacity:0.9, blending:THREE.AdditiveBlending, depthWrite:false}));
    ring2.position.copy(p); ring2.rotation.copy(ring.rotation);
    this.scene.add(ring2);
    this._novaRing2 = {mesh:ring2, t:0};

    // Blinding core flash — a quick bright pop that expands and fades fast.
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({map:TEX.star, color:0xffffff, transparent:true, opacity:0.98, depthWrite:false, blending:THREE.AdditiveBlending}));
    flash.position.copy(p); flash.scale.setScalar(7);
    this.scene.add(flash);
    this._novaFlash = {mesh:flash, t:0};

    // Exposure boost 1.15 → 1.6 → 1.15 over 600ms.
    this._novaExpoT = 0;
    // FOV punch +10 with elastic return + camera shake.
    this.fovPunch = FOV_NOVA_PUNCH;
    this._fovPunchT = 0;
    this.shake = Math.max(this.shake, 1.4);

    // A denser supernova burst — blue-white core, white sparks and cyan embers.
    this.particles.burst(p, 130, 48, 3.2, 0xcfe6ff, 1);
    this.particles.burst(p, 70, 30, 2.0, 0xffffff, 1);
    this.particles.burst(p, 54, 22, 1.4, 0x9fe0ff, 1);
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
    if (this._novaRing2){ this.scene.remove(this._novaRing2.mesh); this._novaRing2 = null; }
    if (this._novaFlash){ this.scene.remove(this._novaFlash.mesh); this._novaFlash = null; }
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

    // IMPORTANT: Game Over must NEVER touch the wallet automatically. Submitting a
    // score needs a signature, which deep-links to the wallet app on iOS — that
    // may only happen when the player explicitly taps "Save score". So here we
    // just stash the run (memory + a local backup) and let _saveScore() publish it.
    this._pendingRun = { score: finalScore, dist: finalDist, dust: this.dust, bigBangs: this.bigBangs };
    if (this.leaderboard.available && finalScore > 0)
      this.leaderboard.savePending(finalScore, finalDist, this.dust, this.bigBangs);

    setTimeout(() => {
      document.getElementById("finalScore")!.textContent = finalScore.toLocaleString("fr-FR");
      document.getElementById("finalDist")!.textContent = finalDist.toLocaleString("fr-FR") + " m";
      document.getElementById("finalDust")!.textContent = this.dust;
      const loc = i18n.get() === "fr" ? "fr-FR" : i18n.get() === "ko" ? "ko-KR" : "en-US";
      document.getElementById("bestScore")!.textContent = i18n.t("gameover.record") + " · " + this.best.toLocaleString(loc);
      document.getElementById("seedLine")!.textContent = i18n.t("gameover.seed") + " · " + this.spawn.seed;
      this.ui.showNewRecord(isNewRecord);
      this.ui.setRank("weekly", null);    // ranks appear only after an explicit Save
      this.ui.setRank("monthly", null);
      const ss = this.ui.saveState;
      const sBtn = this.ui.saveScoreBtn;
      if (this.leaderboard.available && finalScore > 0){
        ss.textContent = i18n.t("gameover.savePrompt"); ss.className = "no";
        sBtn.style.display = ""; sBtn.disabled = false; sBtn.textContent = i18n.t("gameover.saveBtn");
      } else {
        ss.textContent = this.leaderboard.available ? "" : i18n.t("gameover.lbSoon"); ss.className = "no";
        sBtn.style.display = "none";
      }
      this._updateBigBangButton();
      this.ui.gameover.style.display = "flex";
      this.ui.hud.style.display = "none";
      this.ui.pauseBtn.style.display = "none";
    }, 1400);
  }

  /** Explicit "Save score" — the ONLY place a score signature is requested.
      Connects the wallet on demand (also explicit, since the player tapped),
      signs, submits, then reveals the weekly/monthly rank. */
  async _saveScore(){
    if (!this._pendingRun || !this.leaderboard.available) return;
    const btn = this.ui.saveScoreBtn, ss = this.ui.saveState;
    btn.disabled = true; btn.textContent = i18n.t("gameover.saving");
    // Connect on demand so guests can save too — user-initiated, no auto deep link.
    if (!this.wallet.getAddress()){
      try { await this.wallet.connect(); this._refreshIdentity(); }
      catch (e){
        const msg = e instanceof Error ? e.message : String(e);
        const rejected = /reject|denied|refus|cancel|annul|4001|close/i.test(msg);
        ss.textContent = rejected ? i18n.t("wallet.cancelled") : ("⚠ " + msg); ss.className = "no";
        btn.disabled = false; btn.textContent = i18n.t("gameover.saveBtn");
        return;
      }
    }
    // Saving no longer touches the wallet — the score posts with the connected
    // address, instantly. (The wallet signature path was removed because the
    // WalletConnect sign prompt never surfaced in the wallet on mobile.)
    const r = this._pendingRun;
    const ok = await this.leaderboard.submit(r.score, r.dist, r.dust, r.bigBangs);
    if (ok){
      ss.textContent = i18n.t("gameover.saved"); ss.className = "ok";
      btn.style.display = "none";
      const [w, m] = await Promise.all([this.leaderboard.myRank("weekly"), this.leaderboard.myRank("monthly")]);
      this.ui.setRank("weekly", w); this.ui.setRank("monthly", m);
      // Keep the profile in lock-step with the leaderboard the instant a score is
      // saved — best score + ranks update with no reconnect / reload required.
      this.profile.recordBest(r.score, r.dist, r.dust);
      this._refreshIdentity();
      this.profilePanel.refresh();
    } else {
      ss.textContent = "⚠ " + (this.leaderboard.lastSubmitReason || i18n.t("gameover.saveFailed")); ss.className = "no";
      btn.disabled = false; btn.textContent = i18n.t("gameover.saveBtn");
    }
  }

  /** Render the Big Bang hero button. Two modes:
      - CREDIT: the player owns Big Bang credits → instant, no-wallet revive. Shows
        "💥 Big Bang available", the button consumes one credit on tap.
      - BUY: no credits → the existing escalating CRO purchase (#1/#2/#3).
      The 3-per-run limit is enforced in BOTH modes. `_bbMode` drives the click. */
  _updateBigBangButton(){
    const btn = this.ui.bigBangBtn;
    const badge = this.ui.bbBadge;
    const setLabel = (text: string, showPrice: boolean, price?: number) => {
      this.ui.bbLabel.textContent = text;
      if (showPrice && price !== undefined){
        this.ui.bbPrice.textContent = `${price} CRO`;
        this.ui.bbPrice.style.display = "";
      } else {
        this.ui.bbPrice.style.display = "none";
      }
    };
    this.ui.setBigBangCount(this.bigBangs, BIG_BANG_MAX);

    // Per-run limit is absolute — 3 Big Bangs max, credits or not.
    if (this.bigBangs >= BIG_BANG_MAX){
      this._bbMode = "none";
      setLabel(i18n.t("bigbang.max"), false);
      btn.disabled = true;
      badge.textContent = "🔥 " + i18n.t("bigbang.urgency");
      return;
    }

    const credits = this.credits.available();
    if (credits > 0){
      // CREDIT mode — instant revive, no wallet. Show the balance in the button.
      this._bbMode = "credit";
      badge.textContent = "💥 " + i18n.t("bigbang.available");
      setLabel(i18n.t("bigbang.continueCredit", { n: credits }), false);
      btn.disabled = false;
      return;
    }

    // BUY mode — no credits, fall back to the escalating CRO purchase.
    this._bbMode = "buy";
    badge.textContent = "🔥 " + i18n.t("bigbang.urgency");
    const n = this.bigBangs + 1;                 // this purchase would be #n
    const price = BIG_BANG_PRICES[this.bigBangs]; // 10 / 20 / 40
    if (!BIG_BANG_RECIPIENT){
      setLabel(i18n.t("bigbang.soon", { n }), false);
      btn.disabled = true;
    } else if (!this.wallet.getAddress()){
      setLabel(i18n.t("bigbang.connectShort"), true, price);
      btn.disabled = true;
    } else {
      setLabel(i18n.t("bigbang.continue"), true, price);
      btn.disabled = false;
    }
  }

  /** The Big Bang button dispatches by mode: spend a credit instantly, or buy. */
  _bigBangAction(){
    if (this.bigBangs >= BIG_BANG_MAX) return;
    if (this._bbMode === "credit") this._useBigBangCredit();
    else if (this._bbMode === "buy") this._buyBigBang();
  }

  /** Instant, frictionless revive using an owned credit — no wallet, no signature. */
  _useBigBangCredit(){
    if (this.bigBangs >= BIG_BANG_MAX) return;
    if (!this.credits.consume()) { this._updateBigBangButton(); return; }
    this.bigBangs++;                 // still counts toward the 3-per-run limit
    this.ui.bigBangError.textContent = "";
    this._onCreditsChanged();        // refresh menu/profile balance displays
    this._bigBangRevive();           // resume exactly where we died — no Game Over
  }

  /** Refresh every place a credit balance is shown (menu store chip, profile,
      and the live Game Over button) after a purchase or consumption. */
  _onCreditsChanged(){
    this._updateStoreChip();
    if (this.profilePanel?.isOpen?.()) this.profilePanel.refresh();
    if (this.ui.gameover.style.display !== "none") this._updateBigBangButton();
  }

  /** Show the owned-credit count on the menu's Big Bang Store entry. */
  _updateStoreChip(){
    const chip = document.getElementById("storeBadge");
    if (!chip) return;
    const n = this.credits.available();
    chip.textContent = n > 0 ? `💥 ${n}` : "";
    chip.style.display = n > 0 ? "" : "none";
  }

  /** OPTION 1 — pay the escalating CRO price, then revive and continue. */
  async _buyBigBang(){
    if (!BIG_BANG_RECIPIENT || !this.wallet.getAddress()) return;
    if (this.bigBangs >= BIG_BANG_MAX) return;
    const btn = this.ui.bigBangBtn;
    const price = BIG_BANG_PRICES[this.bigBangs];
    btn.disabled = true;
    this.ui.bigBangError.textContent = "";           // clear any previous error
    this.ui.bbLabel.textContent = i18n.t("bigbang.paying");
    this.ui.bbPrice.style.display = "none";
    try {
      const txHash = await this.wallet.payCRO(BIG_BANG_RECIPIENT, price);
      this.bigBangs++;                 // count this revive (per-run; reset on start())
      // Record the purchase so the live Monthly Prize Pool grows (30% community
      // bonus). Fire-and-forget + queued; never blocks the revive.
      const buyer = this.wallet.getAddress();
      if (buyer && txHash){
        this.prizePool.recordPurchase(buyer, txHash, price)
          .catch((err) => console.warn("[BigBang] revenue record failed:", err));
      }
      this._bigBangRevive();           // resume exactly where we died — no Game Over
    } catch (e){
      // Show the REAL reason (never a generic "payment failed") in a dedicated line.
      const reason = e instanceof PayError ? e.reason : "failed";
      const raw = e instanceof Error ? e.message : String(e ?? "");
      const text =
        reason === "rejected"   ? i18n.t("bigbang.errRejected")
        : reason === "funds"    ? i18n.t("bigbang.errFunds", { price })
        : reason === "wrong-chain" ? i18n.t("bigbang.errChain")
        : reason === "no-wallet"   ? i18n.t("bigbang.errNoWallet")
        : i18n.t("bigbang.errGeneric", { reason: raw.slice(0, 120) || "?" });
      this.ui.bigBangError.textContent = text;
      console.warn(`[BigBang] payment failed (${reason}):`, raw);
      this._updateBigBangButton();     // reset button so the player can retry
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
    this.menuBackground?.setVisible(true);     // resume the living cosmos on the menu
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
        // Screen-isotropic speed: derive per-axis world speed from how the field
        // maps to the screen (same mapping Direct Touch uses), so equal stick
        // deflection = equal on-screen speed and the ship goes exactly where you
        // push. Full stick ≈ JOYSTICK_SCREEN_FRAC × the shorter screen side / s.
        const screenPxPerSec = Math.min(innerWidth, innerHeight) * JOYSTICK_SCREEN_FRAC;
        const spX = screenPxPerSec / ((innerWidth  * 0.62) / (CFG.fieldX * 2));
        const spY = screenPxPerSec / ((innerHeight * 0.55) / (CFG.fieldY * 2));
        this.player.pos.x = clamp(this.player.pos.x + v.x * spX * rawDt, -CFG.fieldX + 1.2, CFG.fieldX - 1.2);
        this.player.pos.y = clamp(this.player.pos.y + v.y * spY * rawDt, -CFG.fieldY + 1.2, CFG.fieldY - 1.2);
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
      const s = 1 + r.t*112;
      r.mesh.scale.set(s, s, s);
      r.mesh.material.opacity = Math.max(0, 1 - r.t*0.95);   // longer light falloff
      if (r.t > 1.1){ this.scene.remove(r.mesh); this._novaRing = null; }
    }
    if (this._novaRing2){
      const r = this._novaRing2;
      r.t += dt;
      const s = 1 + r.t*168;                                  // faster, wider outer wave
      r.mesh.scale.set(s, s, s);
      r.mesh.material.opacity = Math.max(0, 0.9*(1 - r.t/1.0));
      if (r.t > 1.0){ this.scene.remove(r.mesh); this._novaRing2 = null; }
    }
    if (this._novaFlash){
      const r = this._novaFlash;
      r.t += dt;
      r.mesh.scale.setScalar(7 + r.t*120);
      r.mesh.material.opacity = Math.max(0, 0.98*(1 - r.t/0.32));
      if (r.t > 0.32){ this.scene.remove(r.mesh); this._novaFlash = null; }
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
