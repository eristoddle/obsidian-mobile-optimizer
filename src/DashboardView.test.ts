// Unit tests for formatLoadTime — task 5.1
// Feature: obsidian-mobile-optimizer

import { formatLoadTime } from "./DashboardView";

describe("formatLoadTime", () => {
  it("returns em dash for null", () => {
    expect(formatLoadTime(null)).toBe("\u2014");
  });

  it("formats zero with two decimal places", () => {
    expect(formatLoadTime(0)).toBe("0.00 ms");
  });

  it("formats an integer with two decimal places", () => {
    expect(formatLoadTime(42)).toBe("42.00 ms");
  });

  it("formats a float already at two decimal places", () => {
    expect(formatLoadTime(1.23)).toBe("1.23 ms");
  });

  it("rounds a float to two decimal places", () => {
    expect(formatLoadTime(1.235)).toBe("1.24 ms");
  });

  it("appends ' ms' suffix for non-null values", () => {
    expect(formatLoadTime(100)).toMatch(/ ms$/);
  });

  it("does not return em dash for a non-null value", () => {
    expect(formatLoadTime(0)).not.toBe("\u2014");
    expect(formatLoadTime(5.5)).not.toBe("\u2014");
  });

  it("handles large numbers", () => {
    expect(formatLoadTime(9999.999)).toBe("10000.00 ms");
  });

  it("handles negative numbers (no special-casing required)", () => {
    expect(formatLoadTime(-1.5)).toBe("-1.50 ms");
  });
});
