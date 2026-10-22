/**
 * Popup integration tests.
 *
 * They render the real popup against WXT's in-memory fake browser. This keeps
 * the tests close to what a user does: pages are seeded through the storage
 * layer, then the UI is queried by accessible role/label.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import type { CategoryId } from "@project-pocket/shared";
import {
  addCategory,
  getCategories,
  getPage,
  savePage,
  updatePage,
  type SavePageInput,
} from "../../lib/storage";
import App from "./App";

/** Seed one complete page through the real storage layer. */
async function seedPage(overrides: Partial<SavePageInput> = {}) {
  const result = await savePage({
    url: "https://example.com/recipe",
    title: "Test soup",
    category: "recipes",
    favicon: "https://example.com/icon.png",
    snapshot: {
      jsonLd: [{ "@type": "Recipe" }],
      text: "Ingredients",
      capturedAt: "2026-10-22T10:00:00.000Z",
      truncated: false,
    },
    ...overrides,
  });
  return result.page;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("popup App", () => {
  it("shows the empty state when the pocket has no pages", async () => {
    render(<App />);

    expect(await screen.findByText("Nothing saved yet.")).toBeInTheDocument();
    expect(screen.getByText(/right-click any page/i)).toBeInTheDocument();
    expect(screen.getByLabelText("0 saved pages")).toBeInTheDocument();
  });

  it("lists saved pages with links and metadata", async () => {
    const page = await seedPage();
    render(<App />);

    const heading = await screen.findByRole("heading", { name: "Test soup" });
    expect(heading).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Test soup" })).toHaveAttribute("href", page.url);
    expect(screen.getByText(/example\.com/)).toBeInTheDocument();
    expect(screen.getByLabelText("1 saved page")).toBeInTheDocument();
  });

  it("filters by category with the chips", async () => {
    await seedPage();
    await seedPage({ url: "https://example.com/project", title: "Shelf", category: "diy" });
    render(<App />);

    await screen.findByRole("heading", { name: "Test soup" });
    expect(screen.getByRole("heading", { name: "Shelf" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^DIY Projects/ }));

    expect(screen.queryByRole("heading", { name: "Test soup" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Shelf" })).toBeInTheDocument();
  });

  it("searches title, tags and notes", async () => {
    const page = await seedPage();
    await updatePage(page.id, { tags: ["vegetarian"], note: "Use the green pot" });
    render(<App />);

    await screen.findByRole("heading", { name: "Test soup" });
    const search = screen.getByLabelText("Search");

    fireEvent.change(search, { target: { value: "green pot" } });
    expect(screen.getByRole("heading", { name: "Test soup" })).toBeInTheDocument();

    fireEvent.change(search, { target: { value: "not in this page" } });
    expect(screen.getByText("No pages match this filter.")).toBeInTheDocument();
  });

  it("changes a page category immediately", async () => {
    const page = await seedPage();
    render(<App />);

    await screen.findByRole("heading", { name: "Test soup" });
    fireEvent.change(screen.getByLabelText("Category for Test soup"), {
      target: { value: "lyrics" satisfies CategoryId },
    });

    await waitFor(async () => {
      expect((await getPage(page.id))?.category).toBe("lyrics");
    });
    expect(screen.getByLabelText("Category for Test soup")).toHaveValue("lyrics");
  });

  it("edits tags and note through the details form", async () => {
    const page = await seedPage();
    render(<App />);

    await screen.findByRole("heading", { name: "Test soup" });
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    fireEvent.change(screen.getByLabelText(/Tags \(comma separated\)/), {
      target: { value: "quick, vegetarian, quick" },
    });
    fireEvent.change(screen.getByLabelText("Note"), {
      target: { value: "  Try with bread  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));

    await waitFor(async () => {
      const updated = await getPage(page.id);
      expect(updated?.tags).toEqual(["quick", "vegetarian"]);
      expect(updated?.note).toBe("Try with bread");
    });

    expect(await screen.findByText("quick")).toBeInTheDocument();
    expect(screen.getByText("Try with bread")).toBeInTheDocument();
    expect(screen.queryByLabelText("Note")).not.toBeInTheDocument();
  });

  it("deletes a page after confirmation", async () => {
    const page = await seedPage();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<App />);

    await screen.findByRole("heading", { name: "Test soup" });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "Test soup" })).not.toBeInTheDocument();
    });
    expect(await getPage(page.id)).toBeUndefined();
    expect(screen.getByText("Nothing saved yet.")).toBeInTheDocument();
  });

  it("does not delete when the confirmation is cancelled", async () => {
    const page = await seedPage();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App />);

    await screen.findByRole("heading", { name: "Test soup" });
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(await getPage(page.id)).toBeDefined();
    expect(screen.getByRole("heading", { name: "Test soup" })).toBeInTheDocument();
  });

  it("creates a custom category and shows it as a filter", async () => {
    render(<App />);
    await screen.findByText("Nothing saved yet.");

    fireEvent.change(screen.getByLabelText("New category name"), {
      target: { value: "  Weekend   cooking " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByRole("button", { name: /^Weekend cooking/ })).toBeInTheDocument();
    expect((await getCategories()).some((category) => category.label === "Weekend cooking")).toBe(
      true,
    );
  });

  it("shows a storage error banner instead of crashing", async () => {
    vi.spyOn(fakeBrowser.storage.local, "get").mockRejectedValue(new Error("storage unavailable"));
    render(<App />);

    expect(await screen.findByRole("alert")).toHaveTextContent("storage unavailable");
  });

  it("shows custom categories in the recategorise select", async () => {
    const custom = await addCategory("Weekend cooking");
    const page = await seedPage({ category: custom.id });
    render(<App />);

    await screen.findByRole("heading", { name: "Test soup" });
    const select = screen.getByLabelText("Category for Test soup");
    expect(within(select).getByRole("option", { name: "Weekend cooking" })).toBeInTheDocument();
    expect(select).toHaveValue(custom.id);
    expect(page.category).toBe(custom.id);
  });
});
