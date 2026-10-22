/**
 * React entrypoint for the web app.
 * StrictMode adds development-only checks; it is stripped from production.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const container = document.getElementById("root");
if (!container) {
  throw new Error("index.html is missing the #root element.");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
