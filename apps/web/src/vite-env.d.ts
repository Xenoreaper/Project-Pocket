// Vite exposes `import.meta.env.VITE_*` variables to client code. Declaring
// the shape here gives us autocompletion and type checking for our own vars.
/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional absolute backend URL. Empty means "same origin" (recommended). */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
