import { defineConfig } from "vitest/config";

// Engine tests run in plain Node, without the Cloudflare/React plugins from vite.config.ts.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
