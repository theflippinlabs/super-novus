/* ============================================================
   Seeded PRNG (mulberry32) for DETERMINISTIC gameplay.
   Same seed => same obstacle sequence (Daily Challenge, replay,
   anti-cheat foundation).

   RULE: Only gameplay-affecting randomness goes through this RNG
   (spawns, positions, obstacle velocities, asteroid geometry pick).
   Pure-visual randomness (particles, shimmer, trail jitter) stays
   on Math.random() and must NEVER consume this RNG, or determinism
   breaks.
============================================================ */

export class SeededRNG {
  private state: number;
  readonly seed: number;

  constructor(seed?: number) {
    if (seed === undefined) {
      seed = crypto.getRandomValues(new Uint32Array(1))[0];
    }
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  /** float in [0,1) */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** float in [a,b) */
  range(a: number, b: number): number {
    return a + this.next() * (b - a);
  }

  /** int in [0,n) */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** reset stream back to original seed */
  reset(): void {
    this.state = this.seed;
  }
}
