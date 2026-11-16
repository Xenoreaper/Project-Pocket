/**
 * Contract test, TypeScript side.
 *
 * `api-contract.json` is a snapshot of the backend's API: its endpoints and the
 * field names of every request and response. The backend tests that the file
 * matches the running API (`backend/tests/test_contract.py`); this file tests
 * that our TypeScript types match it. Together they catch any drift between
 * Python and TypeScript.
 *
 * TypeScript types do not exist at runtime, so a test cannot list their fields
 * directly. The `KeysOf` records below bridge that gap: the compiler rejects a
 * record that misses a field of the type or has an extra one (`make typecheck`),
 * and the test then compares the record's keys with the backend's field names.
 */
import { describe, expect, it } from "vitest";
import {
  API_ROUTES,
  type ApiUser,
  type AuthConfig,
  type Credentials,
  type ItemListResponse,
  type LoginResponse,
  type OidcConfig,
  type SyncItemPayload,
  type SyncedItem,
} from "./api";
import contract from "./api-contract.json";
import type { PageSnapshot } from "./index";

/** An object that must name every field of `T` exactly once. */
type KeysOf<T> = Record<keyof T, true>;

const authConfigKeys: KeysOf<AuthConfig> = {
  provider: true,
  registrationEnabled: true,
  oidc: true,
};
const oidcConfigKeys: KeysOf<OidcConfig> = { issuer: true, clientId: true };
const credentialsKeys: KeysOf<Credentials> = { username: true, password: true };
const apiUserKeys: KeysOf<ApiUser> = { id: true, displayName: true };
const loginResponseKeys: KeysOf<LoginResponse> = { token: true, expiresAt: true, user: true };
const itemListKeys: KeysOf<ItemListResponse> = { items: true, total: true };
const snapshotKeys: KeysOf<PageSnapshot> = {
  jsonLd: true,
  text: true,
  capturedAt: true,
  truncated: true,
};
const syncItemPayloadKeys: KeysOf<SyncItemPayload> = {
  url: true,
  title: true,
  favicon: true,
  description: true,
  siteName: true,
  canonicalUrl: true,
  lang: true,
  category: true,
  categoryLabel: true,
  tags: true,
  note: true,
  snapshot: true,
  savedAt: true,
  updatedAt: true,
};
const syncedItemKeys: KeysOf<SyncedItem> = {
  id: true,
  url: true,
  title: true,
  favicon: true,
  description: true,
  siteName: true,
  canonicalUrl: true,
  lang: true,
  category: true,
  categoryLabel: true,
  tags: true,
  note: true,
  savedAt: true,
  updatedAt: true,
  syncedAt: true,
};

/** Each TypeScript type with the backend schema it must mirror. */
const PAIRS: [typeName: string, keys: Record<string, true>, backendSchema: string][] = [
  ["AuthConfig", authConfigKeys, "AuthConfig"],
  ["OidcConfig", oidcConfigKeys, "OidcConfig"],
  ["Credentials (register)", credentialsKeys, "RegisterRequest"],
  ["Credentials (login)", credentialsKeys, "LoginRequest"],
  ["ApiUser", apiUserKeys, "UserResponse"],
  ["LoginResponse", loginResponseKeys, "LoginResponse"],
  ["SyncItemPayload", syncItemPayloadKeys, "ItemPayload"],
  ["PageSnapshot", snapshotKeys, "SnapshotPayload"],
  ["SyncedItem", syncedItemKeys, "ItemResponse"],
  ["ItemListResponse", itemListKeys, "ItemListResponse"],
];

/** The contract's schemas, typed loosely so a name can be looked up by string. */
const schemas: Record<string, { properties: string[]; required: string[] } | undefined> =
  contract.schemas;

describe("API contract", () => {
  // `it.each` runs the same test once per row and puts the type name in the title.
  it.each(PAIRS)("%s has the backend's fields", (_typeName, keys, backendSchema) => {
    const schema = schemas[backendSchema];

    expect(schema, `backend schema ${backendSchema} is missing`).toBeDefined();
    expect(Object.keys(keys).sort()).toEqual(schema?.properties);
  });

  it("covers every backend schema except the health response", () => {
    // The health response is only used by the web app's start page (apps/web/src/api.ts).
    const mirrored = new Set(PAIRS.map(([, , backendSchema]) => backendSchema));
    const unmirrored = Object.keys(contract.schemas).filter((name) => !mirrored.has(name));

    expect(unmirrored).toEqual(["HealthResponse"]);
  });

  it("knows exactly the backend's endpoints", () => {
    expect(Object.values(API_ROUTES).sort()).toEqual(Object.keys(contract.paths).sort());
  });
});
