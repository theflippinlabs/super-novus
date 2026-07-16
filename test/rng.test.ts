import { describe, it, expect } from "vitest";
import { SeededRNG } from "../src/core/rng";

describe("SeededRNG", () => {
  it("same seed produces the same sequence", () => {
    const a = new SeededRNG(12345);
    const b = new SeededRNG(12345);
    const seqA = Array.from({ length: 16 }, () => a.next());
    const seqB = Array.from({ length: 16 }, () => b.next());
    expect(seqA).toEqual(seqB);
  });

  it("different seeds diverge", () => {
    const a = new SeededRNG(1);
    const b = new SeededRNG(2);
    const seqA = Array.from({ length: 16 }, () => a.next());
    const seqB = Array.from({ length: 16 }, () => b.next());
    expect(seqA).not.toEqual(seqB);
  });

  it("reset replays the original sequence", () => {
    const r = new SeededRNG(999);
    const first = Array.from({ length: 8 }, () => r.next());
    r.reset();
    const second = Array.from({ length: 8 }, () => r.next());
    expect(first).toEqual(second);
  });

  it("next() stays in [0,1)", () => {
    const r = new SeededRNG(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("range and int respect their bounds", () => {
    const r = new SeededRNG(42);
    for (let i = 0; i < 1000; i++) {
      const v = r.range(5, 9);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThan(9);
      const n = r.int(4);
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(4);
    }
  });

  it("seed is stored as a uint32", () => {
    expect(new SeededRNG(-1).seed).toBe(0xffffffff);
    expect(new SeededRNG(42).seed).toBe(42);
  });
});
