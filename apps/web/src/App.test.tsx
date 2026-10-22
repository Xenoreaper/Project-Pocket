/**
 * Start-page tests.
 *
 * We replace the global `fetch` with a fake so the tests never touch the
 * network (AGENTS.md: no network in unit tests). Each test checks a state the
 * user can actually see.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

/** Build a minimal fake Response-like object for fetchHealth. */
function mockFetch(status: number, body: unknown) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  // Undo vi.stubGlobal so tests cannot leak the fake fetch into each other.
  vi.unstubAllGlobals();
});

describe("App", () => {
  it("shows the backend health result", async () => {
    const fetchMock = mockFetch(200, { status: "ok", version: "0.1.0" });

    render(<App />);

    expect(await screen.findByText(/backend is healthy/i)).toBeInTheDocument();
    expect(screen.getByText("0.1.0")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/health", expect.any(Object));
  });

  it("shows an error and a retry button when the backend is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));

    render(<App />);

    expect(await screen.findByText(/could not reach the backend/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
