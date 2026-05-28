import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/backend/__tests__/**/*.test.ts",
      "packages/frontend/src/**/*.test.ts",
      "packages/shared/__tests__/**/*.test.ts",
    ],
    coverage: {
      include: [
        "packages/backend/src/**/*.ts",
        "packages/frontend/src/**/*.{ts,tsx}",
        "packages/shared/src/**/*.ts",
      ],
    },
  },
  resolve: {
    conditions: ["node"],
  },
});
