/* SpawnManager — deterministic obstacle/dust population.
   Extracted verbatim from the reference `_populate` logic, but every
   gameplay-affecting random draw now flows through a SeededRNG so a fixed
   seed replays an identical run (Daily Challenge, replay, anti-cheat).

   With no seed the RNG is seeded from crypto.getRandomValues, so the default
   behaviour stays statistically identical to the reference build. */
import { SeededRNG } from "./rng";
import type { ObstacleManager } from "../entities/ObstacleManager";
import type { StarDustSystem } from "../entities/StarDustSystem";

export interface SpawnDeps {
  obstacles: ObstacleManager;
  stardust: StarDustSystem;
}

export class SpawnManager {
  readonly rng: SeededRNG;
  private deps: SpawnDeps;

  constructor(deps: SpawnDeps, seed?: number) {
    this.deps = deps;
    this.rng = new SeededRNG(seed);
  }

  /** uint32 seed driving this run's obstacle sequence. */
  get seed(): number {
    return this.rng.seed;
  }

  /** Rewind the stream to replay the exact same sequence. */
  reset(): void {
    this.rng.reset();
  }

  /** Populate one spawn band at depth z for the given level.
      Structurally identical to the reference `_populate`; Math.random →
      seeded RNG for all gameplay draws (type, variant, comet/black-hole/dust
      gates). Per-obstacle positions/sizes/velocities are seeded inside the
      ObstacleManager/StarDustSystem methods via the rng passed here. */
  populate(z: number, level: number): void {
    const rng = this.rng;
    const { obstacles, stardust } = this.deps;
    // Fewer big planet/moon obstacles in the play field (readability); the freed
    // weight goes to asteroids, so total obstacle density — and difficulty — is
    // unchanged (0.72 obstacle probability, same as before).
    const r = rng.next();
    if (r < 0.05) obstacles.planet(z, false, rng);
    else if (r < 0.08) obstacles.planet(z, true, rng);
    else if (r < 0.23) obstacles.field(z, rng);
    else if (r < 0.68) obstacles.rock(z, null, null, rng);
    else if (r < 0.72) obstacles.debris(z, rng);
    if (level >= 2 && rng.next() < 0.05 + level*0.008) obstacles.comet(z - 7, rng);
    if (level >= 3 && rng.next() < 0.035) obstacles.blackHole(z - 10, rng);
    if (rng.next() < 0.22) stardust.spawnChain(z - 6, rng);
  }
}
