/**
 * Shared types for Project Pocket.
 *
 * This file is the single place where the extension and the web app agree on
 * data shapes. It contains the saved-page JSON model and the category helpers.
 * Keeping these definitions here means the browser extension and the web app
 * cannot silently drift apart: TypeScript checks both against the same type.
 *
 * The browser extension is the first writer of `SavedPage`. In M2 the web app
 * will read the same shape from the backend, so the fields are deliberately
 * JSON-friendly (strings, arrays and booleans only).
 */

/**
 * The built-in project types the app knows about.
 *
 * `as const` makes TypeScript treat this as a tuple of literal strings instead
 * of a generic `string[]`, which lets us derive the `Category` union below.
 * Adding a built-in category here updates the union, the labels and the
 * runtime validation at once.
 */
export const CATEGORIES = ["recipes", "diy", "lyrics", "other"] as const;

/** A built-in category, e.g. "recipes". Derived from {@link CATEGORIES}. */
export type Category = (typeof CATEGORIES)[number];

/**
 * Human-readable labels for the built-in categories, used by both UIs.
 * Keeping them next to the union avoids two divergent label lists.
 */
export const CATEGORY_LABELS: Record<Category, string> = {
  recipes: "Recipes",
  diy: "DIY Projects",
  lyrics: "Lyrics",
  other: "Other",
};

/**
 * A custom category ID.
 *
 * Custom categories are created by the user at runtime, so they cannot be part
 * of the compile-time `Category` union. The `custom:` prefix keeps them
 * distinguishable from built-ins and gives us a cheap runtime validation
 * rule. The part after the prefix is normally a UUID.
 */
export type CustomCategoryId = `custom:${string}`;

/** Any category a saved page can have: a built-in or a user-created one. */
export type CategoryId = Category | CustomCategoryId;

/**
 * A category in a UI list (filter chips, select boxes, the context menu).
 *
 * Built-in definitions come from {@link DEFAULT_CATEGORIES}; custom definitions
 * are stored by the extension. A `SavedPage` stores only the `id`, not the
 * label, so renaming a category later does not require rewriting every page.
 */
export interface CategoryDefinition {
  id: CategoryId;
  label: string;
}

/**
 * The default categories in menu/list order.
 *
 * This is a plain array (not persisted) because the built-in categories are
 * part of the code. Only custom categories are written to extension storage.
 */
export const DEFAULT_CATEGORIES: readonly CategoryDefinition[] = CATEGORIES.map((category) => ({
  id: category,
  label: CATEGORY_LABELS[category],
}));

/**
 * Pattern for custom category IDs. It intentionally accepts hyphenated UUIDs
 * as well as any future simple slug, but rejects spaces and nested colons.
 */
const CUSTOM_CATEGORY_ID_PATTERN = /^custom:[A-Za-z0-9_-]+$/;

/**
 * Type guard that checks whether an unknown value (e.g. parsed JSON or a
 * value from extension storage) is a known built-in category.
 *
 * @param value any value to check
 * @returns `true` if `value` is one of {@link CATEGORIES}
 */
export function isCategory(value: unknown): value is Category {
  // `some` narrows the string comparison without a cast; `includes` would
  // require widening the tuple to `readonly string[]`.
  return typeof value === "string" && CATEGORIES.some((category) => category === value);
}

/**
 * Type guard for a custom category ID.
 *
 * @param value any value to check
 * @returns `true` if `value` is a `custom:` ID with a safe suffix
 */
export function isCustomCategoryId(value: unknown): value is CustomCategoryId {
  return typeof value === "string" && CUSTOM_CATEGORY_ID_PATTERN.test(value);
}

/**
 * Type guard for any category ID accepted by a saved page.
 *
 * @param value any value to check
 * @returns `true` for built-in and custom category IDs
 */
export function isCategoryId(value: unknown): value is CategoryId {
  return isCategory(value) || isCustomCategoryId(value);
}

/**
 * Build a custom category ID from a UUID (or another safe suffix).
 *
 * The caller supplies the UUID because this package intentionally has no DOM
 * or Node type library. The extension generates it with
 * `crypto.randomUUID()`; tests pass a fixed value so assertions are
 * deterministic.
 *
 * @param uuid unique suffix, normally a fresh UUID
 * @returns a validated `custom:<uuid>` ID
 * @throws if the supplied suffix would produce an invalid ID
 */
export function createCustomCategoryId(uuid: string): CustomCategoryId {
  const id = `custom:${uuid}`;
  if (!isCustomCategoryId(id)) {
    throw new Error(`Invalid custom category suffix: ${uuid}`);
  }
  return id;
}

/**
 * Look up the display label for any category ID.
 *
 * Unknown IDs (for example a custom category whose definition disappeared
 * because storage was edited) fall back to the raw ID. That is ugly but keeps
 * the page usable and makes the data problem visible instead of hiding it.
 *
 * @param categoryId category stored on a page
 * @param definitions known built-in and custom definitions
 * @returns human-readable label
 */
export function getCategoryLabel(
  categoryId: CategoryId,
  definitions: readonly CategoryDefinition[] = DEFAULT_CATEGORIES,
): string {
  return definitions.find((definition) => definition.id === categoryId)?.label ?? categoryId;
}

