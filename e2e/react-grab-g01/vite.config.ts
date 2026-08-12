import fs from "node:fs";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const registryRoot = fileURLToPath(new URL("../../registry", import.meta.url));
const extensionsRoot = fs.existsSync(registryRoot)
  ? registryRoot
  : fileURLToPath(new URL("../../src/extensions", import.meta.url));

export default defineConfig({
  root: repositoryRoot,
  plugins: [react()],
  resolve: {
    alias: {
      "@/extensions": extensionsRoot,
      "@": fileURLToPath(new URL("../../src", import.meta.url)),
    },
  },
});
