/**
 * Tests for the local pocket storage layer.
 *
 * WXT's Vitest plugin replaces the real `browser` object with an in-memory
 * fake browser, so these tests exercise the same API calls the extension uses
 * without touching a real profile or the network.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import type { PageSnapshot } from "@project-pocket/shared";
import {
  CATEGORY_KEY_PREFIX,
  MAX_STORED_PAGE_BYTES,
  PAGE_KEY_PREFIX,
  StorageError,
  addCategory,
  deletePage,
  getCategories,
  getPage,
  getPages,
  normalizeTags,
  normalizeUrl,
  savePage,
  updatePage,
  type SavePageInput,
} from "./storage";

/** Build a small valid capture for tests. */
function makeSnapshot(overrides: Partial<PageSnapshot> = {}): PageSnapshot {
  return {
    jsonLd: [{ "@type": "Recipe", name: "Test soup" }],
    text: "Ingredients and instructions",
    capturedAt: "2026-10-22T10:00:00.000Z",
    truncated: false,
    ...overrides,
  };
}

/** Build a valid save input; individual tests override only what they need. */
function makeInput(overrides: Partial<SavePageInput> = {}): SavePageInput {
  return {
    url: "https://example.com/recipe#ingredients",
    title: "Test soup",
    category: "recipes",
    favicon: "https://example.com/favicon.ico",
    description: "A test recipe",
    siteName: "Example",
    canonicalUrl: "https://example.com/recipe",
    lang: "en",
    snapshot: makeSnapshot(),
    ...overrides,
  };
}

