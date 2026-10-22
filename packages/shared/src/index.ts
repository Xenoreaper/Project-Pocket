/**
 * Shared types for Project Pocket.
 *
 * This file is the single place where the extension and the web app agree on
 * data shapes. For now it only contains the category of a saved item; later
 * the `SavedItem` / `Recipe` types will live here too.
 */

/**
 * The project types the app knows about.
 *
 * `as const` makes TypeScript treat this as a tuple of literal strings
 * ("recipes" | "diy" | "lyrics") instead of a generic string[], which lets us
 * derive the `Category` union below from it. Adding a category here therefore
 * updates the type, the UI lists and the runtime validation at once.
 */
export const CATEGORIES = ["recipes", "diy", "lyrics"] as const;

/** A valid category, e.g. "recipes". Derived from {@link CATEGORIES}. */
export type Category = (typeof CATEGORIES)[number];

/**
 * Type guard that checks whether an unknown value (e.g. parsed JSON or a
 * value from extension storage) is a known category.
 *
 * @param value any value to check
 * @returns `true` if `value` is one of {@link CATEGORIES}
 */
export function isCategory(value: unknown): value is Category {
  // `includes` needs a string argument; comparing the narrowed type via
  // `CATEGORIES.some` keeps TypeScript happy without a cast.
  return typeof value === "string" && CATEGORIES.some((category) => category === value);
}

/**
 * Human-readable labels for the categories, used by both UIs.
 * Keeping them next to the union avoids two divergent label lists.
 */
export const CATEGORY_LABELS: Record<Category, string> = {
  recipes: "Recipes",
  diy: "DIY Projects",
  lyrics: "Lyrics",
};
