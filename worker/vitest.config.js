import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          APP_PIN: "123456",
          GITHUB_OWNER: "test-owner",
          GITHUB_REPO: "escape-call",
          GITHUB_TOKEN: "test-token"
        }
      }
    })
  ]
});
