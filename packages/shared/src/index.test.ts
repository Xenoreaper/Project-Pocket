/**
 * Tests for the shared category helpers.
 *
 * These tests are the contract that both apps rely on: if someone changes the
 * category list or the guard, this suite fails immediately.
 */
import { describe, expect, it } from "vitest";
import { CATEGORIES, CATEGORY_LABELS, isCategory } from "./index";

describe("shared categories", () => {
  it("contains the project types we plan to support", () => {
    expect(CATEGORIES).toEqual(["recipes", "diy", "lyrics"]);
  });

  it("accepts known categories", () => {
    expect(isCategory("recipes")).toBe(true);
    expect(isCategory("diy")).toBe(true);
  });

  it("rejects unknown or non-string values", () => {
    expect(isCategory("music")).toBe(false);
    expect(isCategory(42)).toBe(false);
    expect(isCategory(null)).toBe(false);
  });

  it("has a label for every category", () => {
    // The Record type already enforces this at compile time; this runtime
    // assertion protects against accidental empty strings.
    for (const category of CATEGORIES) {
      expect(CATEGORY_LABELS[category]).not.toHaveLength(0);
    }
  });
});
