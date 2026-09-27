import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Rendering goes through SwiftShader and SDL_ttf-in-wasm, so screenshots are shared across OSes.
  snapshotPathTemplate: '{testDir}/{testFilePath}-snapshots/{arg}{ext}',
  timeout: 120_000,
  expect: { timeout: 60_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    // Set FOF_BASE_URL=http://localhost:4173/<base>/ to test a `vite build` served by `vite preview`.
    baseURL: process.env.FOF_BASE_URL ?? 'http://localhost:5173/',
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
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
