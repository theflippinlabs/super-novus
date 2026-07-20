/* ============================================================
   SUPER NOVUS — Central configuration.
   No magic numbers anywhere else in the codebase.
   Values marked (REF) are copied verbatim from the validated
   reference build and MUST NOT be changed without arbitration.
============================================================ */

// --- Player (REF — validated, do not alter game feel) ---
export const PLAYER_RADIUS = 1.1;      // collision radius — MUST NOT change
export const PLAYER_VISUAL_SCALE = 0.8; // render-only: ~20% smaller than the hitbox
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
export const FOV_SPEED_FACTOR = 0.17;   // a touch more FOV stretch at speed (feel only)
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

// --- Big Bang (paid continue) ---
// Up to 3 revives per run with escalating price: #1=10, #2=20, #3=40 CRO.
export const BIG_BANG_PRICES = [10, 20, 40] as const; // native CRO on Cronos, per revive
export const BIG_BANG_MAX = BIG_BANG_PRICES.length;   // 3
export const BIG_BANG_INVULN = 3.0;                   // seconds of invulnerability on revive
// Cronos treasury that RECEIVES the CRO payment.
export const BIG_BANG_RECIPIENT = "0x277B7CAD86D0f56Ae547533934dceA365ac7D7Bf";

// --- Big Bang Packs (buy credits in advance, consume instantly, no wallet) ---
// A "complete run" = 3 Big Bangs, so runs = credits / 3. Normal price = runs × 70
// CRO (10+20+40 per run); packs are the discounted bulk price.
export interface BigBangPack {
  id: "star" | "asteroid" | "supernova";
  emoji: string;
  credits: number;   // Big Bangs granted
  runs: number;      // complete runs covered (credits / 3)
  priceCRO: number;  // discounted pack price
  normalCRO: number; // à-la-carte equivalent
  saveCRO: number;   // normalCRO - priceCRO
  best?: boolean;    // highlighted as best value
}
export const BIG_BANG_PACKS: readonly BigBangPack[] = [
  { id: "star",      emoji: "⭐",  credits: 9,  runs: 3,  priceCRO: 180,  normalCRO: 210,  saveCRO: 30 },
  { id: "asteroid",  emoji: "☄️", credits: 30, runs: 10, priceCRO: 550,  normalCRO: 700,  saveCRO: 150 },
  { id: "supernova", emoji: "🌌", credits: 90, runs: 30, priceCRO: 1500, normalCRO: 2100, saveCRO: 600, best: true },
] as const;
// localStorage key prefix for a wallet's credit balance + purchase history.
export const BB_CREDITS_PREFIX = "super-novus:bbcredits:";

// --- Prize payouts (owner-approved, sent from the treasury wallet) ---
// Same treasury both receives Big Bang CRO and sends the weekly/monthly prizes.
export const TREASURY_ADDRESS = BIG_BANG_RECIPIENT;
// Manual fallback CRO override for the admin payout panel. 0 = auto-compute from
// the live CRO/USD price + the month's Big Bang revenue (see PrizePool).
export const WEEKLY_PRIZE_CRO = 0;
export const MONTHLY_PRIZE_CRO = 0;

// --- Wallet / chain ---
export const SUPPORTED_CHAIN_ID = 25;  // Cronos
export const OPTIONAL_CHAIN_IDS = [1];
// WalletConnect Cloud Project ID (public client identifier, safe in frontend).
// VITE_WC_PROJECT_ID env overrides this default when set (e.g. in Vercel).
export const WC_PROJECT_ID_DEFAULT = "95d375443a317fc40262e047a99a06a1";
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
// Supabase project (public values — the URL and the publishable/anon key are
// designed to ship in the frontend, protected by RLS). VITE_SUPABASE_URL /
// VITE_SUPABASE_ANON_KEY env vars override these defaults when set.
export const SUPABASE_URL_DEFAULT = "https://xmjqrnlmcvrltjzuptao.supabase.co";
// Legacy anon key (a valid project JWT) — required because the Edge Functions run
// with the default JWT verification ON, and the newer sb_publishable_ key is NOT
// a JWT (the gateway 401'd every submit-score call). This anon JWT passes gateway
// verification; the functions still do their own EIP-191 wallet-signature checks.
// Public by design (shipped in the client, protected by RLS).
export const SUPABASE_ANON_KEY_DEFAULT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhtanFybmxtY3ZybHRqenVwdGFvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQzNTA1MDYsImV4cCI6MjA5OTkyNjUwNn0.je945b1wFgT5GIng82Br5SogeMGV2f6WPzWuHbCwJSo";
export const LEADERBOARD_PERIODS = ["weekly", "monthly"] as const;
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];

