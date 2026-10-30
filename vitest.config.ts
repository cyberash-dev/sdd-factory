import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    environment: "node",
    env: { MOZAIK_API_KEY: "" },
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
