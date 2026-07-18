/* Identity — deterministic, human-readable player identities derived from a
   wallet address. A raw blockchain address is NEVER shown in the UI; instead
   every wallet maps to a stable space-themed nickname (e.g. "Nova Voyager 47")
   until the player chooses their own. Pairs with generateAvatar() so each player
   has a coherent avatar + name before they ever set one. No network, no deps. */

function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Cosmic word banks — combined into "Adjective Noun NN" for a stable identity.
const ADJ = [
  "Nova", "Stellar", "Cosmic", "Astral", "Lunar", "Solar", "Nebula", "Quasar",
  "Pulsar", "Orbital", "Galactic", "Photon", "Meteor", "Comet", "Vortex", "Radiant",
  "Celestial", "Ion", "Plasma", "Aurora", "Zenith", "Eclipse", "Gravity", "Warp",
];
const NOUN = [
  "Voyager", "Drifter", "Ranger", "Pilot", "Wanderer", "Nomad", "Rider", "Seeker",
  "Racer", "Pioneer", "Hunter", "Sentinel", "Runner", "Striker", "Falcon", "Phoenix",
  "Titan", "Warden", "Ghost", "Blaze", "Surge", "Flare", "Specter", "Corsair",
];

/** Stable, address-free display name for a wallet. */
export function generateNickname(wallet: string): string {
  const h = hash32((wallet || "0x0").toLowerCase());
  const adj = ADJ[h % ADJ.length];
  const noun = NOUN[(h >>> 8) % NOUN.length];
  const num = (h >>> 16) % 100;
  return `${adj} ${noun} ${num}`;
}

/** The name to render for a wallet: the player's chosen nickname if any, else a
    deterministic space name. Guarantees an address is never displayed. */
export function displayName(wallet: string, nickname?: string | null): string {
  const n = (nickname ?? "").trim();
  return n || generateNickname(wallet);
}

/** Neutral user silhouette (inline SVG data URI) — the "no custom avatar" hint on
    the header profile button when the player is a guest. */
export function silhouetteDataUri(color = "#9fb0e6"): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">` +
    `<circle cx="24" cy="17" r="8.4" fill="${color}"/>` +
    `<path d="M8 42c0-9.4 7.2-15 16-15s16 5.6 16 15z" fill="${color}"/>` +
    `</svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}
