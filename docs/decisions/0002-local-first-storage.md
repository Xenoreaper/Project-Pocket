# ADR 0002 — Local-first storage, duplicate handling and page snapshots

- **Status:** accepted
- **Date:** 2026-10-22
- **Deciders:** Project Pocket team (2 people)

## Context

Milestone 1 turns the scaffold into a useful extension: the user right-clicks a page, chooses a
category, and the page is saved locally. The extension must work offline and without an account.
Later milestones add sync, extraction and a web app, so today's local format must not paint us into a
corner.

Three questions mattered most:

1. **How is the pocket stored** in `browser.storage.local`?
2. **What happens when the same URL is saved twice?**
3. **How much page content do we capture** for M3 extraction without wasting the storage quota?

A popup-versus-side-panel choice and the required browser permissions follow from the same
local-first design.

## Decision

### 1. One versioned storage record per page

The extension uses `browser.storage.local`, not IndexedDB and not `localStorage`:

- `browser.storage.local` is asynchronous, available to the popup **and** the background worker, and
  is the portable WebExtension API (Chrome + Firefox).
- `localStorage` is synchronous, tied to one origin/page, and not shared with the background worker.
- IndexedDB would work, but is more code than a small JSON pocket needs.

Keys are versioned and self-contained:

```text
pocket:v1:page:<uuid>       → SavedPage (JSON)
pocket:v1:category:<uuid>   → CategoryDefinition (custom categories only)
```

Built-in categories are code, not storage. Custom categories use IDs of the form `custom:<uuid>`.

Why per-record keys instead of one `pocket:v1:pages` array?

- Saving or editing one page writes one small record, not the whole pocket.
- The popup and the background worker do not have to read-modify-write one shared array.
- A partially corrupted record can be skipped without losing every page.
- The `v1` prefix makes a future migration explicit and cheap to detect.

The trade-off is that listing pages requires reading all keys and filtering by prefix. That is fine
for a personal pocket with hundreds of pages; if it ever becomes slow, an index record can be added
without changing each page.

### 2. Repeated saves are an upsert by normalised URL

The URL is made absolute and its `#fragment` is removed. Query parameters are kept because `?id=42`
can identify different content. If a page with the same normalised URL already exists:

- `id` and `savedAt` are preserved;
- the user's `tags` and `note` are preserved;
- `category`, `title`, metadata and the snapshot are refreshed;
- `updatedAt` changes;
- the badge shows `↻` instead of `✓`.

We chose this over creating a second record because silent duplicates make the popup and later sync
ambiguous. It also means repeatedly saving after the page changes keeps one history entry. The
storage layer does not strip tracking parameters (for example `utm_*`) yet: removing them can merge
pages that are genuinely different, so it is a backlog item with tests.

### 3. Snapshot = bounded JSON-LD + cleaned visible text

Each saved page stores:

- parsed `application/ld+json` blocks (usually schema.org/Recipe on recipe sites);
- visible text with scripts/styles/navigation/footer noise removed;
- `capturedAt` and a `truncated` flag.

Limits:

| Content         | Limit per page    |
| --------------- | ----------------- |
| Visible text    | 40,000 characters |
| JSON-LD (total) | 80,000 characters |
| Whole JSON page | 200,000 bytes     |

We deliberately do **not** store full HTML. Pages can be several megabytes, `storage.local` has a
small quota, and M3 can fetch the live URL if a parser really needs the raw markup. Invalid JSON-LD
blocks are skipped; a truncated JSON string would be invalid, so a block that does not fit the cap is
skipped whole and the snapshot is marked `truncated`.

This makes the common recipe case fast: M3 can try JSON-LD first, then the cleaned text, then the
LLM fallback. The snapshot is a capture, not a guaranteed extraction.

### 4. Popup, not side panel

The pocket UI is a normal toolbar popup. WXT supports Chrome's `sidePanel` API, but Firefox uses a
separate `sidebar_action` API. A popup works in both browsers with the same React entrypoint and is
enough for a personal list. A sidebar can be added later as a separate enhancement.

### 5. Minimal permissions and on-demand injection

The manifest requests only:

| Permission     | Why                                                      |
| -------------- | -------------------------------------------------------- |
| `storage`      | save the pocket in `browser.storage.local`               |
| `contextMenus` | build "Save to Pocket ▸ category"                        |
| `activeTab`    | temporary access to the page the user chose to save      |
| `scripting`    | inject the capture function after the context-menu click |

There is no `<all_urls>`/host permission, no `tabs` permission, and no persistent content script. The
capture function is injected only when the user clicks our menu item. The trade-off is that the
extension cannot silently read pages in the background; that is exactly the privacy property we
want for M1.

## Consequences

**Positive**

- Saving works offline with no account, and the local format is already JSON-friendly for M2 sync.
- No silent duplicates, and tags/notes survive repeated saves.
- Quota usage is bounded and failures become a visible `StorageError`/error badge.
- The permission prompt stays small and understandable in the exam demo.
- The same `SavedPage` type is shared by the extension and the future web app.

**Negative / trade-offs**

- Listing all pages reads every key. Acceptable now, revisit if the pocket grows very large.
- Re-saving updates the snapshot but does not keep page history.
- Custom categories can only be added in M1, not renamed or deleted.
- The snapshot is not full HTML, so a future parser that needs markup must fetch the URL again.
- File URLs and browser-internal pages are likely to fail capture (restricted by the browser).

## Alternatives considered

- **One array under one key** — simplest first version, but every edit rewrites all pages and the
  background/popup can overwrite each other; rejected.
- **IndexedDB** — more powerful and quota-friendly, but asynchronous cursor/transaction code is hard
  to explain for a two-person learning project; rejected for M1.
- **Key by normalised URL** — guarantees no duplicate keys without scanning, but makes IDs long and
  awkward to display, and `id` should stay stable if URL cleanup rules change; rejected.
- **Store full HTML** — best extraction fidelity, but wastes quota and can include private/hidden
  content; rejected.
- **Create a separate record for every save** — preserves history but creates silent duplicates and
  complicates sync; rejected.
- **Side panel/sidebar** — more screen space, but diverges between Chrome and Firefox and is more UI
  work than M1 needs; deferred.
- **Permanent content script with host permissions** — easier page access, but broad permissions and
  unnecessary background reads; rejected.
