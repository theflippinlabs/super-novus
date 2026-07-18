import { describe, it, expect } from "vitest";
import { generateAvatar } from "../src/ui/Avatar";

describe("generateAvatar", () => {
  it("is deterministic — same wallet yields the same avatar", () => {
    const w = "0x277B7CAD86D0f56Ae547533934dceA365ac7D7Bf";
    expect(generateAvatar(w)).toBe(generateAvatar(w));
  });

  it("is case-insensitive on the address", () => {
    const w = "0x277B7CAD86D0f56Ae547533934dceA365ac7D7Bf";
    expect(generateAvatar(w)).toBe(generateAvatar(w.toLowerCase()));
  });

  it("different wallets produce different avatars", () => {
    const a = generateAvatar("0x1111111111111111111111111111111111111111");
    const b = generateAvatar("0x2222222222222222222222222222222222222222");
    expect(a).not.toBe(b);
  });

  it("returns an inline SVG data URI", () => {
    const uri = generateAvatar("0xabc");
    expect(uri.startsWith("data:image/svg+xml;utf8,")).toBe(true);
    expect(decodeURIComponent(uri)).toContain("<svg");
    expect(decodeURIComponent(uri)).toContain("radialGradient");
  });

  it("handles empty / missing input without throwing", () => {
    expect(() => generateAvatar("")).not.toThrow();
    expect(generateAvatar("")).toBe(generateAvatar(""));
  });
});
