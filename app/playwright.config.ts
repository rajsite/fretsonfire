import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    // Set FOF_BASE_URL=http://localhost:4173 to test a `vite build` served by `vite preview`.
    baseURL: process.env.FOF_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--autoplay-policy=no-user-gesture-required', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
  ],
  webServer: {
    command: process.platform === 'win32' ? 'npm.cmd run dev' : 'npm run dev',
    url: 'http://localhost:5173/index.html',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
