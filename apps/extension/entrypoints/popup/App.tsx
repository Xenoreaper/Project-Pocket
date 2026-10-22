/**
 * The extension popup.
 *
 * Scaffold version: only proves that the React setup and the shared package
 * work. Saving the current page is the next milestone (see docs/PROGRESS.md).
 */
import { CATEGORIES, CATEGORY_LABELS } from "@project-pocket/shared";

export default function App() {
  return (
    <main className="popup">
      <h1>Project Pocket — hello</h1>
      <p className="subtitle">Everything important from any page, in one pocket.</p>

      <p className="label">Planned categories</p>
      <ul className="categories">
        {CATEGORIES.map((category) => (
          <li key={category}>{CATEGORY_LABELS[category]}</li>
        ))}
      </ul>

      <p className="status">Scaffold · saving pages comes next</p>
    </main>
  );
}