/**
 * A snapshot of the page content, captured when the user saves the page.
 *
 * This is the input for M3 extraction. We store two complementary forms:
 * - JSON-LD, because recipe sites usually expose schema.org/Recipe here;
 * - cleaned visible text, as a fallback for DIY projects, lyrics and the LLM.
 *
 * We intentionally do not store full HTML: pages can be megabytes large and
 * `browser.storage.local` has a small quota. The backend can fetch the live
 * URL later if a parser needs the raw markup.
 */
export interface PageSnapshot {
  /** Parsed `application/ld+json` blocks. Invalid blocks are skipped. */
  jsonLd: unknown[];
  /** Visible page text, whitespace-normalised and capped by the extension. */
  text: string;
  /** When the snapshot was taken, as an ISO-8601 UTC string. */
  capturedAt: string;
  /** `true` when any capture limit cut content off. */
  truncated: boolean;
}

/**
 * Synchronisation state of a saved page.
 *
 * M1 only creates `local` pages: syncing is an explicit M2 feature. The other
 * variants exist now so the storage format does not need a breaking change
 * when the backend arrives.
 */
export type SyncState =
  | { status: "local" }
  | { status: "pending" }
  | { status: "synced"; serverId: string; syncedAt: string }
  | { status: "error"; message: string };

/**
 * A page saved in the user's pocket.
 *
 * Field notes:
 * - `id` is generated once and never changes, even when the same URL is saved
 *   again (duplicate saves become updates).
 * - `url` is absolute and has the `#fragment` removed; query parameters are
 *   kept because they can identify different content.
 * - `favicon` is a URL, not image data. Storing image bytes would waste quota.
 * - `savedAt` records the first save; `updatedAt` changes on every edit or
 *   repeated save. Both are ISO-8601 UTC strings, not `Date` objects, because
 *   the value must survive JSON storage and an HTTP API unchanged.
 */
export interface SavedPage {
  id: string;
  url: string;
  title: string;
  favicon?: string;
  description?: string;
  siteName?: string;
  /** Canonical URL from the page, kept for later dedupe/cleanup decisions. */
  canonicalUrl?: string;
  /** Page language (`<html lang>`), useful for extraction later. */
  lang?: string;
  category: CategoryId;
  tags: string[];
  note: string;
  savedAt: string;
  updatedAt: string;
  snapshot: PageSnapshot;
  sync: SyncState;
}

/**
 * Small internal helper: is this a plain object we can inspect safely?
 *
 * `typeof null === "object"` and arrays are objects too, so both need an
 * explicit check before we read properties from untrusted storage values.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Optional strings may be absent, but must not be numbers/objects. */
function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

/**
 * Type guard for a category definition loaded from storage.
 *
 * @param value unknown value from `browser.storage.local`
 * @returns `true` if it has a valid category ID and a non-empty label
 */
export function isCategoryDefinition(value: unknown): value is CategoryDefinition {
  return (
    isRecord(value) &&
    isCategoryId(value.id) &&
    typeof value.label === "string" &&
    value.label.trim().length > 0
  );
}

/**
 * Type guard for a page snapshot.
 *
 * We check the shape but deliberately do not inspect `jsonLd` deeply: it is
 * arbitrary schema.org JSON from third-party pages. M3 will validate the
 * extracted recipe with a proper schema.
 */
export function isPageSnapshot(value: unknown): value is PageSnapshot {
  return (
    isRecord(value) &&
    Array.isArray(value.jsonLd) &&
    typeof value.text === "string" &&
    typeof value.capturedAt === "string" &&
    typeof value.truncated === "boolean"
  );
}

/**
 * Type guard for the union of synchronisation states.
 *
 * The discriminated `status` field lets TypeScript narrow the optional
 * `serverId`/`message` fields after this guard returns `true`.
 */
export function isSyncState(value: unknown): value is SyncState {
  if (!isRecord(value) || typeof value.status !== "string") {
    return false;
  }

  switch (value.status) {
    case "local":
    case "pending":
      return true;
    case "synced":
      return typeof value.serverId === "string" && typeof value.syncedAt === "string";
    case "error":
      return typeof value.message === "string";
    default:
      return false;
  }
}

/**
 * Type guard for a complete saved page.
 *
 * The extension uses this before trusting data read back from
 * `browser.storage.local`. A hand-edited or corrupted record is skipped by the
 * storage layer instead of crashing the popup.
 *
 * @param value unknown value, typically parsed JSON
 * @returns `true` if `value` can safely be treated as a `SavedPage`
 */
export function isSavedPage(value: unknown): value is SavedPage {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.url === "string" &&
    typeof value.title === "string" &&
    isOptionalString(value.favicon) &&
    isOptionalString(value.description) &&
    isOptionalString(value.siteName) &&
    isOptionalString(value.canonicalUrl) &&
    isOptionalString(value.lang) &&
    isCategoryId(value.category) &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === "string") &&
    typeof value.note === "string" &&
    typeof value.savedAt === "string" &&
    typeof value.updatedAt === "string" &&
    isPageSnapshot(value.snapshot) &&
    isSyncState(value.sync)
  );
}
