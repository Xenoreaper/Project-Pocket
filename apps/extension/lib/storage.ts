/**
 * Local pocket storage.
 *
 * The extension keeps the user's pocket in `browser.storage.local`, which is
 * an asynchronous key/value store available to the popup and the background
 * service worker. We store one JSON record per page under a versioned key:
 *
 *   pocket:v1:page:<uuid>       → SavedPage
 *   pocket:v1:category:<uuid>   → CategoryDefinition (custom categories only)
 *
 * Why per-record keys instead of one big array?
 * - Saving/editing one page writes one small record, not the whole pocket.
 * - The popup and background script can change different pages without
 *   overwriting each other's changes (a single array would need a
 *   read-modify-write of everything).
 * - The `v1` prefix gives us a cheap way to migrate to a new layout later.
 *
 * `storage.local` has a quota (roughly 10 MB in current Chrome; Firefox uses
 * a browser-managed IndexedDB-like quota). We therefore cap each page and
 * surface quota/size failures as a `StorageError` instead of losing data
 * silently.
 */
import {
  DEFAULT_CATEGORIES,
  createCustomCategoryId,
  isCategoryDefinition,
  isCategoryId,
  isPageSnapshot,
  isSavedPage,
  type CategoryDefinition,
  type CategoryId,
  type PageSnapshot,
  type SavedPage,
} from "@project-pocket/shared";
import { browser } from "wxt/browser";

/** Prefix for page records. Bump the version when the shape changes. */
export const PAGE_KEY_PREFIX = "pocket:v1:page:";

/** Prefix for custom-category records. Built-ins are never stored. */
export const CATEGORY_KEY_PREFIX = "pocket:v1:category:";

/** Maximum serialised size of one page. Keeps quota usage predictable. */
export const MAX_STORED_PAGE_BYTES = 200_000;

/** User-facing limits. They are enforced here even if a caller forgets. */
export const MAX_TAGS = 20;
export const MAX_TAG_CHARS = 40;
export const MAX_NOTE_CHARS = 5_000;
const MAX_TITLE_CHARS = 500;
const MAX_CATEGORY_LABEL_CHARS = 40;

/**
 * Input for saving a page from the context menu.
 *
 * The storage layer fills in identity and bookkeeping fields (`id`, `savedAt`,
 * `updatedAt`, `sync`) and empty user fields (`tags`, `note`).
 */
export interface SavePageInput {
  url: string;
  title: string;
  category: CategoryId;
  favicon?: string;
  description?: string;
  siteName?: string;
  canonicalUrl?: string;
  lang?: string;
  snapshot: PageSnapshot;
}

/** Result of a save, including whether the URL was new or already present. */
export interface SavePageResult {
  page: SavedPage;
  created: boolean;
}

/** Fields the popup is allowed to edit in M1. */
export type PageUpdate = Partial<Pick<SavedPage, "category" | "tags" | "note">>;

/**
 * Error thrown for invalid input, an oversized page, or a failed storage
 * write. The background script turns this into an error badge; the popup can
 * show the message to the user.
 */
export class StorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StorageError";
  }
}

/**
 * Remove the fragment from a URL and return a stable absolute string.
 *
 * We keep the query string: on many sites `?id=123` selects different content.
 * We do not strip tracking parameters in M1 because that can merge genuinely
 * different pages; a canonical/tracking cleanup is a backlog item.
 *
 * @param rawUrl URL captured from the tab
 * @returns absolute URL without `#fragment`
 * @throws StorageError if the browser cannot parse the URL
 */
export function normalizeUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.hash = "";
    return url.toString();
  } catch (error) {
    throw new StorageError(`Invalid page URL: ${rawUrl}`, { cause: error });
  }
}

/**
 * Trim and deduplicate tags case-insensitively while preserving the first
 * spelling the user typed.
 *
 * @param tags raw tags from the popup or a future importer
 * @returns clean tags in input order
 * @throws StorageError if there are too many tags or one is too long
 */
export function normalizeTags(tags: readonly string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  for (const rawTag of tags) {
    const tag = rawTag.trim().replace(/\s+/g, " ");
    if (!tag) {
      continue;
    }
    if (tag.length > MAX_TAG_CHARS) {
      throw new StorageError(`Tags must be at most ${MAX_TAG_CHARS} characters long.`);
    }

    // Tag filters should treat "Pasta" and "pasta" as the same tag.
    const key = tag.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(tag);
    }
  }

  if (result.length > MAX_TAGS) {
    throw new StorageError(`A page can have at most ${MAX_TAGS} tags.`);
  }

  return result;
}

/**
 * Validate and trim a note before writing it.
 *
 * @param note free-form user note
 * @returns the note without leading/trailing whitespace
 * @throws StorageError if the note is too long
 */
