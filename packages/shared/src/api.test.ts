/**
 * Tests for the API contract helpers.
 *
 * The example responses are copied from the JSON the backend really returns
 * (see `backend/tests/test_items.py`), so a test breaks if the shapes drift.
 */
import { describe, expect, it } from "vitest";
import {
  apiErrorMessage,
  isAuthConfig,
  isItemListResponse,
  isLoginResponse,
  isSyncedItem,
  toSyncPayload,
  type SyncedItem,
} from "./api";
import type { SavedPage } from "./index";

/** A complete page with all optional fields, as stored by the extension. */
function makeSavedPage(overrides: Partial<SavedPage> = {}): SavedPage {
  return {
    id: "local-id",
    url: "https://example.com/soup",
    title: "Soup",
    favicon: "https://example.com/favicon.ico",
    description: "A soup",
    siteName: "Example",
    canonicalUrl: "https://example.com/soup",
    lang: "en",
    category: "recipes",
    tags: ["quick"],
    note: "Try this",
    savedAt: "2026-11-01T10:00:00.000Z",
    updatedAt: "2026-11-02T10:00:00.000Z",
    snapshot: {
      jsonLd: [{ "@type": "Recipe" }],
      text: "Boil water.",
      capturedAt: "2026-11-01T10:00:00.000Z",
      truncated: false,
    },
    sync: { status: "pending" },
    ...overrides,
  };
}

/** An item exactly as `GET /api/items` returns it. */
function makeSyncedItem(overrides: Partial<SyncedItem> = {}): SyncedItem {
  return {
    id: "e7d644a4-c465-4dad-9d30-be5c68b80156",
    url: "https://example.com/soup",
    title: "Soup",
    favicon: null,
    description: null,
    siteName: null,
    canonicalUrl: null,
    lang: null,
    category: "recipes",
    categoryLabel: "Recipes",
    tags: [],
    note: "",
    savedAt: "2026-11-11T10:00:00Z",
    updatedAt: "2026-11-11T10:00:00Z",
    syncedAt: "2026-11-11T15:21:22.226698Z",
    ...overrides,
  };
}

describe("toSyncPayload", () => {
  it("copies the page and adds the category label", () => {
    const payload = toSyncPayload(makeSavedPage(), "Recipes");

    expect(payload.categoryLabel).toBe("Recipes");
    expect(payload.siteName).toBe("Example");
    expect(payload.updatedAt).toBe("2026-11-02T10:00:00.000Z");
  });

  it("leaves out the fields that only exist locally", () => {
    const payload = toSyncPayload(makeSavedPage(), "Recipes");

    expect(payload).not.toHaveProperty("id");
    expect(payload).not.toHaveProperty("sync");
  });

  it("omits missing optional fields instead of sending undefined", () => {
    const { favicon: _favicon, lang: _lang, ...withoutOptional } = makeSavedPage();

    const payload = toSyncPayload(withoutOptional, "Recipes");

    expect(Object.keys(payload)).not.toContain("favicon");
    expect(Object.keys(payload)).not.toContain("lang");
  });
});

describe("isSyncedItem / isItemListResponse", () => {
  it("accepts a real server response", () => {
    expect(isItemListResponse({ items: [makeSyncedItem()], total: 1 })).toBe(true);
  });

  it("accepts strings in the optional fields", () => {
    expect(isSyncedItem(makeSyncedItem({ siteName: "Example" }))).toBe(true);
  });

  it("rejects an unknown category", () => {
    expect(isSyncedItem({ ...makeSyncedItem(), category: "unknown" })).toBe(false);
  });

  it("rejects a list containing one broken item", () => {
    const broken = { ...makeSyncedItem(), tags: "quick" };

    expect(isItemListResponse({ items: [makeSyncedItem(), broken], total: 2 })).toBe(false);
  });

  it("rejects a missing total", () => {
    expect(isItemListResponse({ items: [] })).toBe(false);
  });
});

describe("isAuthConfig / isLoginResponse", () => {
  it("accepts a server without Keycloak", () => {
    expect(isAuthConfig({ registrationEnabled: true, oidc: null })).toBe(true);
  });

  it("accepts a server with Keycloak", () => {
    const config = {
      registrationEnabled: false,
      oidc: { issuer: "http://localhost:8080/realms/pocket", clientId: "project-pocket" },
    };

    expect(isAuthConfig(config)).toBe(true);
  });

  it("rejects an incomplete Keycloak block", () => {
    expect(isAuthConfig({ registrationEnabled: true, oidc: { issuer: "x" } })).toBe(false);
  });

  it("accepts a login response and rejects one without user", () => {
    const login = {
      token: "pkt_abc",
      expiresAt: "2026-12-11T10:00:00Z",
      user: { id: "u1", displayName: "anna" },
    };

    expect(isLoginResponse(login)).toBe(true);
    expect(isLoginResponse({ ...login, user: null })).toBe(false);
  });
});

describe("apiErrorMessage", () => {
  it("uses the backend's own message", () => {
    expect(apiErrorMessage(409, { detail: "This username is taken." })).toBe(
      "This username is taken.",
    );
  });

  it("summarises a validation error", () => {
    const body = { detail: [{ msg: "String should have at least 8 characters" }] };

    expect(apiErrorMessage(422, body)).toBe(
      "Invalid input: String should have at least 8 characters",
    );
  });

  it("falls back to the status code", () => {
    expect(apiErrorMessage(502, undefined)).toBe("The server answered with HTTP 502.");
  });
});
