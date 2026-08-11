import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './output/playwright/test-results',
  timeout: 45_000,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: './output/playwright/report' }]],
  use: { trace: 'retain-on-failure' }
});
