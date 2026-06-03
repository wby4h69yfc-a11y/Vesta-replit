import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./src/e2e",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:80",
    headless: true,
    viewport: { width: 430, height: 932 },
  },
  reporter: [["list"]],
});
