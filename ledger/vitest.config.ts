import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["{core,store,service,bridge,app}/__tests__/**/*.test.ts"],
  },
});
