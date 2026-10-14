import { existsSync, mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

// One data directory per run; set once so worker processes inherit the same value.
process.env.E2E_DATA_DIR ??= mkdtempSync(path.join(os.tmpdir(), 'cutroom-e2e-'));

const API_PORT = 3101;
const WEB_PORT = 5183;

// CI installs Playwright's own browser; sandboxed environments may provide one elsewhere.
const executablePath =
  process.env.PW_CHROMIUM_PATH ??
  (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

export default defineConfig({
  testDir: './e2e',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    viewport: { width: 1600, height: 960 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      executablePath,
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },
  webServer: [
    {
      command: 'npx tsx src/index.ts',
      cwd: '../server',
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        PORT: String(API_PORT),
        DATA_DIR: process.env.E2E_DATA_DIR,
        LOG_LEVEL: 'warn',
        RENDER_WORKERS: '2',
        // Test browsers built without proprietary codecs still decode VP9/Opus proxies.
        PROXY_CODEC: 'vp9',
        PROXY_ALWAYS: '1',
      },
    },
    {
      command: `npx vite --port ${WEB_PORT} --strictPort`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { API_URL: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
