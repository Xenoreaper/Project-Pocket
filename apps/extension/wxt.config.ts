// WXT configuration for the Project Pocket browser extension.
//
// WXT compiles the files in `entrypoints/` into a real extension for Chrome
// and Firefox, generating the right manifest for each browser. We never edit
// manifest.json by hand.
import { defineConfig } from "wxt";

export default defineConfig({
  // The React module teaches WXT how to compile .tsx files and inject React.
  modules: ["@wxt-dev/module-react"],

  // Force Manifest V3 for both browsers. WXT would use MV2 for Firefox by
  // default; AGENTS.md requires MV3 on Chrome AND Firefox, so we pin it here.
  manifestVersion: 3,

  manifest: ({ browser }) => ({
    name: "Project Pocket",
    description: "Everything important from any page, in one pocket.",
    version: "0.1.0",
    // No permissions yet: the scaffold popup only displays text. Permissions
    // (storage, contextMenus, host access) are added together with the save
    // feature so we never request more access than we use.
    permissions: [],

    // Firefox-specific metadata. WXT injects this key only into the Firefox
    // manifest; Chrome would otherwise warn about an unknown key.
    // - a stable add-on id is required for Manifest V3,
    // - "none" declares that this extension collects no user data (Firefox
    //   requires this declaration for new extensions since late 2025).
    ...(browser === "firefox"
      ? {
          browser_specific_settings: {
            gecko: {
              id: "project-pocket@hs-esslingen.example",
              data_collection_permissions: {
                required: ["none"],
              },
            },
          },
        }
      : {}),
  }),
});
