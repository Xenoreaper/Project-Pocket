/**
 * One saved page in the popup list.
 *
 * The card has two modes:
 * - read mode: title link, category select, tags and note;
 * - edit mode: a small form for tags and note.
 *
 * Editing tags/note is local UI state and is only written to storage when the
 * user submits. Category changes are intentionally immediate because they are
 * a one-click action.
 */
import { useState, type FormEvent } from "react";
import {
  getCategoryLabel,
  type CategoryDefinition,
  type CategoryId,
  type SavedPage,
} from "@project-pocket/shared";
import { MAX_NOTE_CHARS } from "../../lib/storage";

/** Props passed down from `App`; all writes reload the global list. */
interface PageCardProps {
  page: SavedPage;
  categories: CategoryDefinition[];
  /** Disables controls while a write for this card is in flight. */
  busy: boolean;
  onRecategorise: (pageId: string, category: CategoryId) => Promise<void>;
  onSaveDetails: (pageId: string, details: { tags: string[]; note: string }) => Promise<boolean>;
  onDelete: (page: SavedPage) => Promise<void>;
}

/** Show the host without `www.`, falling back to the raw URL if it is invalid. */
function hostFor(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Format an ISO timestamp for the card; invalid stored values stay readable. */
function formatSavedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "unknown date";
  }
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Render one page card. */
export default function PageCard({
  page,
  categories,
  busy,
  onRecategorise,
  onSaveDetails,
  onDelete,
}: PageCardProps) {
  const [editing, setEditing] = useState(false);
  const [tagsDraft, setTagsDraft] = useState(page.tags.join(", "));
  const [noteDraft, setNoteDraft] = useState(page.note);
  const [faviconBroken, setFaviconBroken] = useState(false);

  const titleId = `page-title-${page.id}`;
  const tagsId = `page-tags-${page.id}`;
  const noteId = `page-note-${page.id}`;
  const categoryId = `page-category-${page.id}`;

  /** Reset drafts from the current page whenever editing starts. */
  function startEditing(): void {
    setTagsDraft(page.tags.join(", "));
    setNoteDraft(page.note);
    setEditing(true);
  }

  /** Submit the tag/note form; close only if storage accepted the update. */
  async function handleDetailsSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const saved = await onSaveDetails(page.id, {
      // The storage layer trims, deduplicates and validates each entry.
      tags: tagsDraft.split(","),
      note: noteDraft,
    });
    if (saved) {
      setEditing(false);
    }
  }

  return (
    <article className="page-card" aria-labelledby={titleId}>
      <div className="page-card-top">
        <div className="favicon" aria-hidden="true">
          {page.favicon !== undefined && !faviconBroken ? (
            <img src={page.favicon} alt="" loading="lazy" onError={() => setFaviconBroken(true)} />
          ) : (
            <span>{(page.title.trim()[0] ?? "•").toUpperCase()}</span>
          )}
        </div>
        <div className="page-card-heading">
          <h2 id={titleId}>
            {/* A normal link opens a new tab in both Chrome and Firefox; no
                "tabs" permission is needed for a user-initiated navigation. */}
            <a href={page.url} target="_blank" rel="noreferrer">
              {page.title}
            </a>
          </h2>
          <p className="page-card-meta">
            {hostFor(page.url)} · {formatSavedAt(page.savedAt)}
          </p>
        </div>
      </div>

      <div className="page-card-controls">
        <label className="sr-only" htmlFor={categoryId}>
          Category for {page.title}
        </label>
        <select
          id={categoryId}
          value={page.category}
          disabled={busy}
          onChange={(event) => void onRecategorise(page.id, event.target.value as CategoryId)}
        >
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.label}
            </option>
          ))}
        </select>

        {!editing && (
          <button type="button" onClick={startEditing} disabled={busy}>
            Edit
          </button>
        )}
        <button type="button" onClick={() => void onDelete(page)} disabled={busy}>
          Delete
        </button>
      </div>

      {page.tags.length > 0 && (
        <ul className="tags" aria-label={`Tags for ${page.title}`}>
          {page.tags.map((tag) => (
            <li key={tag}>{tag}</li>
          ))}
        </ul>
      )}

      {page.note && <p className="page-card-note">{page.note}</p>}

      {editing && (
        <form
          className="details-form"
          onSubmit={(event) => void handleDetailsSubmit(event)}
          aria-label={`Edit details for ${page.title}`}
        >
          <label htmlFor={tagsId}>Tags (comma separated)</label>
          <input
            id={tagsId}
            value={tagsDraft}
            onChange={(event) => setTagsDraft(event.target.value)}
            placeholder="quick, vegetarian"
          />

          <label htmlFor={noteId}>Note</label>
          <textarea
            id={noteId}
            value={noteDraft}
            maxLength={MAX_NOTE_CHARS}
            rows={3}
            onChange={(event) => setNoteDraft(event.target.value)}
            placeholder="Why did you save this?"
          />

          <p className="form-hint">Category: {getCategoryLabel(page.category, categories)}</p>
          <div className="form-actions">
            <button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save details"}
            </button>
            <button type="button" onClick={() => setEditing(false)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </article>
  );
}
