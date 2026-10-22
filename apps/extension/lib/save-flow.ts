/**
 * The save workflow triggered by a context-menu click.
 *
 * Keeping this out of `background.ts` has two benefits:
 * - the workflow (capture → save → badge) can be unit-tested with fakes;
 * - the background entrypoint stays a short list of browser event wiring.
 *
 * The background worker owns no UI. Its only feedback channel is the toolbar
 * badge, so each outcome sets a short-lived text: ✓ saved, ↻ updated, ! error.
 */
import { isCategoryId, type CategoryId } from "@project-pocket/shared";
import { browser } from "wxt/browser";
import { capturePage, type CapturedPage } from "./capture";
import { savePage, type SavePageInput, type SavePageResult } from "./storage";

/** Badge feedback variants. */
export type SaveOutcome = "saved" | "updated" | "error";

/** How long the badge stays visible before it is cleared. */
export const BADGE_CLEAR_MS = 2_500;

/**
 * The small part of `browser.action` used for feedback.
 *
 * A narrow interface keeps the tests independent of the real browser. The
 * colour accepts a CSS hex string; both Chrome and Firefox support that form.
 */
export interface BadgeApi {
  setBadgeText: (details: { text: string }) => Promise<void>;
  setBadgeBackgroundColor: (details: { color: string }) => Promise<void>;
}

/** Text/colour for each outcome. */
const BADGE_APPEARANCE: Record<SaveOutcome, { text: string; color: string }> = {
  saved: { text: "✓", color: "#2e7d32" },
  updated: { text: "↻", color: "#1565c0" },
  error: { text: "!", color: "#c62828" },
};

/** Timer for the automatic badge clear; module-level so a new save resets it. */
let badgeClearTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Show temporary feedback on the toolbar icon.
 *
 * Badge failures are logged but never thrown: a successful save must not be
 * reported as failed just because the badge could not be painted. The timer
 * is best-effort in MV3 (a service worker may be suspended before it fires);
 * the visible badge is still correct until the next action or browser restart.
 *
 * @param outcome which icon/text to show
 * @param badge injection point for tests, defaults to the real action API
 */
export async function showSaveBadge(
  outcome: SaveOutcome,
  badge: BadgeApi = browser.action,
): Promise<void> {
  if (badgeClearTimer !== undefined) {
    clearTimeout(badgeClearTimer);
    badgeClearTimer = undefined;
  }

  const appearance = BADGE_APPEARANCE[outcome];
  try {
    await badge.setBadgeBackgroundColor({ color: appearance.color });
    await badge.setBadgeText({ text: appearance.text });
  } catch (error) {
    console.warn("[Project Pocket] Could not update the toolbar badge.", error);
    return;
  }

  badgeClearTimer = setTimeout(() => {
    badgeClearTimer = undefined;
    // `void` marks the promise intentionally fire-and-forget. `.catch` avoids
    // an unhandled rejection if the worker is shutting down.
    void badge.setBadgeText({ text: "" }).catch(() => undefined);
  }, BADGE_CLEAR_MS);
}

/**
 * Dependencies of the save workflow. Production uses the real implementations;
 * tests pass simple `vi.fn()` objects.
 */
export interface SaveFlowDependencies {
  capturePage: (tabId: number) => Promise<CapturedPage>;
  savePage: (input: SavePageInput) => Promise<SavePageResult>;
  showBadge: (outcome: SaveOutcome) => Promise<void>;
}

/** Production dependencies, resolved once when this module loads. */
const defaultDependencies: SaveFlowDependencies = {
  capturePage,
  savePage,
  showBadge: showSaveBadge,
};

/**
 * Capture, save and report the result of one context-menu click.
 *
 * The category has already been parsed from the menu ID by the caller. It is
 * re-validated here because menu IDs are strings and could be tampered with.
 *
 * @param category category selected in the submenu
 * @param tabId tab to capture
 * @param deps optional fakes for tests
 * @returns the saved page, or `undefined` if capture/storage failed
 */
export async function savePageFromMenu(
  category: CategoryId,
  tabId: number,
  deps: SaveFlowDependencies = defaultDependencies,
): Promise<SavePageResult | undefined> {
  if (!isCategoryId(category)) {
    console.warn(`[Project Pocket] Ignoring unknown menu category: ${String(category)}`);
    await deps.showBadge("error");
    return undefined;
  }

  try {
    const captured = await deps.capturePage(tabId);
    const result = await deps.savePage({
      ...captured,
      category,
    });
    await deps.showBadge(result.created ? "saved" : "updated");
    return result;
  } catch (error) {
    console.error("[Project Pocket] Could not save the page.", error);
    await deps.showBadge("error");
    return undefined;
  }
}
