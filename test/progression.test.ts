import { describe, it, expect } from "vitest";
import { speedMult, density, spawnStep, speedAt, SPAWN_STEP_BASE } from "../src/core/progression";
import {
  BASE_SPEED, MAX_SPEED,
  SPEED_MULTIPLIERS, SPEED_MULT_CAP,
  OBSTACLE_DENSITIES, DENSITY_CAP,
} from "../src/config";

describe("speedMult", () => {
  it("uses the table for levels 1..N", () => {
    SPEED_MULTIPLIERS.forEach((m, i) => expect(speedMult(i + 1)).toBe(m));
  });
  it("steps by +0.12 beyond the table and caps at 2.4", () => {
    expect(speedMult(6)).toBeCloseTo(1.8 + 0.12, 5);
    expect(speedMult(7)).toBeCloseTo(1.8 + 0.24, 5);
    expect(speedMult(100)).toBe(SPEED_MULT_CAP);
  });
});

describe("density", () => {
  it("uses the table for levels 1..N", () => {
    OBSTACLE_DENSITIES.forEach((d, i) => expect(density(i + 1)).toBe(d));
  });
  it("steps by +4 beyond the table and caps at 40", () => {
    expect(density(6)).toBe(25 + 4);
    expect(density(7)).toBe(25 + 8);
    expect(density(100)).toBe(DENSITY_CAP);
  });
});

describe("spawnStep", () => {
  it("equals the reference 14-unit step at level 1", () => {
    expect(spawnStep(1)).toBe(SPAWN_STEP_BASE); // density[0] cancels out
  });
  it("tightens as density rises and never drops below 4", () => {
    expect(spawnStep(2)).toBeLessThan(spawnStep(1));
    expect(spawnStep(5)).toBeLessThan(spawnStep(2));
    for (let lvl = 1; lvl <= 60; lvl++) expect(spawnStep(lvl)).toBeGreaterThanOrEqual(4);
  });
});

describe("speedAt", () => {
  it("returns exactly BASE_SPEED at level 1, start of level", () => {
    expect(speedAt(1, 0)).toBe(BASE_SPEED);
  });
  it("is monotonic non-decreasing across a level", () => {
    let prev = -Infinity;
    for (let f = 0; f <= 1.0001; f += 0.1) {
      const s = speedAt(1, f);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });
  it("is continuous at a level boundary", () => {
    // end of level L (frac=1) == start of level L+1 (frac=0)
    expect(speedAt(1, 1)).toBeCloseTo(speedAt(2, 0), 6);
    expect(speedAt(4, 1)).toBeCloseTo(speedAt(5, 0), 6);
  });
  it("clamps frac and never exceeds MAX_SPEED", () => {
    expect(speedAt(1, -5)).toBe(BASE_SPEED);
    expect(speedAt(1, 99)).toBe(speedAt(1, 1));
    for (let lvl = 1; lvl <= 100; lvl++) {
      for (const f of [0, 0.5, 1]) expect(speedAt(lvl, f)).toBeLessThanOrEqual(MAX_SPEED);
    }
  });
});
