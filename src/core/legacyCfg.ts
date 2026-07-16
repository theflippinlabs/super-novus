/* Legacy CFG shape expected by the verbatim-ported systems.
   Values sourced ONLY from config.ts (no magic numbers). */
import {
  FIELD_X, FIELD_Y, PLAYER_RADIUS, BASE_SPEED, MAX_SPEED,
  LEVEL_DURATION, LIVES, PLAYER_INVULNERABILITY,
  NEAR_MISS_DIST, SLOWMO_SCALE, SLOWMO_DURATION,
} from "../config";

export const CFG = {
  fieldX: FIELD_X,
  fieldY: FIELD_Y,
  playerR: PLAYER_RADIUS,
  baseSpeed: BASE_SPEED,
  maxSpeed: MAX_SPEED,
  levelEvery: LEVEL_DURATION,
  lives: LIVES,
  invuln: PLAYER_INVULNERABILITY,
  nearMissDist: NEAR_MISS_DIST,
  slowmoScale: SLOWMO_SCALE,
  slowmoTime: SLOWMO_DURATION,
} as const;
