import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function manifest() {
  return JSON.parse(readFileSync(new URL('../../manifest/manifest.json', import.meta.url), 'utf8')) as {
    manifest_version: number;
    permissions: string[];
    host_permissions: string[];
    content_scripts: Array<{ matches: string[]; world: string }>;
    default_locale: string;
    name: string;
    description: string;
    icons: Record<string, string>;
    action: { default_icon: Record<string, string> };
  };
}

function pngDimensions(relativePath: string): { width: number; height: number } {
  const image = readFileSync(new URL(`../../${relativePath}`, import.meta.url));
  expect(image.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { width: image.readUInt32BE(16), height: image.readUInt32BE(20) };
}

describe('extension permissions', () => {
  it('uses one minimal manifest with no browser debugging permission', () => {
    const value = manifest();
    expect(value.manifest_version).toBe(3);
    expect(value.permissions).toEqual(['storage', 'activeTab']);
    expect(value.permissions).not.toContain('debugger');
    expect(value.host_permissions).toEqual(['https://chatgpt.com/*', 'https://chat.openai.com/*']);
    expect(value.content_scripts.map((script) => script.world)).toEqual(['MAIN', 'ISOLATED']);
    expect(value.default_locale).toBe('en');
    expect(value.name).toBe('__MSG_extensionName__');
    expect(value.description).toBe('__MSG_extensionDescription__');
  });

  it('ships generated toolbar icons at every declared size', () => {
    const value = manifest();
    const expected = {
      '16': 'icons/icon-16.png',
      '32': 'icons/icon-32.png',
      '48': 'icons/icon-48.png',
      '128': 'icons/icon-128.png'
    };
    expect(value.icons).toEqual(expected);
    expect(value.action.default_icon).toEqual(expected);
    for (const [size, relativePath] of Object.entries(expected)) {
      expect(pngDimensions(relativePath)).toEqual({ width: Number(size), height: Number(size) });
    }
  });

  it('ships valid English and Chinese native extension metadata', () => {
    for (const locale of ['en', 'zh_CN']) {
      const messages = JSON.parse(readFileSync(new URL(`../../_locales/${locale}/messages.json`, import.meta.url), 'utf8')) as Record<string, { message?: string }>;
      expect(messages.extensionName?.message).toBeTruthy();
      expect(messages.extensionDescription?.message).toBeTruthy();
    }
  });
});
