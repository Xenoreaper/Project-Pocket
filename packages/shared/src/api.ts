/**
 * The REST API contract between the clients and the backend.
 *
 * The backend owns the contract (see `backend/app/api/*.py` and the generated
 * docs at `/docs`). This file mirrors the JSON shapes in TypeScript, so the
 * extension and the web app use the same names and cannot drift apart.
 *
 * Responses come from the network, so they are untrusted at runtime: the `is…`
 * guards check a response before a client relies on it, the same way
 * `isSavedPage` checks data read back from extension storage.
 *
 * Import from `@project-pocket/shared/api`. This is a separate entry point
 * because this file builds on the main module, and re-exporting it from there
 * would create a circular import.
 */
import { isCategoryId, type CategoryId, type PageSnapshot, type SavedPage } from "./index";

/** Paths of the backend endpoints, relative to the server's base URL. */
export const API_ROUTES = {
  authConfig: "/api/auth/config",
  register: "/api/auth/register",
  login: "/api/auth/login",
  logout: "/api/auth/logout",
  me: "/api/auth/me",
  items: "/api/items",
} as const;

/** Prefix of tokens from a local login. Keycloak tokens are JWTs without it. */
export const LOCAL_TOKEN_PREFIX = "pkt_";

/** What a client needs to start a Keycloak login (`GET /api/auth/config`). */
export interface OidcConfig {
  issuer: string;
  clientId: string;
}

/** The login options a server offers. `oidc` is null without Keycloak. */
export interface AuthConfig {
  registrationEnabled: boolean;
  oidc: OidcConfig | null;
}

/** Body of `POST /api/auth/register` and `POST /api/auth/login`. */
export interface Credentials {
  username: string;
  password: string;
}

/** Public view of a user (`GET /api/auth/me`). */
export interface ApiUser {
  id: string;
  displayName: string;
}

/** Response of `POST /api/auth/login`; `token` goes into `Authorization: Bearer`. */
export interface LoginResponse {
  token: string;
  /** ISO-8601 UTC timestamp. */
  expiresAt: string;
  user: ApiUser;
}

/**
 * Body of `POST /api/items`: one page from the extension.
 *
 * It is a `SavedPage` without the local-only fields (`id`, `sync`) plus the
 * category label, because the server does not know custom categories. Optional
 * fields are left out instead of being sent as null.
 */
export interface SyncItemPayload {
  url: string;
  title: string;
  favicon?: string;
  description?: string;
  siteName?: string;
  canonicalUrl?: string;
  lang?: string;
  category: CategoryId;
  categoryLabel: string;
  tags: string[];
  note: string;
  snapshot: PageSnapshot;
  savedAt: string;
  updatedAt: string;
}

/**
 * An item as the server returns it. The snapshot is left out to keep lists
 * small, and absent optional fields arrive as null.
 */
export interface SyncedItem {
  id: string;
  url: string;
  title: string;
  favicon: string | null;
  description: string | null;
  siteName: string | null;
  canonicalUrl: string | null;
  lang: string | null;
  category: CategoryId;
  categoryLabel: string;
  tags: string[];
  note: string;
  savedAt: string;
  updatedAt: string;
  /** When the server last accepted a newer version of this item. */
  syncedAt: string;
}

/** Response of `GET /api/items`: one page of results plus the total count. */
export interface ItemListResponse {
  items: SyncedItem[];
  total: number;
}

/** Is this a plain object whose properties can be read safely? */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Is this a string or null, the shape of an optional field in a response? */
function isNullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

/**
 * Build the upload for one saved page.
 *
 * @param page the page from extension storage
 * @param categoryLabel display name of the page's category (see `getCategoryLabel`)
 * @returns the request body for `POST /api/items`
 */
export function toSyncPayload(page: SavedPage, categoryLabel: string): SyncItemPayload {
  const payload: SyncItemPayload = {
    url: page.url,
    title: page.title,
    category: page.category,
    categoryLabel,
    tags: page.tags,
    note: page.note,
    snapshot: page.snapshot,
    savedAt: page.savedAt,
    updatedAt: page.updatedAt,
  };
  // Copy optional fields only if present, so the JSON contains no undefined.
  if (page.favicon !== undefined) payload.favicon = page.favicon;
  if (page.description !== undefined) payload.description = page.description;
  if (page.siteName !== undefined) payload.siteName = page.siteName;
  if (page.canonicalUrl !== undefined) payload.canonicalUrl = page.canonicalUrl;
  if (page.lang !== undefined) payload.lang = page.lang;
  return payload;
}

/** Type guard for `GET /api/auth/config`. */
export function isAuthConfig(value: unknown): value is AuthConfig {
  if (!isRecord(value) || typeof value.registrationEnabled !== "boolean") {
    return false;
  }
  return (
    value.oidc === null ||
    (isRecord(value.oidc) &&
      typeof value.oidc.issuer === "string" &&
      typeof value.oidc.clientId === "string")
  );
}

/** Type guard for a user object. */
export function isApiUser(value: unknown): value is ApiUser {
  return isRecord(value) && typeof value.id === "string" && typeof value.displayName === "string";
}

/** Type guard for `POST /api/auth/login`. */
export function isLoginResponse(value: unknown): value is LoginResponse {
  return (
    isRecord(value) &&
    typeof value.token === "string" &&
    typeof value.expiresAt === "string" &&
    isApiUser(value.user)
  );
}

/** Type guard for one item in a response. */
export function isSyncedItem(value: unknown): value is SyncedItem {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.url === "string" &&
    typeof value.title === "string" &&
    isNullableString(value.favicon) &&
    isNullableString(value.description) &&
    isNullableString(value.siteName) &&
    isNullableString(value.canonicalUrl) &&
    isNullableString(value.lang) &&
    isCategoryId(value.category) &&
    typeof value.categoryLabel === "string" &&
    Array.isArray(value.tags) &&
    value.tags.every((tag) => typeof tag === "string") &&
    typeof value.note === "string" &&
    typeof value.savedAt === "string" &&
    typeof value.updatedAt === "string" &&
    typeof value.syncedAt === "string"
  );
}

/** Type guard for `GET /api/items`. */
export function isItemListResponse(value: unknown): value is ItemListResponse {
  return (
    isRecord(value) &&
    Array.isArray(value.items) &&
    value.items.every(isSyncedItem) &&
    typeof value.total === "number"
  );
}

/**
 * Turn an error response into a message for the user.
 *
 * FastAPI sends `{"detail": "..."}` for errors the backend raises, and a list of
 * problems in `detail` when a request fails validation (status 422).
 *
 * @param status HTTP status code
 * @param body parsed JSON body, or undefined if it was not JSON
 * @returns a readable message; never empty
 */
export function apiErrorMessage(status: number, body: unknown): string {
  if (isRecord(body)) {
    if (typeof body.detail === "string") {
      return body.detail;
    }
    const firstProblem: unknown = Array.isArray(body.detail) ? body.detail[0] : undefined;
    if (isRecord(firstProblem) && typeof firstProblem.msg === "string") {
      return `Invalid input: ${firstProblem.msg}`;
    }
  }
  return `The server answered with HTTP ${status}.`;
}
