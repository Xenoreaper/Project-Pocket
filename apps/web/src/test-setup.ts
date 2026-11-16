/**
 * Test setup, run by Vitest before every test file (see vitest.config.ts).
 *
 * - Registers the extra DOM matchers (`toBeInTheDocument`, …) that Testing
 *   Library's jest-dom package adds to Vitest's `expect`.
 * - Removes rendered components after each test. Without it, a second test
 *   still sees the first test's page, for example two "Retry" buttons.
 */
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
