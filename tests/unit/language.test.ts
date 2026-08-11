import { describe, expect, it } from 'vitest';
import { detectUiLanguage, normalizeUiLanguage } from '../../src/core/language';

describe('UI language selection', () => {
  it('selects Chinese for simplified and traditional Chinese browser locales', () => {
    expect(detectUiLanguage('zh-CN')).toBe('zh');
    expect(detectUiLanguage('zh-TW')).toBe('zh');
    expect(normalizeUiLanguage('zh_Hans')).toBe('zh');
  });

  it('uses English for English and unsupported browser locales', () => {
    expect(detectUiLanguage('en-US')).toBe('en');
    expect(detectUiLanguage('ja-JP')).toBe('en');
    expect(detectUiLanguage(undefined)).toBe('en');
    expect(normalizeUiLanguage('fr')).toBeNull();
  });
});
