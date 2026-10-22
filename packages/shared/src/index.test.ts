/**
 * Tests for the shared category helpers.
 *
 * These tests are the contract that both apps rely on: if someone changes the
 * category list or a guard, this suite fails immediately.
 */
import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  DEFAULT_CATEGORIES,
  createCustomCategoryId,
  getCategoryLabel,
  isCategory,
  isCategoryDefinition,
  isCategoryId,
  isCustomCategoryId,
} from "./index";

describe("shared categories", () => {
  it("contains the project types we plan to support, including Other", () => {
    expect(CATEGORIES).toEqual(["recipes", "diy", "lyrics", "other"]);
  });

  it("accepts known built-in categories", () => {
    expect(isCategory("recipes")).toBe(true);
    expect(isCategory("diy")).toBe(true);
    expect(isCategory("other")).toBe(true);
  });

  it("rejects unknown or non-string values", () => {
    expect(isCategory("music")).toBe(false);
    expect(isCategory(42)).toBe(false);
    expect(isCategory(null)).toBe(false);
  });

  it("has a label for every built-in category", () => {
    // The Record type already enforces this at compile time; this runtime
    // assertion protects against accidental empty strings.
    for (const category of CATEGORIES) {
      expect(CATEGORY_LABELS[category]).not.toHaveLength(0);
    }
  });
});

describe("custom categories", () => {
  it("builds and recognises a valid custom category id", () => {
    const id = createCustomCategoryId("123e4567-e89b-12d3-a456-426614174000");

    expect(id).toBe("custom:123e4567-e89b-12d3-a456-426614174000");
    expect(isCustomCategoryId(id)).toBe(true);
    expect(isCategoryId(id)).toBe(true);
  });

  it("rejects malformed custom category ids", () => {
    expect(isCustomCategoryId("custom:")).toBe(false);
    expect(isCustomCategoryId("custom:a:b")).toBe(false);
    expect(isCustomCategoryId("recipes")).toBe(false);
    expect(isCustomCategoryId(12)).toBe(false);
  });

  it("rejects an unsafe suffix instead of creating an invalid id", () => {
    expect(() => createCustomCategoryId("not a safe suffix")).toThrow(/invalid custom category/i);
  });

  it("provides the default category definitions in menu order", () => {
    expect(DEFAULT_CATEGORIES).toEqual([
      { id: "recipes", label: "Recipes" },
      { id: "diy", label: "DIY Projects" },
      { id: "lyrics", label: "Lyrics" },
      { id: "other", label: "Other" },
    ]);
  });

  it("looks up built-in and custom labels, falling back to the id", () => {
    const customId = createCustomCategoryId("my-custom-category");

    expect(getCategoryLabel("recipes")).toBe("Recipes");
    expect(
      getCategoryLabel(customId, [
        ...DEFAULT_CATEGORIES,
        { id: customId, label: "Weekend cooking" },
      ]),
    ).toBe("Weekend cooking");
    expect(getCategoryLabel(customId)).toBe(customId);
  });

  it("validates category definitions from storage", () => {
    expect(isCategoryDefinition({ id: "recipes", label: "Recipes" })).toBe(true);
    expect(isCategoryDefinition({ id: "custom:abc", label: "Custom" })).toBe(true);
    expect(isCategoryDefinition({ id: "recipes", label: "  " })).toBe(false);
    expect(isCategoryDefinition({ id: "music", label: "Music" })).toBe(false);
  });
});
