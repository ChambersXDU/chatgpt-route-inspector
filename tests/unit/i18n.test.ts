import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createTurn } from '../../src/core/turns';
import { assessmentReasons, captureModeLabel, turnResultLabel } from '../../src/ui/shared/client';
import { t, TRANSLATION_KEYS } from '../../src/ui/shared/i18n';

const mismatch = createTurn({
  captureId: 'language-mismatch',
  source: 'page_fetch',
  captureMode: 'live',
  phase: 'completed',
  observedAt: '2026-08-11T01:00:00.000Z',
  requestedModel: 'gpt-5-6-pro',
  resolvedModelSlug: 'gpt-5-5-mini'
});

describe('UI translations', () => {
  it('renders the same route result in Chinese and English without changing the underlying verdict', () => {
    expect(mismatch.verdict).toBe('mismatch');
    expect(turnResultLabel(mismatch, 'zh')).toBe('路由错配');
    expect(turnResultLabel(mismatch, 'en')).toBe('Route mismatch');
    expect(captureModeLabel('reload', 'zh')).toBe('会话重载');
    expect(captureModeLabel('reload', 'en')).toBe('Conversation reload');
  });

  it('localizes reconstructed evidence reasons while preserving exact model fields', () => {
    const chinese = assessmentReasons(mismatch, 'zh').join('\n');
    const english = assessmentReasons(mismatch, 'en').join('\n');
    expect(chinese).toContain('请求模型：gpt-5-6-pro');
    expect(chinese).toContain('请求模型与响应路由模型不一致');
    expect(english).toContain('Requested model: gpt-5-6-pro');
    expect(english).toContain('Requested model and response route do not match');
    expect(english).not.toMatch(/[\u4e00-\u9fff]/);
  });

  it('substitutes values and keeps attribution identical in both languages', () => {
    expect(t('zh', 'footer.records', { count: 3 })).toBe('3 条记录');
    expect(t('en', 'footer.records', { count: 3 })).toBe('3 RECORDS');
    expect(t('zh', 'app.author')).toBe('Created by @liuqi');
    expect(t('en', 'app.author')).toBe('Created by @liuqi');
  });

  it('defines every translation key referenced by extension HTML', () => {
    const known = new Set<string>(TRANSLATION_KEYS);
    for (const page of ['popup', 'dashboard', 'options', 'onboarding']) {
      const html = readFileSync(new URL(`../../src/ui/${page}/index.html`, import.meta.url), 'utf8');
      const keys = [...html.matchAll(/data-i18n(?:-aria-label|-title)?="([^"]+)"/g)]
        .flatMap((match) => match[1] ? [match[1]] : []);
      expect(keys.length).toBeGreaterThan(0);
      expect(keys.filter((key) => !known.has(key))).toEqual([]);
      expect(html).toContain('Created by @liuqi');
      expect(html).toContain('https://blog.liu-qi.cn/tools/');
    }
  });
});
