import { defineConfig } from "@playwright/test"

/**
 * Pure-logic unit tests (questionnaire rules engine, readiness, export
 * rendering). Uses Playwright's test runner so no second test framework is
 * needed; no browser and no web server are started.
 */
export default defineConfig({
  testDir: "./e2e/unit",
  fullyParallel: true,
  reporter: "list",
})