beforeEach(() => {
  // Freeze the clock so savedAt/updatedAt assertions are deterministic.
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-22T10:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("normalizeUrl", () => {
  it("removes the fragment and keeps the query string", () => {
    expect(normalizeUrl("https://example.com/recipe?id=42#steps")).toBe(
      "https://example.com/recipe?id=42",
    );
  });

  it("makes a relative-looking URL absolute and adds the root slash", () => {
    expect(normalizeUrl("https://example.com")).toBe("https://example.com/");
  });

  it("rejects values that are not URLs", () => {
    expect(() => normalizeUrl("not a url")).toThrow(StorageError);
  });
});

describe("normalizeTags", () => {
  it("trims, collapses whitespace and deduplicates case-insensitively", () => {
    expect(normalizeTags(["  quick  dinner ", "Quick Dinner", "pasta", "pasta"])).toEqual([
      "quick dinner",
      "pasta",
    ]);
  });

  it("drops empty tags", () => {
    expect(normalizeTags(["", "   "])).toEqual([]);
  });

  it("rejects tags that are too long", () => {
    expect(() => normalizeTags(["x".repeat(41)])).toThrow(/at most 40/i);
  });

  it("rejects too many tags", () => {
    expect(() => normalizeTags(Array.from({ length: 21 }, (_, index) => `tag-${index}`))).toThrow(
      /at most 20/i,
    );
  });
});

describe("savePage", () => {
  it("creates a page with identity, timestamps and empty user fields", async () => {
    const result = await savePage(makeInput());

    expect(result.created).toBe(true);
    expect(result.page.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(result.page.url).toBe("https://example.com/recipe");
    expect(result.page.savedAt).toBe("2026-10-22T10:00:00.000Z");
    expect(result.page.updatedAt).toBe("2026-10-22T10:00:00.000Z");
    expect(result.page.tags).toEqual([]);
    expect(result.page.note).toBe("");
    expect(result.page.sync).toEqual({ status: "local" });

    // The record is actually in the fake browser, under the versioned key.
    const stored = await fakeBrowser.storage.local.get(`${PAGE_KEY_PREFIX}${result.page.id}`);
    expect(stored[`${PAGE_KEY_PREFIX}${result.page.id}`]).toEqual(result.page);
    expect(await getPages()).toEqual([result.page]);
  });

  it("falls back to the URL when the page has no title", async () => {
    const result = await savePage(makeInput({ title: "   " }));

    expect(result.page.title).toBe("https://example.com/recipe");
  });

  it("updates an existing page with the same normalised URL instead of duplicating it", async () => {
    const first = await savePage(makeInput());
    await updatePage(first.page.id, { tags: ["soup", "quick"], note: "Try this" });

    // Same page, different fragment and a changed title/category/snapshot.
    vi.setSystemTime(new Date("2026-10-22T11:00:00.000Z"));
    const second = await savePage(
      makeInput({
        url: "https://example.com/recipe#other-fragment",
        title: "Updated soup",
        category: "diy",
        snapshot: makeSnapshot({ text: "Updated content" }),
      }),
    );

    expect(second.created).toBe(false);
    expect(second.page.id).toBe(first.page.id);
    expect(second.page.savedAt).toBe(first.page.savedAt);
    expect(second.page.updatedAt).toBe("2026-10-22T11:00:00.000Z");
    expect(second.page.title).toBe("Updated soup");
    expect(second.page.category).toBe("diy");
    expect(second.page.snapshot.text).toBe("Updated content");
    // User-owned fields survive a repeated save.
    expect(second.page.tags).toEqual(["soup", "quick"]);
    expect(second.page.note).toBe("Try this");
    expect(await getPages()).toHaveLength(1);
  });

  it("keeps pages with different query strings separate", async () => {
    await savePage(makeInput({ url: "https://example.com/recipe?id=1" }));
    const second = await savePage(makeInput({ url: "https://example.com/recipe?id=2" }));

    expect(second.created).toBe(true);
    expect(await getPages()).toHaveLength(2);
  });

  it("rejects an unknown category", async () => {
    await expect(savePage(makeInput({ category: "music" as never }))).rejects.toThrow(
      /unknown category/i,
    );
  });

  it("rejects a malformed snapshot", async () => {
    await expect(savePage(makeInput({ snapshot: { text: "nope" } as never }))).rejects.toThrow(
      /snapshot is malformed/i,
    );
  });

  it("rejects a page that exceeds the per-record size limit", async () => {
    await expect(
      savePage(makeInput({ snapshot: makeSnapshot({ text: "x".repeat(MAX_STORED_PAGE_BYTES) }) })),
    ).rejects.toThrow(/too large/i);
  });

  it("turns a raw storage error into a StorageError", async () => {
    vi.spyOn(fakeBrowser.storage.local, "set").mockRejectedValue(new Error("quota exceeded"));
    const operation = savePage(makeInput());

    await expect(operation).rejects.toBeInstanceOf(StorageError);
    await expect(operation).rejects.toThrow(/could not save/i);
  });
});

describe("getPages", () => {
  it("returns pages newest first", async () => {
    const first = await savePage(makeInput({ url: "https://example.com/one", title: "One" }));
    vi.setSystemTime(new Date("2026-10-22T11:00:00.000Z"));
    const second = await savePage(makeInput({ url: "https://example.com/two", title: "Two" }));

    expect((await getPages()).map((page) => page.id)).toEqual([second.page.id, first.page.id]);
  });

  it("skips corrupted records instead of crashing the popup", async () => {
    await fakeBrowser.storage.local.set({ [`${PAGE_KEY_PREFIX}broken`]: { id: "broken" } });

    await expect(getPages()).resolves.toEqual([]);
  });
});

describe("getPage", () => {
  it("returns a page by id and undefined for an unknown id", async () => {
    const saved = await savePage(makeInput());

    expect(await getPage(saved.page.id)).toEqual(saved.page);
    expect(await getPage("missing")).toBeUndefined();
  });
});

describe("updatePage", () => {
  it("updates category, tags and note and bumps updatedAt", async () => {
    const saved = await savePage(makeInput());
    vi.setSystemTime(new Date("2026-10-22T12:00:00.000Z"));

    const updated = await updatePage(saved.page.id, {
      category: "lyrics",
      tags: ["  Song  ", "song", "chords"],
      note: "  Learn the bridge  ",
    });

    expect(updated?.category).toBe("lyrics");
    expect(updated?.tags).toEqual(["Song", "chords"]);
    expect(updated?.note).toBe("Learn the bridge");
    expect(updated?.updatedAt).toBe("2026-10-22T12:00:00.000Z");
    expect(updated?.savedAt).toBe(saved.page.savedAt);
    expect(await getPage(saved.page.id)).toEqual(updated);
  });

  it("returns undefined when the page no longer exists", async () => {
    expect(await updatePage("missing", { note: "x" })).toBeUndefined();
  });

  it("rejects an invalid category", async () => {
    const saved = await savePage(makeInput());

    await expect(updatePage(saved.page.id, { category: "music" as never })).rejects.toThrow(
      /unknown category/i,
    );
  });
});

describe("deletePage", () => {
  it("removes a page and reports whether it existed", async () => {
    const saved = await savePage(makeInput());

    expect(await deletePage(saved.page.id)).toBe(true);
    expect(await getPage(saved.page.id)).toBeUndefined();
    expect(await deletePage(saved.page.id)).toBe(false);
  });
});

describe("categories", () => {
  it("returns all built-in categories by default", async () => {
    expect((await getCategories()).map((category) => category.id)).toEqual([
      "recipes",
      "diy",
      "lyrics",
      "other",
    ]);
  });

  it("creates, stores and returns a custom category", async () => {
    const category = await addCategory("  Weekend   cooking ");

    expect(category.id).toMatch(/^custom:/);
    expect(category.label).toBe("Weekend cooking");
    expect(await getCategories()).toContainEqual(category);
    expect(
      await fakeBrowser.storage.local.get(`${CATEGORY_KEY_PREFIX}${category.id}`),
    ).toHaveProperty(`${CATEGORY_KEY_PREFIX}${category.id}`, category);
  });

  it("rejects duplicate labels case-insensitively", async () => {
    await addCategory("Weekend cooking");

    await expect(addCategory("weekend COOKING")).rejects.toThrow(/already exists/i);
  });

  it("rejects labels that duplicate a built-in category", async () => {
    await expect(addCategory("recipes")).rejects.toThrow(/already exists/i);
  });

  it("rejects empty and overly long labels", async () => {
    await expect(addCategory("   ")).rejects.toThrow(/needs a name/i);
    await expect(addCategory("x".repeat(41))).rejects.toThrow(/at most 40/i);
  });

  it("skips corrupted custom category records", async () => {
    await fakeBrowser.storage.local.set({
      [`${CATEGORY_KEY_PREFIX}broken`]: { id: "broken", label: "" },
    });

    expect((await getCategories()).map((category) => category.id)).toEqual([
      "recipes",
      "diy",
      "lyrics",
      "other",
    ]);
  });
});
