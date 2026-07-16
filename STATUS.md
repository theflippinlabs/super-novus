# SUPER NOVUS — Build Status (honest, file-by-file)

Snapshot produced in a single working session. Nothing below is faked.

## ✅ Done and typechecking (`npm run typecheck` green)
- `package.json`, `tsconfig.json`, `vite.config.ts`, `vercel.json`, `.env.example`, `.gitignore`
- `src/config.ts` — every gameplay/render constant (zero magic numbers)
- `src/core/rng.ts` — seeded mulberry32 PRNG (deterministic gameplay)
- `src/core/util.ts` — visual-only rand/clamp helpers
- `src/core/textures.ts` — textures + PlanetFactory, ported verbatim from reference
- `src/entities/Player.ts` — validated plasma core, shaders byte-identical + setCharged()

## ✅ Done and self-contained (correct, not yet deployed)
- `supabase/migrations/0001_scores.sql` — sn_scores + sn_score_submissions + RLS
- `supabase/functions/submit-score/index.ts` — EIP-191 verify, rate limit, upsert

## ⛔ NOT yet implemented in this snapshot
These are specified in `super-novus-spec.md` but not written as modules yet:
- `src/entities/Trail.ts` (reference code extracted to /tmp, not yet ported to module)
- `src/entities/{Planet,Asteroid,Meteor,Comet,Debris,BlackHole,Dust}System.ts`
  (the reference keeps these inside monolithic ObstacleManager/Environment/StarDustSystem;
   splitting them per spec is pending)
- `src/fx/{NovaBlast,ParticleEngine,EffectsManager}.ts`
- `src/audio/AudioManager.ts` (reference code extracted, not yet ported/typed)
- `src/net/{WalletManager,Leaderboard}.ts`
- `src/ui/{HUD,Screens}.ts`
- `src/core/{GameEngine,SpawnManager,CameraController}.ts`
- `index.html`, `src/main.ts`, styles
- New features still to wire: STAR ENERGY bar, Nova Blast double-tap detection,
  progression table, pause semantics, local save, debug overlay, audio visibility handling

## Reality check
A fully playable guest build requires the ⛔ section finished and
`npm run build` green. The reference game (`reference/supernova.html`) is
already fully playable standalone and is the fidelity target.
