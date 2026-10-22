/**
 * Tests for context-menu IDs and menu construction.
 *
 * The real browser menu cannot be inspected easily in jsdom, so the tests
 * capture the calls WXT's cross-browser API would receive. This verifies the
 * exact IDs the click handler later parses.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CATEGORIES } from "@project-pocket/shared";
import {
  MENU_ITEM_PREFIX,
  MENU_ROOT_ID,
  categoryIdFromMenuItem,
  installCategoryMenu,
  menuItemIdForCategory,
  type MenuApi,
} from "./context-menu";

/** Small fake that records `removeAll()` and every `create()` call. */
function makeMenuApi() {
  // The generic argument gives each mock the real API signature, which keeps
  // the fake assignable to `MenuApi` and still exposes `.mock` to the tests.
  return {
    removeAll: vi.fn<MenuApi["removeAll"]>().mockResolvedValue(undefined),
    create: vi.fn<MenuApi["create"]>(),
  };
}

let api: ReturnType<typeof makeMenuApi>;

beforeEach(() => {
  api = makeMenuApi();
});

describe("menu item IDs", () => {
  it("round-trips built-in and custom category IDs", () => {
    expect(menuItemIdForCategory("recipes")).toBe(`${MENU_ITEM_PREFIX}recipes`);
    expect(categoryIdFromMenuItem(menuItemIdForCategory("recipes"))).toBe("recipes");

    const custom = "custom:123e4567-e89b-12d3-a456-426614174000" as const;
    expect(menuItemIdForCategory(custom)).toBe(`${MENU_ITEM_PREFIX}${custom}`);
    expect(categoryIdFromMenuItem(menuItemIdForCategory(custom))).toBe(custom);
  });

  it("ignores the parent item, unknown categories and unrelated menu IDs", () => {
    expect(categoryIdFromMenuItem(MENU_ROOT_ID)).toBeUndefined();
    expect(categoryIdFromMenuItem(`${MENU_ITEM_PREFIX}music`)).toBeUndefined();
    expect(categoryIdFromMenuItem("another-extension:item")).toBeUndefined();
    expect(categoryIdFromMenuItem(`${MENU_ITEM_PREFIX}custom:`)).toBeUndefined();
  });
});

describe("installCategoryMenu", () => {
  it("clears stale items, then creates the parent and one child per category", async () => {
    await installCategoryMenu(api, DEFAULT_CATEGORIES);

    expect(api.removeAll).toHaveBeenCalledTimes(1);
    expect(api.removeAll.mock.invocationCallOrder[0]).toBeLessThan(
      api.create.mock.invocationCallOrder[0]!,
    );

    expect(api.create).toHaveBeenNthCalledWith(1, {
      id: MENU_ROOT_ID,
      title: "Save to Pocket",
      contexts: ["all"],
    });
    expect(api.create).toHaveBeenNthCalledWith(2, {
      id: `${MENU_ITEM_PREFIX}recipes`,
      parentId: MENU_ROOT_ID,
      title: "Recipes",
      contexts: ["all"],
    });
    expect(api.create).toHaveBeenNthCalledWith(3, {
      id: `${MENU_ITEM_PREFIX}diy`,
      parentId: MENU_ROOT_ID,
      title: "DIY Projects",
      contexts: ["all"],
    });
    expect(api.create).toHaveBeenCalledTimes(1 + DEFAULT_CATEGORIES.length);
  });

  it("includes custom categories in the order it receives them", async () => {
    await installCategoryMenu(api, [
      ...DEFAULT_CATEGORIES,
      { id: "custom:weekend", label: "Weekend cooking" },
    ]);

    expect(api.create).toHaveBeenLastCalledWith({
      id: `${MENU_ITEM_PREFIX}custom:weekend`,
      parentId: MENU_ROOT_ID,
      title: "Weekend cooking",
      contexts: ["all"],
    });
  });
});
