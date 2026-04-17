const { defineConfig } = require("@playwright/test");

module.exports = defineConfig({
  testDir: "./e2e/tests",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  expect: {
    timeout: 10_000,
  },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4173/frontend/",
    headless: true,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: "npm run node",
      port: 8545,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120_000,
    },
    {
      command: "node scripts/e2e/static-server.js",
      port: 4173,
      reuseExistingServer: false,
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
    },
  ],
});
