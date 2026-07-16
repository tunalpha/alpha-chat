import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    // Sequenziale: la libreria usa stato globale per il Curve singleton
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    testTimeout: 15000, // X3DH + Double Ratchet possono richiedere più tempo
    reporters: ["verbose"],
  },
});
