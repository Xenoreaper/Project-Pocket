/**
 * The extension popup — the user's local pocket.
 *
 * The popup is a normal React app rendered in an extension page. It reads from
 * `browser.storage.local` through `lib/storage.ts`; the background worker
 * writes to the same storage when the user uses the context menu. There is no
 * server involved in M1.
 *
 * UI structure:
 * - header with the saved-page count;
 * - search + category filter chips;
 * - one `PageCard` per page (open, recategorise, edit tags/note, delete);
 * - a small form for creating custom categories.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { CategoryDefinition, CategoryId, SavedPage } from "@project-pocket/shared";
import { browser } from "wxt/browser";
import { addCategory, deletePage, getCategories, getPages, updatePage } from "../../lib/storage";
import PageCard from "./PageCard";

/** Filter value that matches every category. */
const ALL_CATEGORIES = "all" as const;
type CategoryFilter = typeof ALL_CATEGORIES | CategoryId;

/** Turn an unknown thrown value into a message we can show in the popup. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

/**
 * Main popup component.
 *
 * React hooks used here:
 * - `useState` keeps data and form state;
 * - `useEffect` loads data on mount and subscribes to storage changes;
 * - `useMemo` derives the visible list without recomputing on every render;
 * - `useCallback` keeps the reload function stable for the effect.
 */
