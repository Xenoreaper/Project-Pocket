/**
 * React entrypoint for the extension popup.
 *
 * `createRoot` is React 18+'s client renderer API. The non-null assertion is
 * avoided: if the HTML ever loses #root we want a clear error instead of a
 * silent blank popup.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./style.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("Popup HTML is missing the #root element.");
}

// StrictMode enables extra development checks; it has no effect in production.
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
