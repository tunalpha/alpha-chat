import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic", // JSX senza `import React` (come il build vite con plugin-react)
  },
  test: {
    environment: "happy-dom",
    globals: false,
    testTimeout: 15000,      // default 5000; alzato per import barrel con ESM pesanti (ThirdWeb, Li.Fi)
    hookTimeout: 15000,
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
