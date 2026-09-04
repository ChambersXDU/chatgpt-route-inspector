import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/core/types';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function source(relative: string): Promise<string> {
  return readFile(path.join(root, relative), 'utf8');
}

describe('focused Chinese product surface', () => {
  it('starts quiet, automatic and Chinese', () => {
    expect(DEFAULT_SETTINGS.uiLanguage).toBe('zh');
    expect(DEFAULT_SETTINGS.overlayEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.autoCaptureEnabled).toBe(true);
  });

  it('keeps the popup focused on the current model', async () => {
    const html = await source('src/ui/popup/index.html');
    expect(html).toContain('id="current-model"');
    expect(html).toContain('id="advanced"');
    expect(html).toContain('id="options"');
    expect(html).not.toContain('data-language');
    expect(html).not.toContain('id="mode-live"');
    expect(html).not.toContain('id="mode-reload"');
    expect(html).not.toContain('pow-readout');
    expect(html).not.toContain('id="overlay-show"');
    expect(html).not.toContain('id="dashboard"');
  });

  it('moves secondary controls into settings', async () => {
    const html = await source('src/ui/options/index.html');
    for (const id of ['auto', 'overlay-enabled', 'overlay-mode', 'retention', 'ids', 'dashboard', 'clear']) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).not.toContain('data-language');
  });

  it('uses the restrained light visual layer', async () => {
    const css = await source('src/ui/shared/clean.css');
    expect(css).toContain('color-scheme: light');
    expect(css).toContain('--ink: #ffffff');
    expect(css).toContain('background-image:none');
    expect(css).toContain('.popup-shell { width:380px');
  });
});
