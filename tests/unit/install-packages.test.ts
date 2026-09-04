import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = (relative: string) => readFile(path.join(root, relative), 'utf8');

describe('install packages workflow', () => {
  it('packages both supported installation formats with checksums', async () => {
    const script = await source('scripts/package.mjs');
    expect(script).toContain('chatgpt-route-inspector-${version}.zip');
    expect(script).toContain('chatgpt-route-inspector-${version}.user.js');
    expect(script).toContain('SHA256SUMS.txt');
    expect(script).toContain("userscript', 'chatgpt-route-inspector.user.js");
  });

  it('publishes Actions artifacts on main and release assets on tags', async () => {
    const workflow = await source('.github/workflows/package.yml');
    expect(workflow).toContain('name: Install Packages');
    expect(workflow).toContain('npm run package');
    expect(workflow).toContain('actions/upload-artifact@v4');
    expect(workflow).toContain("tags: ['v*']");
    expect(workflow).toContain('gh release upload');
    expect(workflow).toContain('gh release create');
  });

  it('verifies both installers before publishing them', async () => {
    const workflow = await source('.github/workflows/package.yml');
    expect(workflow).toContain('unzip -t release/chatgpt-route-inspector-*.zip');
    expect(workflow).toContain('node --check release/chatgpt-route-inspector-*.user.js');
    expect(workflow).toContain('cat release/SHA256SUMS.txt');
  });
});
