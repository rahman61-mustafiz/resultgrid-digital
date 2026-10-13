import { defineConfig, devices } from "@playwright/test"

// Test code needs the service-role key etc. for fixture setup/teardown; the
// app server reads .env.local itself.
try {
  process.loadEnvFile(".env.local")
} catch {
  // Fall through: e2e/helpers/qa.ts reports exactly which variables are missing.
}

const PORT = 3100

/**
 * Application E2E against a PRODUCTION build (`next build && next start`),
 * so production-only behaviour -- e.g. `secure` on session and share
 * cookies -- is what gets tested. Serial, single worker: the suite drives
 * one shared fixture project through an ordered lifecycle.
 */
export default defineConfig({
  testDir: "./e2e",
  // Pure-logic tests run separately (playwright.unit.config.ts, npm run test:unit).
  testIgnore: "unit/**",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 20 * 60_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    reuseExistingServer: false,
    timeout: 10 * 60_000,
    stdout: "ignore",
    stderr: "pipe",
  },
})
