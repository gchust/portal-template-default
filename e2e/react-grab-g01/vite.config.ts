import fs from "node:fs";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

import { portalStudioPlugin } from "../../src/studio/vite";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const registryRoot = fileURLToPath(new URL("../../registry", import.meta.url));
const extensionsRoot = fs.existsSync(registryRoot)
  ? registryRoot
  : fileURLToPath(new URL("../../src/extensions", import.meta.url));

export default defineConfig({
  root: repositoryRoot,
  plugins: [
    react(),
    // Goal 06: the fixture runs the REAL Studio toolbar end to end — the
    // dev-only middleware serves the local task/screenshot endpoints so
    // Pick → save → Marker → reload-rehydrate flows persist like the portal.
    portalStudioPlugin({
      root: fileURLToPath(new URL("../../", import.meta.url)),
    }),
  ],
  resolve: {
    alias: {
      "@/extensions": extensionsRoot,
      "@": fileURLToPath(new URL("../../src", import.meta.url)),
    },
  },
});
