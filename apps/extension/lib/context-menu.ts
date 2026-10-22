/**
 * Context-menu helpers.
 *
 * The background worker builds this menu on startup/install:
 *
 *   Save to Pocket ▸ Recipes
 *                   ▸ DIY Projects
 *                   ▸ ...
 *
 * We keep IDs and parsing here (instead of inside `background.ts`) so they can
 * be unit-tested without a real browser menu. Menu IDs are just strings; the
 * category is encoded after a fixed prefix, e.g.
 * `pocket-save:category:recipes` or `pocket-save:category:custom:<uuid>`.
 */
import { isCategoryId, type CategoryDefinition, type CategoryId } from "@project-pocket/shared";
import type { Browser } from "wxt/browser";

/** ID of the parent item that opens the category submenu. */
export const MENU_ROOT_ID = "pocket-save";

/** Prefix shared by every category child item. */
export const MENU_ITEM_PREFIX = "pocket-save:category:";

/**
 * The tiny part of `browser.contextMenus` we use.
 *
 * Declaring a narrow interface (instead of importing the full browser type in
 * tests) makes it easy to pass a fake object. WXT's real `browser.contextMenus`
 * satisfies it as well.
 */
export interface MenuApi {
  removeAll: () => Promise<void>;
  create: (properties: Browser.contextMenus.CreateProperties) => unknown;
}

/**
 * Turn a category ID into a unique context-menu item ID.
 *
 * The custom category ID already contains a colon (`custom:<uuid>`); slapping
 * another prefix in front is fine because the whole ID is just an opaque key.
 */
export function menuItemIdForCategory(categoryId: CategoryId): string {
  return `${MENU_ITEM_PREFIX}${categoryId}`;
}

/**
 * Extract and validate the category from a clicked menu item.
 *
 * @returns the category ID, or `undefined` for the root item, other
 *   extensions' items, or malformed IDs
 */
export function categoryIdFromMenuItem(menuItemId: string): CategoryId | undefined {
  if (!menuItemId.startsWith(MENU_ITEM_PREFIX)) {
    return undefined;
  }

  const candidate = menuItemId.slice(MENU_ITEM_PREFIX.length);
  return isCategoryId(candidate) ? candidate : undefined;
}

/**
 * Rebuild the whole context menu from the current category list.
 *
 * `removeAll()` first makes this idempotent: it can run on install, on browser
 * startup and whenever a custom category is added. Chrome and Firefox both
 * scope `removeAll` to the calling extension, so it cannot delete other apps'
 * menu items.
 *
 * @param api context-menus API (real browser API or a test fake)
 * @param categories built-in plus custom categories, in display order
 */
export async function installCategoryMenu(
  api: MenuApi,
  categories: readonly CategoryDefinition[],
): Promise<void> {
  await api.removeAll();

  // `all` means the parent appears for page, link, image and selection clicks,
  // so users do not have to find an empty spot on the page before saving.
  const contexts = ["all"] as const;

  api.create({
    id: MENU_ROOT_ID,
    title: "Save to Pocket",
    contexts: [...contexts],
  });

  for (const category of categories) {
    api.create({
      id: menuItemIdForCategory(category.id),
      parentId: MENU_ROOT_ID,
      title: category.label,
      contexts: [...contexts],
    });
  }
}
