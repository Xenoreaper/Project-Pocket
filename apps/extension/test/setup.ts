/**
 * Vitest setup for the extension tests.
 *
 * `@testing-library/jest-dom` adds matchers such as `toBeInTheDocument()` to
 * Vitest's `expect`. WXT's Vitest plugin installs `@webext-core/fake-browser`
 * as the global `browser`, so we only need to reset its in-memory state
 * between tests and clean up rendered React trees.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

beforeEach(() => {
  // Clear storage, event listeners and fake tab/window state so tests cannot
  // leak data into each other.
  fakeBrowser.reset();
});

afterEach(() => {
  // Testing Library normally registers this automatically, but being explicit
  // makes the cleanup order visible: unmount components before the next reset.
  cleanup();
});
