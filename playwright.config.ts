import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e/optional',
  fullyParallel: false,
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:1420',
    headless: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 1420',
    url: 'http://127.0.0.1:1420',
    reuseExistingServer: true,
    env: {
      VITE_PLAYWRIGHT: 'true',
    },
  },
})