export function normalizeNote(note: string): string {
  const trimmed = note.trim();
  if (trimmed.length > MAX_NOTE_CHARS) {
    throw new StorageError(`Notes must be at most ${MAX_NOTE_CHARS} characters long.`);
  }
  return trimmed;
}

/**
 * Validate a category label for a new custom category.
 *
 * @param label user-entered label
 * @returns collapsed, trimmed label
 * @throws StorageError if the label is empty or too long
 */
export function normalizeCategoryLabel(label: string): string {
  const normalized = label.trim().replace(/\s+/g, " ");
  if (!normalized) {
    throw new StorageError("A category needs a name.");
  }
  if (normalized.length > MAX_CATEGORY_LABEL_CHARS) {
    throw new StorageError(
      `Category names must be at most ${MAX_CATEGORY_LABEL_CHARS} characters long.`,
    );
  }
  return normalized;
}

/** Read every key in `storage.local`; used by the list/category readers. */
async function getAllStorage(): Promise<Record<string, unknown>> {
  // `get(null)` means "all keys". We filter by prefix below instead of using
  // an index, because the pocket is small and this keeps writes simple.
  return browser.storage.local.get(null);
}

/** Return the storage key for a page id. */
function pageKey(id: string): string {
  return `${PAGE_KEY_PREFIX}${id}`;
}

/** Return the storage key for a custom category id. */
function categoryKey(id: CategoryId): string {
  return `${CATEGORY_KEY_PREFIX}${id}`;
}

/**
 * Load all valid pages, newest first.
 *
 * Invalid records are skipped with a warning. We deliberately do not delete
 * them: they may contain data that can be recovered manually, and silently
 * removing user data would be worse than showing a slightly shorter list.
 */
export async function getPages(): Promise<SavedPage[]> {
  const all = await getAllStorage();

  return Object.entries(all)
    .filter(([key]) => key.startsWith(PAGE_KEY_PREFIX))
    .flatMap(([key, value]) => {
      if (isSavedPage(value)) {
        return [value];
      }
      console.warn(`Skipping invalid saved page at storage key ${key}`);
      return [];
    })
    .sort((left, right) => {
      const bySavedAt = right.savedAt.localeCompare(left.savedAt);
      return bySavedAt !== 0 ? bySavedAt : left.id.localeCompare(right.id);
    });
}

/**
 * Load one page by id.
 *
 * @returns the page, or `undefined` if it was deleted or is invalid
 */
export async function getPage(id: string): Promise<SavedPage | undefined> {
  const key = pageKey(id);
  const stored = await browser.storage.local.get(key);
  const value = stored[key];
  return isSavedPage(value) ? value : undefined;
}

/**
 * Load built-in categories plus the user's custom categories.
 *
 * Custom categories are sorted by label so the context menu and popup stay
 * predictable. Definitions whose IDs are built-ins are ignored to prevent a
 * corrupted custom record from shadowing "Recipes" etc.
 */
export async function getCategories(): Promise<CategoryDefinition[]> {
  const all = await getAllStorage();
  const custom = Object.entries(all)
    .filter(([key]) => key.startsWith(CATEGORY_KEY_PREFIX))
    .flatMap(([key, value]) => {
      if (!isCategoryDefinition(value)) {
        console.warn(`Skipping invalid custom category at storage key ${key}`);
        return [];
      }
      if (!value.id.startsWith("custom:")) {
        console.warn(`Skipping non-custom category at storage key ${key}`);
        return [];
      }
      return [value];
    })
    .sort((left, right) => left.label.localeCompare(right.label));

  return [...DEFAULT_CATEGORIES, ...custom];
}

/** Make sure a page fits our per-record budget before writing it. */
function assertPageSize(page: SavedPage): void {
  const bytes = new TextEncoder().encode(JSON.stringify(page)).byteLength;
  if (bytes > MAX_STORED_PAGE_BYTES) {
    throw new StorageError(
      `This page snapshot is too large to store (${bytes} bytes, limit ${MAX_STORED_PAGE_BYTES}).`,
    );
  }
}

/** Write one page and translate raw browser errors into our error type. */
async function writePage(page: SavedPage): Promise<void> {
  assertPageSize(page);
  try {
    await browser.storage.local.set({ [pageKey(page.id)]: page });
  } catch (error) {
    throw new StorageError("Could not save the page to local storage.", { cause: error });
  }
}

/** Normalise a title, falling back to the URL when the page has no title. */
function normalizeTitle(title: string, url: string): string {
  const trimmed = title.trim();
  return (trimmed || url).slice(0, MAX_TITLE_CHARS);
}

/**
 * Add optional metadata fields without writing `undefined` values.
 *
 * `browser.storage.local` stores JSON, and `undefined` object properties are
 * omitted by JSON serialisation anyway. Building the object explicitly keeps
 * the in-memory value and the stored value identical, which makes tests easier
 * to reason about.
 */
