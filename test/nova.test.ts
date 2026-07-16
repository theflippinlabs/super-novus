import { describe, it, expect } from "vitest";
import { isInNovaZone } from "../src/fx/nova";
import { NOVA_RADIUS, NOVA_BLAST_FORWARD } from "../src/config";

describe("isInNovaZone", () => {
  it("includes objects at the player and just ahead", () => {
    expect(isInNovaZone(0, 0)).toBe(true);
    expect(isInNovaZone(10, -20)).toBe(true);
  });
  it("respects the radial limit", () => {
    expect(isInNovaZone(NOVA_RADIUS, 0)).toBe(true);
    expect(isInNovaZone(NOVA_RADIUS + 0.01, 0)).toBe(false);
  });
  it("respects the forward (behind-player) limit", () => {
    expect(isInNovaZone(0, NOVA_BLAST_FORWARD)).toBe(true);
    expect(isInNovaZone(0, NOVA_BLAST_FORWARD + 0.01)).toBe(false);
  });
  it("respects the ahead limit", () => {
    expect(isInNovaZone(0, -NOVA_RADIUS)).toBe(true);
    expect(isInNovaZone(0, -NOVA_RADIUS - 0.01)).toBe(false);
  });
  it("excludes far objects on either axis", () => {
    expect(isInNovaZone(80, 0)).toBe(false);
    expect(isInNovaZone(0, -200)).toBe(false);
  });
});
