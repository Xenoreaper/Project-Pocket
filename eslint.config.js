// ESLint configuration for all TypeScript/React packages.
//
// ESLint 9+ uses the "flat config" format: one JavaScript file exporting an
// array of config objects. There is no .eslintrc anymore. Each object either
// adds a preset or narrows rules to a set of files.
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Generated folders and Python code are not JavaScript; skip them entirely.
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.output/**",
      "**/.wxt/**",
      "**/coverage/**",
      "backend/**",
    ],
  },

  // ESLint's own recommended JavaScript rules.
  js.configs.recommended,

  // Recommended TypeScript rules (parser + plugin configured by this preset).
  ...tseslint.configs.recommended,

  {
    // Browser code (React apps) plus Node code (Vite/Vitest/WXT config files).
    files: ["**/*.{ts,tsx,js}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // React Hooks rules: catches missing dependencies and illegal hook calls.
      ...reactHooks.configs.flat.recommended.rules,
      // Vite's fast-refresh only works when a module exports components.
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // Prefix intentionally unused function arguments with "_" instead of
      // disabling the rule for the whole line.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
