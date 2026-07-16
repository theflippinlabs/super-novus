/* Pure, testable progression math (no THREE, no DOM).
   Base speed (48) and the 30s level tier are unchanged; these functions only
   shape the curve between BASE_SPEED and MAX_SPEED and the spawn density. */
import {
  BASE_SPEED, MAX_SPEED,
  SPEED_MULTIPLIERS, SPEED_MULT_STEP, SPEED_MULT_CAP,
  OBSTACLE_DENSITIES, DENSITY_STEP, DENSITY_CAP,
} from "../config";

export const SPAWN_STEP_BASE = 14; // reference band spacing at level-1 density

/** Speed multiplier for a level: table for 1..N, then +step per level, capped. */
export function speedMult(level: number): number {
  if (level <= SPEED_MULTIPLIERS.length) return SPEED_MULTIPLIERS[level - 1];
  return Math.min(SPEED_MULT_CAP,
    SPEED_MULTIPLIERS[SPEED_MULTIPLIERS.length - 1] + (level - SPEED_MULTIPLIERS.length) * SPEED_MULT_STEP);
}

/** Obstacle density for a level: table for 1..N, then +step per level, capped. */
export function density(level: number): number {
  if (level <= OBSTACLE_DENSITIES.length) return OBSTACLE_DENSITIES[level - 1];
  return Math.min(DENSITY_CAP,
    OBSTACLE_DENSITIES[OBSTACLE_DENSITIES.length - 1] + (level - OBSTACLE_DENSITIES.length) * DENSITY_STEP);
}

/** Spawn band spacing from density: baseline at L1, tighter as density rises.
    At L1 this equals the reference's 14-unit step. */
export function spawnStep(level: number): number {
  return Math.max(4, SPAWN_STEP_BASE * OBSTACLE_DENSITIES[0] / density(level));
}

/** Smoothly interpolated speed at a level and intra-level progress frac (0..1),
    clamped to MAX_SPEED. At L1 frac=0 this returns BASE_SPEED exactly. */
export function speedAt(level: number, frac: number): number {
  const f = Math.min(1, Math.max(0, frac));
  const m0 = speedMult(level), m1 = speedMult(level + 1);
  return Math.min(MAX_SPEED, BASE_SPEED * (m0 + (m1 - m0) * f));
}
