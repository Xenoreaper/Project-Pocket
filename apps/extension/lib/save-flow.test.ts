/**
 * Tests for the capture → save → badge workflow and badge feedback.
 *
 * The background script itself only wires browser events; the interesting
 * decisions (what to save, which badge to show, what happens on failure) live
 * in `save-flow.ts` and are tested here with plain fakes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedPage } from "@project-pocket/shared";
import type { CapturedPage } from "./capture";
import {
  BADGE_CLEAR_MS,
  savePageFromMenu,
  showSaveBadge,
  type BadgeApi,
  type SaveFlowDependencies,
} from "./save-flow";

/** Captured data returned by the fake page capture. */
function makeCapturedPage(): CapturedPage {
  return {
    url: "https://example.com/recipe",
    title: "Test soup",
    favicon: "https://example.com/icon.png",
    snapshot: {
      jsonLd: [{ "@type": "Recipe" }],
      text: "Ingredients",
      capturedAt: "2026-10-22T10:00:00.000Z",
      truncated: false,
    },
  };
}

/** Saved record returned by the fake storage layer. */
function makeSavedPage(): SavedPage {
  return {
    id: "page-1",
    url: "https://example.com/recipe",
    title: "Test soup",
    category: "recipes",
    tags: [],
    note: "",
    savedAt: "2026-10-22T10:00:00.000Z",
    updatedAt: "2026-10-22T10:00:00.000Z",
    snapshot: {
      jsonLd: [],
      text: "Ingredients",
      capturedAt: "2026-10-22T10:00:00.000Z",
      truncated: false,
    },
    sync: { status: "local" },
  };
}

/** Build dependencies with sensible defaults; override only what a test needs. */
function makeDependencies(overrides: Partial<SaveFlowDependencies> = {}): SaveFlowDependencies {
  return {
    capturePage: vi.fn().mockResolvedValue(makeCapturedPage()),
    savePage: vi.fn().mockResolvedValue({ page: makeSavedPage(), created: true }),
    showBadge: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("savePageFromMenu", () => {
  it("captures the tab, saves with the selected category and shows ✓", async () => {
    const dependencies = makeDependencies();
    const captured = makeCapturedPage();
    const saved = makeSavedPage();

    const result = await savePageFromMenu("recipes", 42, dependencies);

    expect(dependencies.capturePage).toHaveBeenCalledWith(42);
    expect(dependencies.savePage).toHaveBeenCalledWith({ ...captured, category: "recipes" });
    expect(dependencies.showBadge).toHaveBeenCalledWith("saved");
    expect(result?.page).toEqual(saved);
  });

  it("shows ↻ when storage updated an existing URL", async () => {
    const dependencies = makeDependencies({
      savePage: vi.fn().mockResolvedValue({ page: makeSavedPage(), created: false }),
    });

    const result = await savePageFromMenu("diy", 42, dependencies);

    expect(dependencies.savePage).toHaveBeenCalledWith(
      expect.objectContaining({ category: "diy" }),
    );
    expect(dependencies.showBadge).toHaveBeenCalledWith("updated");
    expect(result?.created).toBe(false);
  });

  it("shows ! and does not save when capture fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const dependencies = makeDependencies({
      capturePage: vi.fn().mockRejectedValue(new Error("restricted page")),
    });

    const result = await savePageFromMenu("recipes", 42, dependencies);

    expect(result).toBeUndefined();
    expect(dependencies.savePage).not.toHaveBeenCalled();
    expect(dependencies.showBadge).toHaveBeenCalledWith("error");
  });

  it("shows ! when storage rejects the page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const dependencies = makeDependencies({
      savePage: vi.fn().mockRejectedValue(new Error("quota exceeded")),
    });

    const result = await savePageFromMenu("recipes", 42, dependencies);

    expect(result).toBeUndefined();
    expect(dependencies.showBadge).toHaveBeenCalledWith("error");
  });

  it("rejects an unknown category without touching the tab", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const dependencies = makeDependencies();

    const result = await savePageFromMenu("music" as never, 42, dependencies);

    expect(result).toBeUndefined();
    expect(dependencies.capturePage).not.toHaveBeenCalled();
    expect(dependencies.showBadge).toHaveBeenCalledWith("error");
  });
});

describe("showSaveBadge", () => {
  /** Fake action API; colours/text are recorded for assertions. */
  function makeBadge(): BadgeApi {
    return {
      setBadgeText: vi.fn().mockResolvedValue(undefined),
      setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  it.each([
    ["saved", "✓", "#2e7d32"],
    ["updated", "↻", "#1565c0"],
    ["error", "!", "#c62828"],
  ] as const)("shows the %s badge and clears it later", async (outcome, text, color) => {
    const badge = makeBadge();

    await showSaveBadge(outcome, badge);

    expect(badge.setBadgeBackgroundColor).toHaveBeenCalledWith({ color });
    expect(badge.setBadgeText).toHaveBeenCalledWith({ text });

    await vi.advanceTimersByTimeAsync(BADGE_CLEAR_MS);
    expect(badge.setBadgeText).toHaveBeenLastCalledWith({ text: "" });
  });

  it("resets the clear timer when a second save happens", async () => {
    const badge = makeBadge();

    await showSaveBadge("saved", badge);
    await vi.advanceTimersByTimeAsync(BADGE_CLEAR_MS - 100);
    await showSaveBadge("updated", badge);
    await vi.advanceTimersByTimeAsync(200);

    // The first timer was cancelled, so the badge is still visible.
    expect(badge.setBadgeText).not.toHaveBeenCalledWith({ text: "" });

    await vi.advanceTimersByTimeAsync(BADGE_CLEAR_MS);
    expect(badge.setBadgeText).toHaveBeenLastCalledWith({ text: "" });
  });

  it("logs badge failures instead of breaking the save result", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const badge: BadgeApi = {
      setBadgeText: vi.fn().mockRejectedValue(new Error("no action")),
      setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
    };

    await expect(showSaveBadge("saved", badge)).resolves.toBeUndefined();
  });
});
