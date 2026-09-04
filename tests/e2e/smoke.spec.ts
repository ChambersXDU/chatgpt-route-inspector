import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const extensionPath = path.join(root, 'dist', 'e2e');

test('focused popup and settings render in the built extension', async () => {
  const profileDir = await mkdtemp(path.join(tmpdir(), 'route-inspector-smoke-'));
  const context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });

  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();

    await page.goto(`chrome-extension://${extensionId}/ui/popup/index.html`);
    await expect(page.locator('#current-model')).toHaveText('尚未捕获');
    await expect(page.locator('#advanced')).toBeVisible();
    await expect(page.locator('#options')).toBeVisible();
    await expect(page.locator('[data-language]')).toHaveCount(0);
    await expect(page.locator('#mode-live')).toHaveCount(0);
    await expect(page.locator('#mode-reload')).toHaveCount(0);
    await expect(page.locator('.pow-readout')).toHaveCount(0);

    await page.goto(`chrome-extension://${extensionId}/ui/options/index.html`);
    await expect(page.locator('#auto')).toBeChecked();
    await expect(page.locator('#overlay-enabled')).not.toBeChecked();
    await expect(page.locator('#overlay-mode')).toBeVisible();
    await expect(page.locator('#dashboard')).toBeVisible();
    await expect(page.locator('[data-language]')).toHaveCount(0);
  } finally {
    await context.close();
    await rm(profileDir, { recursive: true, force: true });
  }
});
