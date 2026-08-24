import { describe, expect, it } from 'vitest';
import { normalizeOverlayMode } from '../../src/core/types';

describe('overlay mode normalization', () => {
  it('keeps every supported overlay mode', () => {
    expect(normalizeOverlayMode('full')).toBe('full');
    expect(normalizeOverlayMode('compact')).toBe('compact');
    expect(normalizeOverlayMode('mini')).toBe('mini');
    expect(normalizeOverlayMode('docked')).toBe('docked');
  });

  it('migrates the legacy minimized flag to compact mode', () => {
    expect(normalizeOverlayMode(undefined, true)).toBe('compact');
  });

  it('rejects an unsupported stored mode instead of preserving it', () => {
    expect(normalizeOverlayMode('tiny', false)).toBe('full');
  });
});
