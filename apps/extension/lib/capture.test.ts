/**
 * Tests for page capture.
 *
 * `collectPageData` is the function that will be injected into a real page.
 * Here it runs against jsdom, which lets us build small HTML documents and
 * assert exactly which metadata/text leaves the page.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CAPTURE_LIMITS,
  CaptureError,
  capturePage,
  collectPageData,
  type CapturedPage,
} from "./capture";

/** Add a `<meta>` tag to the simulated page head. */
function appendMeta(attribute: "name" | "property", key: string, content: string): void {
  const meta = document.createElement("meta");
  meta.setAttribute(attribute, key);
  meta.content = content;
  document.head.append(meta);
}

/** Add a link tag (favicon/canonical) to the simulated page head. */
function appendLink(rel: string, href: string): void {
  const link = document.createElement("link");
  link.rel = rel;
  link.setAttribute("href", href);
  document.head.append(link);
}

/** Add a JSON-LD script tag, serialising the value the way sites do. */
function appendJsonLd(value: unknown): void {
  const script = document.createElement("script");
  script.type = "application/ld+json";
  script.textContent = JSON.stringify(value);
  document.head.append(script);
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  document.title = "";
  document.documentElement.lang = "";
});

describe("collectPageData", () => {
  it("reads metadata, resolves relative URLs, parses JSON-LD and cleans text", () => {
    document.title = "  Test   soup  ";
    document.documentElement.lang = "en";
    appendLink("icon", "/icon.png");
    appendLink("canonical", "/recipe/test-soup");
    appendLink("apple-touch-icon", "/large-icon.png");
    appendMeta("name", "description", "  A   simple soup  ");
    appendMeta("property", "og:site_name", "Example Kitchen");
    appendJsonLd({ "@type": "Recipe", name: "Test soup" });
    document.body.innerHTML = `
      <nav>Site navigation</nav>
      <article>
        <h1>Test soup</h1>
        <p>Ingredients and instructions.</p>
        <script>window.secret = true;</script>
        <style>.hidden { display: none; }</style>
      </article>
      <footer>Footer noise</footer>
    `;

    const captured = collectPageData(CAPTURE_LIMITS, document, "https://example.com/recipe?x=1");

    expect(captured.url).toBe("https://example.com/recipe?x=1");
    expect(captured.title).toBe("Test soup");
    expect(captured.favicon).toBe("https://example.com/icon.png");
    expect(captured.canonicalUrl).toBe("https://example.com/recipe/test-soup");
    expect(captured.description).toBe("A simple soup");
    expect(captured.siteName).toBe("Example Kitchen");
    expect(captured.lang).toBe("en");
    expect(captured.snapshot.jsonLd).toEqual([{ "@type": "Recipe", name: "Test soup" }]);
    expect(captured.snapshot.text).toContain("Ingredients and instructions.");
    expect(captured.snapshot.text).toContain("Test soup");
    expect(captured.snapshot.text).not.toContain("Site navigation");
    expect(captured.snapshot.text).not.toContain("Footer noise");
    expect(captured.snapshot.text).not.toContain("window.secret");
    expect(captured.snapshot.truncated).toBe(false);
    expect(Number.isNaN(Date.parse(captured.snapshot.capturedAt))).toBe(false);
  });

  it("falls back to og:title, then h1, then the URL", () => {
    appendMeta("property", "og:title", "  Social title ");
    document.body.innerHTML = "<h1>Heading title</h1>";

    const captured = collectPageData(CAPTURE_LIMITS, document, "https://example.com/page");
    expect(captured.title).toBe("Social title");

    document.head.innerHTML = "";
    document.body.innerHTML = "<h1>Heading title</h1>";
    expect(collectPageData(CAPTURE_LIMITS, document, "https://example.com/page").title).toBe(
      "Heading title",
    );

    document.body.innerHTML = "";
    expect(collectPageData(CAPTURE_LIMITS, document, "https://example.com/page").title).toBe(
      "https://example.com/page",
    );
  });

  it("reads a language fallback from meta and omits unsafe favicon URLs", () => {
    document.documentElement.lang = "";
    const language = document.createElement("meta");
    language.httpEquiv = "content-language";
    language.content = "de-DE";
    document.head.append(language);
    appendLink("icon", "data:image/png;base64,AAAA");

    const captured = collectPageData(CAPTURE_LIMITS, document, "https://example.com/page");

    expect(captured.lang).toBe("de-DE");
    expect(captured.favicon).toBeUndefined();
  });

  it("skips invalid JSON-LD blocks but keeps valid ones", () => {
    const broken = document.createElement("script");
    broken.type = "application/ld+json";
    broken.textContent = "{not valid json";
    document.head.append(broken);
    appendJsonLd({ "@type": "Article", headline: "Valid" });

    const captured = collectPageData(CAPTURE_LIMITS, document, "https://example.com/page");

    expect(captured.snapshot.jsonLd).toEqual([{ "@type": "Article", headline: "Valid" }]);
    expect(captured.snapshot.truncated).toBe(false);
  });

  it("caps visible text and marks the snapshot as truncated", () => {
    document.body.textContent = "abcdefghijklmnopqrstuvwxyz";

    const captured = collectPageData(
      { maxTextChars: 10, maxJsonLdChars: 100 },
      document,
      "https://example.com/page",
    );

    expect(captured.snapshot.text).toBe("abcdefghij");
    expect(captured.snapshot.truncated).toBe(true);
  });

  it("caps JSON-LD by skipping whole blocks", () => {
    appendJsonLd({ "@type": "Recipe", long: "x".repeat(100) });

    const captured = collectPageData(
      { maxTextChars: 100, maxJsonLdChars: 20 },
      document,
      "https://example.com/page",
    );

    expect(captured.snapshot.jsonLd).toEqual([]);
    expect(captured.snapshot.truncated).toBe(true);
  });
});

describe("capturePage", () => {
  /** Minimal valid result for executor tests. */
  function makeCapturedPage(): CapturedPage {
    return {
      url: "https://example.com/page",
      title: "Page",
      snapshot: {
        jsonLd: [],
        text: "Content",
        capturedAt: "2026-10-22T10:00:00.000Z",
        truncated: false,
      },
    };
  }

  it("passes the tab and injects the self-contained collector", async () => {
    const expected = makeCapturedPage();
    const executeScript = vi.fn().mockResolvedValue([{ result: expected }]);

    const captured = await capturePage(7, executeScript as never);

    expect(captured).toEqual(expected);
    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 7 },
      func: collectPageData,
      args: [CAPTURE_LIMITS],
    });
  });

  it("reports restricted pages with a useful message", async () => {
    const executeScript = vi.fn().mockRejectedValue(new Error("cannot inject"));

    await expect(capturePage(7, executeScript as never)).rejects.toThrow(CaptureError);
    await expect(capturePage(7, executeScript as never)).rejects.toThrow(/internal pages/i);
  });

  it("rejects a missing or malformed injection result", async () => {
    const missing = vi.fn().mockResolvedValue([{ result: undefined }]);
    const malformed = vi.fn().mockResolvedValue([{ result: { title: "No snapshot" } }]);

    await expect(capturePage(7, missing as never)).rejects.toThrow(/no data/i);
    await expect(capturePage(7, malformed as never)).rejects.toThrow(/unexpected format/i);
  });
});
