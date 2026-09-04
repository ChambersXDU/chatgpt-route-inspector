import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (relative: string): string => readFileSync(path.join(root, relative), 'utf8');

describe('userscript-only repository contract', () => {
  it('does not ship the old Chromium extension surface', () => {
    for (const relative of ['manifest', 'src', '_locales', 'icons']) {
      expect(existsSync(path.join(root, relative)), relative).toBe(false);
    }
    expect(existsSync(path.join(root, 'tests/e2e/smoke.spec.ts'))).toBe(false);
  });

  it('packages only the Tampermonkey installer', () => {
    const source = read('scripts/package.mjs');
    expect(source).toContain('chatgpt-route-inspector-${version}.user.js');
    expect(source).toContain('SHA256SUMS.txt');
    expect(source).not.toContain('archiver');
    expect(source).not.toContain('.zip');
    expect(source).not.toContain('build.mjs');
  });

  it('keeps CI and release publishing userscript-only', () => {
    const ci = read('.github/workflows/ci.yml');
    const pkg = read('.github/workflows/package.yml');
    expect(ci).toContain('Chromium Tampermonkey smoke');
    expect(ci).not.toContain('extension');
    expect(pkg).toContain('Build Tampermonkey userscript');
    expect(pkg).toContain('chatgpt-route-inspector-userscript-${{ github.sha }}');
    expect(pkg).not.toContain('extension');
    expect(pkg).not.toContain('unzip');
  });
});
