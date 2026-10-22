/**
 * Page capture for the extension.
 *
 * When the user picks a category in the context menu, the background worker
 * injects one function into the active tab with `browser.scripting.executeScript`.
 * That function reads the page's metadata, JSON-LD and visible text and returns
 * a plain JSON object. The background worker then passes the object to
 * `savePage()` in `lib/storage.ts`.
 *
 * Why injection instead of a permanent content script?
 * - We only need page access at the moment of saving, not on every page load.
 * - `activeTab` grants temporary access after the user's context-menu click, so
 *   we do not need broad host permissions ("read data on all websites").
 * - There is no long-lived content script to keep in sync with the page.
 *
 * The injected function MUST be self-contained. Chrome/Firefox serialise it
 * with `Function.toString()` and run it in the page, where variables from this
 * module do not exist. It may only use its arguments and page globals
 * (`document`, `window`, `URL`, `Date`, ...). Read `collectPageData` with that
 * restriction in mind.
 */
import { isPageSnapshot, type PageSnapshot } from "@project-pocket/shared";
import { browser } from "wxt/browser";

/**
 * Size limits for one capture.
 *
 * `storage.local` has a small quota, so we never store full HTML. The text cap
 * keeps the common case small; JSON-LD usually contains the structured recipe.
 * Both values are passed into the injected function as an argument so the
 * function stays self-contained.
 */
export interface CaptureLimits {
  /** Maximum number of characters kept from cleaned visible text. */
  maxTextChars: number;
  /** Maximum total characters of serialised JSON-LD blocks. */
  maxJsonLdChars: number;
}

/** Default caps, chosen to stay well below the 200 KB per-page storage limit. */
export const CAPTURE_LIMITS: CaptureLimits = Object.freeze({
  maxTextChars: 40_000,
  maxJsonLdChars: 80_000,
});

/**
 * Everything the extension needs to save a page.
 *
 * This is also exactly what the injected function returns, so it must remain
 * JSON-serialisable: no `Date`, `Node` or functions.
 */
export interface CapturedPage {
  /** Actual page URL at capture time (storage normalises the fragment away). */
  url: string;
  title: string;
  favicon?: string;
  description?: string;
  siteName?: string;
  canonicalUrl?: string;
  lang?: string;
  snapshot: PageSnapshot;
}

/** Error shown by the background worker when a page cannot be captured. */
export class CaptureError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CaptureError";
  }
}

/** Internal helper: is this a plain object we can inspect safely? */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate the result coming back from an injected page script. */
function isCapturedPage(value: unknown): value is CapturedPage {
  if (!isRecord(value)) {
    return false;
  }

  const optionalStrings = [
    value.favicon,
    value.description,
    value.siteName,
    value.canonicalUrl,
    value.lang,
  ];

  return (
    typeof value.url === "string" &&
    typeof value.title === "string" &&
    optionalStrings.every((item) => item === undefined || typeof item === "string") &&
    isPageSnapshot(value.snapshot)
  );
}

/**
 * Read the current page and return its saveable data.
 *
 * This function is injected into the page, so it must not reference anything
 * from this module. `limits` is passed explicitly for that reason. The `doc`
 * and `href` parameters exist only so tests can supply a jsdom document and a
 * fixed URL; in the browser they default to the page's own globals.
 *
 * @param limits text/JSON-LD caps
 * @param doc document to read, defaults to the page's `document`
 * @param href page URL, defaults to `window.location.href`
 * @returns metadata plus the bounded content snapshot
 */
