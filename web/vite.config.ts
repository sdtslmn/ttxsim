import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  // Relative paths, so the build works at https://<user>.github.io/ttxsim/ and anywhere else.
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: { port: 5173 },
});
