/**
 * Background script ("service worker" in MV3).
 *
 * Responsibilities:
 * 1. Build the right-click menu with one submenu entry per category.
 * 2. On a menu click, capture the active tab and save it locally.
 * 3. Show the result on the toolbar badge.
 *
 * The background script is not always running. Chrome/Firefox start it for an
 * event (install, startup, menu click, storage change) and may suspend it
 * afterwards. Therefore every listener must be registered synchronously at the
 * top level; asynchronous work happens inside the callbacks.
 */
import { browser } from "wxt/browser";
import { categoryIdFromMenuItem, installCategoryMenu } from "../lib/context-menu";
import { savePageFromMenu, showSaveBadge } from "../lib/save-flow";
import { CATEGORY_KEY_PREFIX, getCategories } from "../lib/storage";

/**
 * Rebuild the context menu from the current built-in and custom categories.
 *
 * Errors are logged instead of thrown: if menu creation fails, the rest of the
 * extension (popup, saved data) should still work.
 */
async function refreshCategoryMenu(): Promise<void> {
  try {
    const categories = await getCategories();
    await installCategoryMenu(browser.contextMenus, categories);
  } catch (error) {
    console.error("[Project Pocket] Could not build the context menu.", error);
  }
}

/**
 * Handle a click on one of our category items.
 *
 * `info.menuItemId` is a string for our items. The tab may be missing on some
 * browser-internal surfaces; in that case we show the error badge instead of
 * failing silently.
 */
async function handleMenuClick(menuItemId: string, tabId: number | undefined): Promise<void> {
  const category = categoryIdFromMenuItem(menuItemId);
  if (!category) {
    // Clicks on the parent "Save to Pocket" item do not select a category.
    return;
  }

  if (tabId === undefined) {
    await showSaveBadge("error");
    return;
  }

  await savePageFromMenu(category, tabId);
}

export default defineBackground(() => {
  // Install/update and browser start are the two moments when the menu needs
  // to exist. Calling refresh immediately also covers extension reloads during
  // development, where onInstalled may not fire again.
  browser.runtime.onInstalled.addListener(() => {
    void refreshCategoryMenu();
  });
  browser.runtime.onStartup.addListener(() => {
    void refreshCategoryMenu();
  });

  // Adding a custom category in the popup writes a storage record. Watching
  // the category prefix keeps the context menu in sync without message passing.
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }
    const categoryChanged = Object.keys(changes).some((key) => key.startsWith(CATEGORY_KEY_PREFIX));
    if (categoryChanged) {
      void refreshCategoryMenu();
    }
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (typeof info.menuItemId !== "string") {
      return;
    }
    void handleMenuClick(info.menuItemId, tab?.id);
  });

  // Ensure the menu exists on the very first run (and after a dev reload).
  void refreshCategoryMenu();
});