export default function App() {
  const [pages, setPages] = useState<SavedPage[]>([]);
  const [categories, setCategories] = useState<CategoryDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<CategoryFilter>(ALL_CATEGORIES);
  const [search, setSearch] = useState("");
  const [newCategory, setNewCategory] = useState("");
  const [addingCategory, setAddingCategory] = useState(false);
  const [busyPageId, setBusyPageId] = useState<string | null>(null);

  /**
   * Reload pages and categories together. `Promise.all` keeps the UI
   * consistent: we never render a list filtered by a category that has not
   * loaded yet.
   */
  const loadData = useCallback(async (): Promise<void> => {
    try {
      const [nextPages, nextCategories] = await Promise.all([getPages(), getCategories()]);
      setPages(nextPages);
      setCategories(nextCategories);
      setError(null);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load. StrictMode may run effects twice in development; the second
  // read is harmless and helps catch accidental write-on-read code.
  useEffect(() => {
    // `loadData` is async and only updates state after awaiting storage, so
    // this is the intended "sync with an external system" effect. The lint
    // rule cannot see through the callback and would prefer an unnecessary
    // state-library indirection.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async storage loader
    void loadData();
  }, [loadData]);

  // If the background worker saves a page while the popup is open, the storage
  // event lets us refresh without polling. We only react to pocket keys, not
  // unrelated extension storage.
  useEffect(() => {
    const handleStorageChange: Parameters<typeof browser.storage.onChanged.addListener>[0] = (
      changes,
      areaName,
    ) => {
      if (areaName !== "local") {
        return;
      }
      const pocketChanged = Object.keys(changes).some((key) => key.startsWith("pocket:v1:"));
      if (pocketChanged) {
        void loadData();
      }
    };

    browser.storage.onChanged.addListener(handleStorageChange);
    return () => {
      browser.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [loadData]);

  // Counts on filter chips show how many pages each category contains; they
  // intentionally ignore the search box so the chips do not jump around while
  // the user types.
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const page of pages) {
      counts.set(page.category, (counts.get(page.category) ?? 0) + 1);
    }
    return counts;
  }, [pages]);

  // Search matches title, URL, tags and note. Lower-casing both sides makes the
  // search case-insensitive without changing the stored values.
  const visiblePages = useMemo(() => {
    const query = search.trim().toLowerCase();
    return pages.filter((page) => {
      const matchesCategory = activeCategory === ALL_CATEGORIES || page.category === activeCategory;
      if (!matchesCategory) {
        return false;
      }
      if (!query) {
        return true;
      }

      return [page.title, page.url, page.note, ...page.tags].some((value) =>
        value.toLowerCase().includes(query),
      );
    });
  }, [activeCategory, pages, search]);

  /**
   * Run a write, then reload from storage so the UI reflects exactly what was
   * persisted (including normalisation performed by the storage layer).
   *
   * @returns `true` on success, `false` if the error banner was set
   */
  const runMutation = useCallback(
    async (operation: () => Promise<unknown>): Promise<boolean> => {
      setError(null);
      try {
        await operation();
        await loadData();
        return true;
      } catch (mutationError) {
        setError(errorMessage(mutationError));
        return false;
      }
    },
    [loadData],
  );

  /** Change a page's category from the select on its card. */
  async function handleRecategorise(pageId: string, category: CategoryId): Promise<void> {
    setBusyPageId(pageId);
    await runMutation(() => updatePage(pageId, { category }));
    setBusyPageId(null);
  }

  /** Save the edited tag/note form. Returns whether the card may close. */
  async function handleSaveDetails(
    pageId: string,
    details: { tags: string[]; note: string },
  ): Promise<boolean> {
    setBusyPageId(pageId);
    const saved = await runMutation(() => updatePage(pageId, details));
    setBusyPageId(null);
    return saved;
  }

  /** Confirm and delete a page. `window.confirm` is available in a popup. */
  async function handleDelete(page: SavedPage): Promise<void> {
    const confirmed = window.confirm(`Delete "${page.title}" from your pocket?`);
    if (!confirmed) {
      return;
    }

    setBusyPageId(page.id);
    await runMutation(() => deletePage(page.id));
    setBusyPageId(null);
  }

  /** Create a custom category; the background worker rebuilds the menu. */
  async function handleAddCategory(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!newCategory.trim() || addingCategory) {
      return;
    }

    setAddingCategory(true);
    const created = await runMutation(() => addCategory(newCategory));
    if (created) {
      setNewCategory("");
    }
    setAddingCategory(false);
  }

  const pageCountLabel = `${pages.length} saved ${pages.length === 1 ? "page" : "pages"}`;

  return (
    <main className="popup">
      <header className="header">
        <div>
          <h1>Project Pocket</h1>
          <p className="subtitle">Everything important from any page, in one pocket.</p>
        </div>
        <span className="count" aria-label={pageCountLabel}>
          {pages.length}
        </span>
      </header>

      <section className="search" aria-label="Search and filter">
        <label className="field-label" htmlFor="page-search">
          Search
        </label>
        <input
          id="page-search"
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Title, tag, note…"
        />

        <div className="filters" aria-label="Filter by category">
          <button
            type="button"
            className="chip"
            aria-pressed={activeCategory === ALL_CATEGORIES}
            onClick={() => setActiveCategory(ALL_CATEGORIES)}
          >
            All <span className="chip-count">{pages.length}</span>
          </button>
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              className="chip"
              aria-pressed={activeCategory === category.id}
              onClick={() => setActiveCategory(category.id)}
            >
              {category.label}{" "}
              <span className="chip-count">{categoryCounts.get(category.id) ?? 0}</span>
            </button>
          ))}
        </div>
      </section>

      {error !== null && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="page-list" aria-label="Saved pages">
        {loading && <p className="muted">Loading your pocket…</p>}

        {!loading && pages.length === 0 && (
          <div className="empty">
            <p>Nothing saved yet.</p>
            <p className="muted">
              Right-click any page and choose <strong>Save to Pocket</strong>.
            </p>
          </div>
        )}

        {!loading && pages.length > 0 && visiblePages.length === 0 && (
          <p className="muted">No pages match this filter.</p>
        )}

        {visiblePages.map((page) => (
          <PageCard
            key={page.id}
            page={page}
            categories={categories}
            busy={busyPageId === page.id}
            onRecategorise={handleRecategorise}
            onSaveDetails={handleSaveDetails}
            onDelete={handleDelete}
          />
        ))}
      </section>

      <section className="new-category" aria-labelledby="new-category-title">
        <h2 id="new-category-title">New category</h2>
        <form className="new-category-form" onSubmit={(event) => void handleAddCategory(event)}>
          <label className="sr-only" htmlFor="new-category">
            New category name
          </label>
          <input
            id="new-category"
            value={newCategory}
            maxLength={40}
            onChange={(event) => setNewCategory(event.target.value)}
            placeholder="e.g. Weekend cooking"
          />
          <button type="submit" disabled={addingCategory || !newCategory.trim()}>
            {addingCategory ? "Adding…" : "Add"}
          </button>
        </form>
      </section>
    </main>
  );
}
