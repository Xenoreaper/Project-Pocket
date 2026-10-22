/**
 * Background script ("service worker" in MV3).
 *
 * It is intentionally empty for now. The next session will register the
 * right-click context menu and save pages locally; keeping the entrypoint
 * here already makes both browser builds valid extensions.
 */
export default defineBackground(() => {
  // No behaviour yet. `defineBackground` is auto-imported by WXT.
});
