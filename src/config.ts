/* ============================================================
   SUPER NOVUS — Central configuration.
   No magic numbers anywhere else in the codebase.
   Values marked (REF) are copied verbatim from the validated
   reference build and MUST NOT be changed without arbitration.
============================================================ */

// --- Player (REF — validated, do not alter game feel) ---
export const PLAYER_RADIUS = 1.1;
export const PLAYER_LIGHT_INTENSITY = 3.4;
export const PLAYER_LIGHT_INTENSITY_CHARGED = 4.25; // +25% when STAR ENERGY full
export const PLAYER_INVULNERABILITY = 2.0;

// --- Speed / distance (REF) ---
export const BASE_SPEED = 48;
export const MAX_SPEED = 130;

// --- Field bounds (REF) ---
export const FIELD_X = 24;
export const FIELD_Y = 14;
export const SPAWN_AHEAD = 360;
export const CULL_BEHIND = 36;

// --- Collisions ---
export const HITBOX_FORGIVENESS = 0.8; // (REF) collision leniency factor
export const NEAR_MISS_DIST = 3.2;     // (REF) graze margin
export const COLLISION_RADII = {
  rock: 0.8,       // multiplied by instance scale
  planet: 0.92,    // multiplied by planet radius
  moon: 0.92,
  comet: 1.4,
  debris: 1.8,
  blackhole: 2.6,
} as const;

// --- Star dust / energy ---
export const STAR_DUST_VALUE = 100;    // score per dust cluster
export const STAR_DUST_ENERGY = 9;     // STAR ENERGY per dust cluster (~12 = full)
export const STAR_ENERGY_MAX = 100;
export const GRAZE_SCORE = 40;

// --- Nova Blast ---
export const NOVA_RADIUS = 45;
export const NOVA_BLAST_FORWARD = 8;   // max dz behind player still destroyed
export const NOVA_DAMAGE_SCORE = 150;  // per destroyed object

// --- Progression ---
export const LEVEL_DURATION = 30;      // seconds per level
export const SPEED_MULTIPLIERS = [1.0, 1.15, 1.3, 1.5, 1.8]; // L1..L5
export const SPEED_MULT_STEP = 0.12;   // per level beyond 5
export const SPEED_MULT_CAP = 2.4;
export const OBSTACLE_DENSITIES = [5, 8, 12, 18, 25];        // L1..L5
export const DENSITY_STEP = 4;
export const DENSITY_CAP = 40;

// --- Spawn weights (relative) ---
export const ASTEROID_SPAWN_RATE = 0.42;
export const FIELD_SPAWN_RATE = 0.15;
export const PLANET_SPAWN_RATE = 0.11;
export const MOON_SPAWN_RATE = 0.06;
export const DEBRIS_SPAWN_RATE = 0.04;
export const COMET_SPAWN_RATE = 0.05;      // base, scales with level
export const BLACKHOLE_SPAWN_RATE = 0.035; // from level 3
export const DUST_CHAIN_RATE = 0.22;
export const METEOR_INTERVAL = [1.6, 4.2] as const; // random range (s)

// --- Camera ---
export const CAMERA_FOLLOW_FACTOR = 13;    // exponential lerp rate
export const CAMERA_SHAKE_HIT = 0.8;
export const CAMERA_SHAKE_DEATH = 1.6;
export const FOV_BASE = 84;
export const FOV_SPEED_FACTOR = 0.15;
export const FOV_NOVA_PUNCH = 10;
export const FOV_NEAR_MISS = -6;

// --- Slow motion (REF) ---
export const SLOWMO_SCALE = 0.22;
export const SLOWMO_DURATION = 0.2;

// --- Input ---
export const DOUBLE_TAP_DELAY = 280;   // ms between two taps
export const DOUBLE_TAP_MAX_DIST = 32; // px between taps
export const TAP_MAX_MOVE = 12;        // px drift allowed within a tap
export const TOUCH_X_FRACTION = 0.62;  // (REF) screen width for full field X
export const TOUCH_Y_FRACTION = 0.55;  // (REF) screen height for full field Y

// --- Lives ---
export const LIVES = 3;

// --- Wallet / chain ---
export const SUPPORTED_CHAIN_ID = 25;  // Cronos
export const OPTIONAL_CHAIN_IDS = [1];
// EIP-3085 params so an injected wallet can add/switch to Cronos.
export const CRONOS_PARAMS = {
  chainId: "0x19", // 25
  chainName: "Cronos",
  nativeCurrency: { name: "Cronos", symbol: "CRO", decimals: 18 },
  rpcUrls: ["https://evm.cronos.org"],
  blockExplorerUrls: ["https://cronoscan.com"],
} as const;

// --- Leaderboard ---
export const LEADERBOARD_TOP_N = 10;
export const LOCAL_SAVE_KEY = "super-novus:best";
export const LEADERBOARD_PERIODS = ["weekly", "monthly"] as const;
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];
export const WEEKLY_PRIZE_USD = 50;   // displayed only; no prize distribution logic

// --- Rendering ---
export const PIXEL_RATIO_CAP = 2;
export const TONE_EXPOSURE = 1.15;
export const TONE_EXPOSURE_NOVA = 1.6;
export const DRAW_CALL_BUDGET = 120;
