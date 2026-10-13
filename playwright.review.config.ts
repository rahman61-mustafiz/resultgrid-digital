import { defineConfig } from '@playwright/test'
import base from './playwright.config'
export default defineConfig({
  ...base,
  testMatch: 'priority10-review.spec.ts',
  use: { ...base.use, baseURL: 'http://localhost:3101' },
  webServer: { command: 'npm run start -- -p 3101', url: 'http://localhost:3101/login', reuseExistingServer: false, timeout: 60000 },
})
