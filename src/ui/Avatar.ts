/* Avatar — deterministic, space-themed identity generated from a wallet address.
   Same wallet always yields the same avatar (galaxy / nebula / stars / plasma in
   cosmic colors), so every player has a unique visual identity before they ever
   upload a custom image. Returns an inline SVG data URI (no network, no deps). */

function hash32(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// mulberry32 — deterministic PRNG seeded from the address.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Cosmic palettes: [outer, mid, core] — nebula, plasma, gold-nova, ember, etc.
const PALETTES = [
  ["#3a1c71", "#d76d77", "#ffaf7b"],
  ["#0f2027", "#2c5364", "#6dd5ed"],
  ["#20002c", "#8e2de2", "#cbb4d4"],
  ["#000428", "#004e92", "#43cea2"],
  ["#42275a", "#734b6d", "#f5c542"],
  ["#0b486b", "#f56217", "#ffd452"],
  ["#12002f", "#5b0e91", "#ff61d2"],
  ["#001510", "#0a6e5a", "#7dffcf"],
];

/** Deterministic cosmic avatar for a wallet, as an SVG data URI. */
export function generateAvatar(wallet: string, size = 128): string {
  const seed = hash32((wallet || "0x0").toLowerCase());
  const r = rng(seed);
  const [c0, c1, c2] = PALETTES[seed % PALETTES.length];

  const gx = (18 + r() * 64).toFixed(1);   // nebula core position (viewBox 0..128)
  const gy = (18 + r() * 64).toFixed(1);
  const rot = Math.floor(r() * 360);
  const s1x = (r() * 128).toFixed(1), s1y = (r() * 128).toFixed(1);
  const s2x = (r() * 128).toFixed(1), s2y = (r() * 128).toFixed(1);

  let stars = "";
  const n = 18 + Math.floor(r() * 16);
  for (let i = 0; i < n; i++) {
    stars += `<circle cx="${(r() * 128).toFixed(1)}" cy="${(r() * 128).toFixed(1)}" r="${(0.4 + r() * 1.7).toFixed(2)}" fill="#fff" opacity="${(0.45 + r() * 0.55).toFixed(2)}"/>`;
  }

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">` +
    `<defs>` +
      `<radialGradient id="bg" cx="${gx}%" cy="${gy}%" r="95%">` +
        `<stop offset="0%" stop-color="${c2}"/><stop offset="45%" stop-color="${c1}"/><stop offset="100%" stop-color="${c0}"/>` +
      `</radialGradient>` +
      `<radialGradient id="pl" cx="50%" cy="50%" r="50%">` +
        `<stop offset="0%" stop-color="#ffffff" stop-opacity="0.9"/>` +
        `<stop offset="55%" stop-color="${c2}" stop-opacity="0.35"/>` +
        `<stop offset="100%" stop-color="${c2}" stop-opacity="0"/>` +
      `</radialGradient>` +
    `</defs>` +
    `<rect width="128" height="128" fill="${c0}"/>` +
    `<rect width="128" height="128" fill="url(#bg)"/>` +
    `<g transform="rotate(${rot} 64 64)">` +
      `<ellipse cx="${s1x}" cy="${s1y}" rx="48" ry="16" fill="url(#pl)" opacity="0.7"/>` +
      `<ellipse cx="${s2x}" cy="${s2y}" rx="30" ry="10" fill="url(#pl)" opacity="0.55"/>` +
    `</g>` +
    stars +
    `<circle cx="${gx}" cy="${gy}" r="15" fill="url(#pl)"/>` +
    `<circle cx="${gx}" cy="${gy}" r="6.5" fill="#fff" opacity="0.95"/>` +
    `</svg>`;

  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}
