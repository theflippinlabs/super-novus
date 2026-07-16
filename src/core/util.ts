import * as THREE from "three";

/** Visual-only randomness. NEVER use for gameplay (use SeededRNG). */
export const rand = (a: number, b: number): number => a + Math.random() * (b - a);
export const clamp = THREE.MathUtils.clamp;
export const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
