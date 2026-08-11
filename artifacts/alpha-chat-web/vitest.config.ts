import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic", // JSX senza `import React` (come il build vite con plugin-react)
  },
  test: {
    environment: "happy-dom",
    globals: false,
    include: [
      "src/tests/**/*.test.ts",
      "src/tests/**/*.test.tsx",
      "src/components/**/__tests__/**/*.test.tsx",
    ],
    setupFiles: ["src/tests/setup-dom.ts"],
    // WebCrypto è disponibile in happy-dom (Node ≥ 20)
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