// --- Prize pool (USD-pegged, paid in CRO at the live market price) ---
// Weekly  : #1 wins the CRO equivalent of $WEEKLY_PRIZE_USD  (resets Monday 00:00 UTC).
// Monthly : #1 wins the CRO equivalent of $MONTHLY_PRIZE_USD PLUS 30% of all CRO
//           collected from Big Bang purchases that month (the Community Bonus).
export const WEEKLY_PRIZE_USD = 25;    // guaranteed weekly prize (USD, paid in CRO)
export const MONTHLY_PRIZE_USD = 50;   // guaranteed monthly prize (USD, paid in CRO)
export const MONTHLY_BONUS_PCT = 0.30; // + 30% of the month's Big Bang CRO revenue
// Live CRO/USD price (CoinGecko public API, browser-CORS friendly). Used only to
// display / pre-fill the CRO equivalent of the USD-pegged prizes — the USD amounts
// are the guaranteed figures, the CRO equivalent is always approximate ("≈").
export const CRO_PRICE_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=crypto-com-chain&vs_currencies=usd";
export const CRO_PRICE_TTL_MS = 5 * 60 * 1000;   // cache the live price for 5 minutes
export const CRO_PRICE_CACHE_KEY = "super-novus:cro-usd";

// --- Music ---
export const MUSIC_SRC = "/music.mp3";
export const MUSIC_VOLUME = 0.22;      // 22% (target of the 20–25% range)
export const MUSIC_PREF_KEY = "super-novus:music";

// --- Controls ---
export const CONTROL_MODES = ["touch", "joystick"] as const;
export type ControlMode = (typeof CONTROL_MODES)[number];
export const CONTROL_MODE_KEY = "super-novus:controls";
export const DEFAULT_CONTROL_MODE: ControlMode = "touch";
// Virtual joystick (Mode 2 — additive; Direct Touch stays exactly as-is).
export const JOYSTICK_DEAD_ZONE = 0.20;    // fraction of knob travel ignored (0..1)
export const JOYSTICK_MAX_RADIUS = 56;     // px the knob can travel from center
// Response curve applied to stick magnitude (1 = linear). Higher = a small push
// barely moves the ship (calm, precise), full push still reaches top speed — this
// is the main knob that stops the ship darting left/right on tiny movements.
export const JOYSTICK_EXPO = 2.4;
// Full-deflection ship speed as a fraction of the SHORTER screen dimension per
// second. The per-axis world speed is derived at runtime from this so equal stick
// deflection = equal ON-SCREEN speed (the ship goes exactly where you push).
export const JOYSTICK_SCREEN_FRAC = 0.9;

// --- Localization ---
export const LANGUAGES = ["fr", "en", "ko"] as const;
export type Lang = (typeof LANGUAGES)[number];
export const LANG_KEY = "super-novus:lang";
export const DEFAULT_LANG: Lang = "fr";

// --- Player profile ---
export const NICKNAME_MIN = 3;
export const NICKNAME_MAX = 18;
export const AVATAR_MAX_BYTES = 262144;    // 256 KB cap for an uploaded avatar (data URI)
export const PROFILE_HISTORY_LIMIT = 12;   // latest runs shown in the profile

// --- Rendering ---
export const PIXEL_RATIO_CAP = 2;
export const TONE_EXPOSURE = 1.08;       // crisper, less bloom (was 1.15)
export const TONE_EXPOSURE_NOVA = 1.42;  // Nova punch without blowing out (was 1.6)
export const DRAW_CALL_BUDGET = 120;
