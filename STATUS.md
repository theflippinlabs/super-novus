# SUPER NOVUS — Build Status (honest, file-by-file)

Guest build is fully playable and the production build is green
(`npm run typecheck` and `npm run build` both pass). Nothing below is faked.

## ✅ Validated core — ported verbatim from `reference/supernova.html`
Rendering, feel and audio are byte-identical to the reference; any visual or
gameplay difference vs the reference is treated as a bug.
- `src/config.ts` — every gameplay/render constant (zero magic numbers)
- `src/core/rng.ts` — seeded mulberry32 PRNG (deterministic gameplay)
- `src/core/util.ts` — visual-only rand/clamp helpers
- `src/core/textures.ts` — textures + PlanetFactory (verbatim)
- `src/core/legacyCfg.ts` — CFG shape sourced only from config.ts
- `src/entities/Player.ts` — plasma core, shaders byte-identical + `setCharged()`
- `src/entities/{Trail,ObstacleManager,StarDustSystem,Environment}.ts`
- `src/fx/ParticleEngine.ts` — pooled additive particles
- `src/audio/AudioManager.ts` — procedural audio (verbatim) + pause/visibility control
- `src/core/CameraController.ts` — follow/FOV/shake (verbatim) + additive Nova FOV punch
- `src/ui/UIManager.ts` — HUD/screens (auth section adapted to wallet/guest)

## ✅ Phase 1 features — implemented and verified in a headless Chromium run
- **STAR ENERGY** (`GameEngine.collectDust`, `UIManager.setEnergy/setNovaReady`,
  `index.html #energyWrap`) — golden bar 0→100, +9 per dust cluster (dust only),
  blinks + `player.setCharged(true)` + "DOUBLE-TAP — NOVA BLAST" hint at full.
- **Nova Blast** (`GameEngine.novaBlast/_novaDestroy/_tryNova`) — strict double-tap
  on `pointerup` (280ms / <32px between taps / <12px drift) + Space; white-gold
  flash, shockwave torus (1→90), expansion sphere, exposure 1.15→1.6→1.15,
  elastic FOV +10 punch + shake 1.2, 90+ pooled particles, `audio.boom(true)`;
  destroys asteroids/comets/debris in `radial≤45 && -45≤dz≤8`, +150 each.
- **Calibrated progression** (`GameEngine._speedMult/_density/_spawnStep`) —
  SPEED_MULTIPLIERS [1,1.15,1.3,1.5,1.8] then +0.12/lvl cap ×2.4;
  OBSTACLE_DENSITIES [5,8,12,18,25] then +4/lvl cap 40. Base 48 / 30s tier intact.
- **Seeded SpawnManager** (`src/core/SpawnManager.ts`) — extracted `_populate`,
  all gameplay randomness (types/positions/velocities/variants) on SeededRNG;
  `?seed=N` pins a deterministic run; seed shown on the game-over screen.
- **Strict pause** — rAF runs with dt=0, nothing moves/ages/spawns, hum cut,
  music timer suspended, clock resynced on resume.
- **Audio visibility** — `visibilitychange` suspends/resumes the same
  AudioContext + music loop (never recreated).
- **Debug overlay** (`src/ui/DebugOverlay.ts`, `?debug=1`) — FPS, frame time,
  draw calls, triangles, geo/tex/heap, speed, level, energy, density, obstacle
  and particle counts, seed, wallet, network. Zero cost without the flag.

## ✅ Backend (self-contained; deploy requires your credentials)
- `supabase/migrations/0001_scores.sql` — sn_scores + submissions + RLS
- `supabase/functions/submit-score/index.ts` — EIP-191 verify, rate limit, upsert
- `src/net/{WalletManager,Leaderboard}.ts` — real WalletConnect + Supabase reads;
  `available` is false without env config → UI shows explicit non-blocking state,
  zero mock data, guest mode always playable.

## Remaining (needs human credentials — cannot run from this environment)
See `DEPLOYMENT.md` for exact commands: Vercel deploy + env vars, Supabase
`db push`/secrets/function deploy, WalletConnect project id, DNS for
`supernovus.fun`. None are code work.