export function collectPageData(
  limits: CaptureLimits,
  doc: Document = document,
  href: string = window.location.href,
): CapturedPage {
  // ── Small helpers, defined inside the injected function ──────────────────
  // They may close over `doc`, which is fine because these functions are
  // created inside the page at call time. Moving them outside this function
  // would break injection (their module scope would not exist in the page).
  function normaliseWhitespace(value: string): string {
    return value.replace(/\s+/g, " ").trim();
  }

  function firstMeta(selectors: string[]): string | undefined {
    for (const selector of selectors) {
      const content = doc.querySelector<HTMLMetaElement>(selector)?.content;
      const normalised = content ? normaliseWhitespace(content) : "";
      if (normalised) {
        return normalised;
      }
    }
    return undefined;
  }

  function absoluteUrl(value: string | undefined): string | undefined {
    if (!value) {
      return undefined;
    }
    try {
      // Use the real page URL as the base instead of `doc.baseURI`: jsdom
      // reports its own localhost URL, and `<base>` is rare enough that the
      // predictable behaviour is more valuable here.
      const url = new URL(value, href);
      // Data/blob URLs can be huge or only valid in the current tab. A broken
      // favicon is better than bloating the pocket record.
      if (url.protocol === "data:" || url.protocol === "blob:") {
        return undefined;
      }
      return url.href;
    } catch {
      return undefined;
    }
  }

  function cut(value: string, maxLength: number): string {
    return value.length > maxLength ? value.slice(0, maxLength) : value;
  }

  // ── Metadata ─────────────────────────────────────────────────────────────
  const ogTitle = firstMeta(['meta[property="og:title"]']);
  const heading = doc.querySelector<HTMLHeadingElement>("h1")?.textContent;
  const title = cut(
    normaliseWhitespace(doc.title) ||
      normaliseWhitespace(ogTitle ?? "") ||
      normaliseWhitespace(heading ?? "") ||
      href,
    500,
  );

  // `link[rel~="icon"]` also matches rel="shortcut icon"; apple-touch-icon is
  // a common higher-resolution fallback on sites without a normal icon link.
  const iconHref =
    doc.querySelector<HTMLLinkElement>('link[rel~="icon"]')?.getAttribute("href") ??
    doc.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]')?.getAttribute("href") ??
    undefined;

  const canonicalHref =
    doc.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.getAttribute("href") ?? undefined;

  // Resolve once so the returned object does not call absoluteUrl twice for
  // the same value (and so TypeScript keeps the `string | undefined` type).
  const favicon = absoluteUrl(iconHref);
  const canonicalUrl = absoluteUrl(canonicalHref);

  const description = firstMeta(['meta[name="description"]', 'meta[property="og:description"]']);
  const siteName = firstMeta(['meta[property="og:site_name"]', 'meta[name="application-name"]']);
  const lang =
    doc.documentElement.lang.trim() ||
    firstMeta(['meta[http-equiv="content-language"]']) ||
    undefined;

  // ── JSON-LD ──────────────────────────────────────────────────────────────
  // Recipe sites usually expose schema.org/Recipe here. We keep parsed values,
  // not raw strings, so M3 can inspect them without parsing again. Invalid
  // blocks are skipped: one broken third-party script should not prevent the
  // user from saving the page.
  const jsonLd: unknown[] = [];
  let jsonLdChars = 0;
  let jsonLdTruncated = false;

  for (const script of Array.from(
    doc.querySelectorAll<HTMLScriptElement>('script[type="application/ld+json"]'),
  )) {
    const raw = script.textContent?.trim() ?? "";
    if (!raw) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }

    const serialisedLength = JSON.stringify(parsed).length;
    if (jsonLdChars + serialisedLength > limits.maxJsonLdChars) {
      // Skip the whole block: a truncated JSON string would be invalid JSON.
      jsonLdTruncated = true;
      continue;
    }

    jsonLd.push(parsed);
    jsonLdChars += serialisedLength;
  }

  // ── Visible text ─────────────────────────────────────────────────────────
  // Clone first so removing noise does not mutate the page the user is reading.
  const clone = doc.body?.cloneNode(true) as HTMLElement | null;
  if (clone) {
    const noiseSelectors = [
      "script",
      "style",
      "noscript",
      "template",
      "svg",
      "canvas",
      "iframe",
      "nav",
      "footer",
      "aside",
      "form",
    ];
    for (const selector of noiseSelectors) {
      for (const element of Array.from(clone.querySelectorAll(selector))) {
        element.remove();
      }
    }
  }

  // A detached clone is "not rendered", so browsers return `textContent` from
  // `innerText` anyway. That is acceptable: we already removed the noisy
  // elements above. The nullish fallback also covers jsdom/older DOMs.
  const rawText = clone ? ((clone.innerText ?? clone.textContent) as string) : "";
  const cleanedText = normaliseWhitespace(rawText);
  const textTruncated = cleanedText.length > limits.maxTextChars;

  return {
    url: href,
    title,
    ...(favicon !== undefined ? { favicon } : {}),
    ...(description !== undefined ? { description: cut(description, 500) } : {}),
    ...(siteName !== undefined ? { siteName: cut(siteName, 200) } : {}),
    ...(canonicalUrl !== undefined ? { canonicalUrl } : {}),
    ...(lang !== undefined ? { lang: cut(normaliseWhitespace(lang), 35) } : {}),
    snapshot: {
      jsonLd,
      text: textTruncated ? cleanedText.slice(0, limits.maxTextChars) : cleanedText,
      capturedAt: new Date().toISOString(),
      truncated: jsonLdTruncated || textTruncated,
    },
  };
}

/** Shape of one result returned by `browser.scripting.executeScript`. */
interface InjectionResult {
  result?: unknown;
}

/** The subset of `executeScript` we use; injectable for tests. */
type ExecuteScript = (injection: {
  target: { tabId: number };
  func: typeof collectPageData;
  args: [CaptureLimits];
}) => Promise<InjectionResult[]>;

/**
 * Capture a tab using a one-off injected function.
 *
 * The default `executeScript` comes from WXT's cross-browser `browser` object,
 * so the same code works in Chrome and Firefox. Tests pass a fake executor.
 *
 * @param tabId tab that the context-menu click belongs to
 * @param executeScript optional executor override for tests
 * @returns validated capture data
 * @throws CaptureError for restricted pages (chrome://, add-on pages), missing
 *   results, or a result that does not match our expected shape
 */
export async function capturePage(
  tabId: number,
  executeScript: ExecuteScript = browser.scripting.executeScript,
): Promise<CapturedPage> {
  let results: InjectionResult[];
  try {
    results = await executeScript({
      target: { tabId },
      func: collectPageData,
      args: [CAPTURE_LIMITS],
    });
  } catch (error) {
    throw new CaptureError(
      "Could not read this page. Browsers block extensions on internal pages such as chrome:// settings.",
      { cause: error },
    );
  }

  const captured = results[0]?.result;
  if (captured === undefined) {
    throw new CaptureError("The page returned no data to save.");
  }
  if (!isCapturedPage(captured)) {
    throw new CaptureError("The page returned data in an unexpected format.");
  }
  return captured;
}
