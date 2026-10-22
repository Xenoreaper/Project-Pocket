/**
 * Tests for the shared `SavedPage` model and its runtime guards.
 *
 * The extension reads JSON back from `browser.storage.local`, so the guards
 * are not only type-level documentation: they protect the UI from corrupted or
 * hand-edited records.
 */
import { describe, expect, it } from "vitest";
import { type SavedPage, type SyncState, isPageSnapshot, isSavedPage, isSyncState } from "./index";

/** Build a complete valid page so each test can change just one field. */
function makeSavedPage(overrides: Partial<SavedPage> = {}): SavedPage {
  return {
    id: "page-1",
    url: "https://example.com/recipe",
    title: "Example recipe",
    favicon: "https://example.com/favicon.ico",
    description: "A test recipe",
    siteName: "Example",
    canonicalUrl: "https://example.com/recipe",
    lang: "en",
    category: "recipes",
    tags: ["quick"],
    note: "Try this next week",
    savedAt: "2026-10-22T10:00:00.000Z",
    updatedAt: "2026-10-22T10:00:00.000Z",
    snapshot: {
      jsonLd: [{ "@type": "Recipe", name: "Example recipe" }],
      text: "Ingredients and instructions",
      capturedAt: "2026-10-22T10:00:00.000Z",
      truncated: false,
    },
    sync: { status: "local" },
    ...overrides,
  };
}

describe("isSavedPage", () => {
  it("accepts a complete page", () => {
    expect(isSavedPage(makeSavedPage())).toBe(true);
  });

  it("accepts a custom category and a synced state", () => {
    const page = makeSavedPage({
      category: "custom:my-category",
      sync: {
        status: "synced",
        serverId: "server-1",
        syncedAt: "2026-10-22T11:00:00.000Z",
      },
    });

    expect(isSavedPage(page)).toBe(true);
  });

  it("rejects records with missing or invalid fields", () => {
    const { title: _title, ...withoutTitle } = makeSavedPage();

    expect(isSavedPage(withoutTitle)).toBe(false);
    expect(isSavedPage(makeSavedPage({ category: "music" as never }))).toBe(false);
    expect(isSavedPage(makeSavedPage({ tags: ["ok", 42] as never }))).toBe(false);
    expect(isSavedPage(makeSavedPage({ snapshot: { jsonLd: "nope" } as never }))).toBe(false);
    expect(isSavedPage(makeSavedPage({ sync: { status: "unknown" } as never }))).toBe(false);
    expect(isSavedPage(null)).toBe(false);
    expect(isSavedPage([])).toBe(false);
  });

  it("allows optional metadata to be absent", () => {
    const page = makeSavedPage({
      favicon: undefined,
      description: undefined,
      siteName: undefined,
      canonicalUrl: undefined,
      lang: undefined,
    });

    expect(isSavedPage(page)).toBe(true);
  });

  it("does not accept null for optional metadata fields", () => {
    expect(isSavedPage(makeSavedPage({ favicon: null as never }))).toBe(false);
  });
});

describe("isPageSnapshot", () => {
  it("requires the four snapshot fields with the right primitive types", () => {
    expect(
      isPageSnapshot({
        jsonLd: [],
        text: "",
        capturedAt: "2026-10-22T10:00:00.000Z",
        truncated: true,
      }),
    ).toBe(true);

    expect(isPageSnapshot({ jsonLd: [], text: "", capturedAt: 42, truncated: false })).toBe(false);
    expect(isPageSnapshot({ jsonLd: {}, text: "", capturedAt: "now", truncated: false })).toBe(
      false,
    );
  });
});

describe("isSyncState", () => {
  it("accepts every valid variant", () => {
    const states: SyncState[] = [
      { status: "local" },
      { status: "pending" },
      { status: "synced", serverId: "server-1", syncedAt: "2026-10-22T11:00:00.000Z" },
      { status: "error", message: "network unavailable" },
    ];

    for (const state of states) {
      expect(isSyncState(state)).toBe(true);
    }
  });

  it("rejects incomplete variants", () => {
    expect(isSyncState({ status: "synced" })).toBe(false);
    expect(isSyncState({ status: "error" })).toBe(false);
    expect(isSyncState({})).toBe(false);
  });
});