function withOptionalMetadata(page: SavedPage, input: SavePageInput): SavedPage {
  const next: SavedPage = { ...page };
  if (input.favicon !== undefined) next.favicon = input.favicon;
  else delete next.favicon;
  if (input.description !== undefined) next.description = input.description;
  else delete next.description;
  if (input.siteName !== undefined) next.siteName = input.siteName;
  else delete next.siteName;
  if (input.canonicalUrl !== undefined) next.canonicalUrl = input.canonicalUrl;
  else delete next.canonicalUrl;
  if (input.lang !== undefined) next.lang = input.lang;
  else delete next.lang;
  return next;
}

/**
 * Save a page, updating an existing page with the same normalised URL.
 *
 * Repeated saves are deliberately an upsert:
 * - `id`, `savedAt`, tags and note are preserved;
 * - category, title, metadata and snapshot are refreshed;
 * - `updatedAt` changes, so the popup can show a repeated save as an update;
 * - `sync` is preserved in M1 (there are no synced pages yet; M2 will mark
 *   edited synced pages as pending).
 *
 * @throws StorageError for invalid input, oversized snapshots or write errors
 */
export async function savePage(input: SavePageInput): Promise<SavePageResult> {
  if (!isCategoryId(input.category)) {
    throw new StorageError(`Unknown category: ${String(input.category)}`);
  }
  if (!isPageSnapshot(input.snapshot)) {
    throw new StorageError("The page snapshot is malformed.");
  }

  const url = normalizeUrl(input.url);
  const now = new Date().toISOString();
  const existing = (await getPages()).find((page) => {
    try {
      return normalizeUrl(page.url) === url;
    } catch {
      return false;
    }
  });

  if (existing) {
    const updated = withOptionalMetadata(
      {
        ...existing,
        url,
        title: normalizeTitle(input.title, url),
        category: input.category,
        snapshot: input.snapshot,
        updatedAt: now,
      },
      input,
    );
    await writePage(updated);
    return { page: updated, created: false };
  }

  const page = withOptionalMetadata(
    {
      id: crypto.randomUUID(),
      url,
      title: normalizeTitle(input.title, url),
      category: input.category,
      tags: [],
      note: "",
      savedAt: now,
      updatedAt: now,
      snapshot: input.snapshot,
      sync: { status: "local" },
    },
    input,
  );
  await writePage(page);
  return { page, created: true };
}

/**
 * Update the user-editable fields of a page.
 *
 * @returns the updated page, or `undefined` if it no longer exists
 * @throws StorageError if a field is invalid or the write fails
 */
export async function updatePage(id: string, patch: PageUpdate): Promise<SavedPage | undefined> {
  const existing = await getPage(id);
  if (!existing) {
    return undefined;
  }

  if (patch.category !== undefined && !isCategoryId(patch.category)) {
    throw new StorageError(`Unknown category: ${String(patch.category)}`);
  }

  const updated: SavedPage = {
    ...existing,
    ...(patch.category !== undefined ? { category: patch.category } : {}),
    ...(patch.tags !== undefined ? { tags: normalizeTags(patch.tags) } : {}),
    ...(patch.note !== undefined ? { note: normalizeNote(patch.note) } : {}),
    updatedAt: new Date().toISOString(),
  };

  await writePage(updated);
  return updated;
}

/**
 * Delete a page permanently.
 *
 * @returns `true` if a page was removed, `false` if the id was already gone
 */
export async function deletePage(id: string): Promise<boolean> {
  const existing = await getPage(id);
  if (!existing) {
    return false;
  }

  try {
    await browser.storage.local.remove(pageKey(id));
  } catch (error) {
    throw new StorageError("Could not delete the page from local storage.", { cause: error });
  }
  return true;
}

/**
 * Create and store a custom category.
 *
 * Labels are unique case-insensitively among built-in and custom categories,
 * so the context menu never has two identical-looking entries.
 *
 * @param label user-entered category name
 * @returns the created definition
 * @throws StorageError for invalid/duplicate labels or write failures
 */
export async function addCategory(label: string): Promise<CategoryDefinition> {
  const normalizedLabel = normalizeCategoryLabel(label);
  const categories = await getCategories();
  const duplicate = categories.find(
    (category) => category.label.toLowerCase() === normalizedLabel.toLowerCase(),
  );
  if (duplicate) {
    throw new StorageError(`A category named "${normalizedLabel}" already exists.`);
  }

  const definition: CategoryDefinition = {
    // The UUID makes the ID stable even if the label is edited later (not in
    // M1). `crypto.randomUUID()` is available in extension pages.
    id: createCustomCategoryId(crypto.randomUUID()),
    label: normalizedLabel,
  };

  try {
    await browser.storage.local.set({ [categoryKey(definition.id)]: definition });
  } catch (error) {
    throw new StorageError("Could not save the category to local storage.", { cause: error });
  }
  return definition;
}
