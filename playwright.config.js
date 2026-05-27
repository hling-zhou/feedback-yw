import { defineConfig } from '@playwright/test'

const E2E_DB_DIR = 'e2e-data'

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:5175',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'node server/index.js',
      url: 'http://127.0.0.1:3001/health',
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        JWT_SECRET: 'e2e-test-jwt-secret-with-32-characters-min',
        ADMIN_INITIAL_PASSWORD: 'E2eTestPass123!',
        CORS_ORIGINS: 'http://127.0.0.1:5175',
        AUTH_DATABASE_PATH: `${E2E_DB_DIR}/auth.db`,
        SERVER_DATA_DIR: E2E_DB_DIR,
        API_PORT: '3001',
        API_HOST: '127.0.0.1',
      },
    },
    {
      command: 'npm run dev -- --host 127.0.0.1 --port 5175 --strictPort',
      url: 'http://127.0.0.1:5175',
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
})
