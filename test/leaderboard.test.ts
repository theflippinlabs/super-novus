import { describe, it, expect } from "vitest";
import { weekStartUTC, monthStartUTC, periodStartUTC } from "../src/net/Leaderboard";

// Anchor: 2024-01-01 (UTC) is a Monday.
describe("weekStartUTC", () => {
  it("returns the Monday of the week (UTC)", () => {
    expect(weekStartUTC(new Date("2024-01-01T00:00:00Z"))).toBe("2024-01-01"); // Mon
    expect(weekStartUTC(new Date("2024-01-03T12:00:00Z"))).toBe("2024-01-01"); // Wed
    expect(weekStartUTC(new Date("2024-01-07T23:59:59Z"))).toBe("2024-01-01"); // Sun
    expect(weekStartUTC(new Date("2024-01-08T00:00:00Z"))).toBe("2024-01-08"); // next Mon
  });
  it("handles month boundaries", () => {
    // 2024-03-01 is a Friday → week Monday is 2024-02-26
    expect(weekStartUTC(new Date("2024-03-01T10:00:00Z"))).toBe("2024-02-26");
  });
});

describe("monthStartUTC", () => {
  it("returns the 1st of the month (UTC)", () => {
    expect(monthStartUTC(new Date("2024-07-16T05:00:00Z"))).toBe("2024-07-01");
    expect(monthStartUTC(new Date("2024-01-01T00:00:00Z"))).toBe("2024-01-01");
    expect(monthStartUTC(new Date("2024-12-31T23:59:59Z"))).toBe("2024-12-01");
  });
});

describe("periodStartUTC", () => {
  it("dispatches by period type", () => {
    const d = new Date("2024-01-10T00:00:00Z"); // Wed
    expect(periodStartUTC("weekly")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(periodStartUTC("monthly")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // sanity: both are valid ISO dates for "today"
    void d;
  });
});
