/**
 * Start page of the Pocket web app.
 *
 * Reads the backend health endpoint once and shows the result. This proves
 * the web app → backend connection works; real page lists follow later.
 */
import { CATEGORIES, CATEGORY_LABELS } from "@project-pocket/shared";
import { useEffect, useState } from "react";
import { fetchHealth, type HealthResponse } from "./api";

/** UI state: while loading / after success / after a failure. */
type HealthState =
  | { status: "loading" }
  | { status: "ok"; data: HealthResponse }
  | { status: "error"; message: string };

export default function App() {
  const [health, setHealth] = useState<HealthState>({ status: "loading" });
  // Incrementing this value re-runs the effect, i.e. the Retry button.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    // Abort the request if the component unmounts (e.g. fast navigation) so
    // we never call setState on a component that is no longer mounted.
    const controller = new AbortController();

    fetchHealth(controller.signal)
      .then((data) => setHealth({ status: "ok", data }))
      .catch((error: unknown) => {
        // Aborts are expected on unmount and must not be shown as errors.
        if (controller.signal.aborted) return;
        setHealth({
          status: "error",
          message: error instanceof Error ? error.message : "Unknown error",
        });
      });

    return () => controller.abort();
  }, [attempt]);

  /** Start a fresh request and show the loading state immediately. */
  function retry() {
    setHealth({ status: "loading" });
    setAttempt((value) => value + 1);
  }

  return (
    <div className="page">
      <header className="hero">
        <p className="eyebrow">Project Pocket</p>
        <h1>Everything important, in one pocket.</h1>
        <p className="lead">
          This is the scaffold of the Pocket web app. Saving, syncing and extracting pages comes in
          the next milestones.
        </p>
      </header>

      <main>
        <section className="card" aria-live="polite">
          <h2>Backend connection</h2>
          {health.status === "loading" && <p className="muted">Checking backend…</p>}

          {health.status === "ok" && (
            <p className="ok">
              Backend is healthy — version <strong>{health.data.version}</strong>.
            </p>
          )}

          {health.status === "error" && (
            <>
              <p className="error">Could not reach the backend: {health.message}</p>
              <button type="button" onClick={retry}>
                Retry
              </button>
            </>
          )}
        </section>

        <section className="card">
          <h2>Planned categories</h2>
          <ul className="chips">
            {CATEGORIES.map((category) => (
              <li key={category}>{CATEGORY_LABELS[category]}</li>
            ))}
          </ul>
          <p className="muted">Shared with the browser extension via @project-pocket/shared.</p>
        </section>
      </main>

      <footer className="muted">
        Scaffold · M0 · Chrome &amp; Firefox extension · FastAPI backend
      </footer>
    </div>
  );
}
