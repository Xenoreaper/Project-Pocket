/**
 * Popup component test.
 *
 * We render the component like a browser would and assert on what the user
 * sees, not on implementation details. This is the only extension test in the
 * scaffold; it also proves that @project-pocket/shared resolves correctly.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("popup App", () => {
  it("renders the app title and the shared categories", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: /project pocket/i })).toBeInTheDocument();
    expect(screen.getByText("Recipes")).toBeInTheDocument();
    expect(screen.getByText("DIY Projects")).toBeInTheDocument();
    expect(screen.getByText("Lyrics")).toBeInTheDocument();
  });
});
