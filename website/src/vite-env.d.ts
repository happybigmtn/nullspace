/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_CHAIN_URL: string;
  readonly VITE_IDENTITY: string;
  // Add other env variables as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
