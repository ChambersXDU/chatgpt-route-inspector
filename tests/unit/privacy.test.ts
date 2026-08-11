import { describe, expect, it } from 'vitest';
import { buildMarkdownReport, sanitizeTurn } from '../../src/core/privacy';
import { createTurn } from '../../src/core/turns';
import { DEFAULT_SETTINGS } from '../../src/core/types';

const turn = createTurn({
  captureId: 'capture-private', source: 'page_fetch', captureMode: 'live', phase: 'completed',
  observedAt: '2026-08-11T01:00:00.000Z', pageUrl: 'https://chatgpt.com/c/secret-conversation?token=secret#private',
  conversationId: 'conversation-abcdef', requestId: 'request-uvwxyz', networkRequestId: 'network-123456',
  requestedModel: 'gpt-5-6-pro', resolvedModelSlug: 'gpt-5-5-mini'
});

describe('privacy exports', () => {
  it('redacts ids and removes URL query, hash, and conversation path', () => {
    const result = sanitizeTurn(turn);
    expect(result.pageUrl).toBe('https://chatgpt.com/c/[redacted]');
    expect(result.conversationId).toBe('[redacted:abcdef]');
    expect(result.requestId).toBe('[redacted:uvwxyz]');
    expect(result.networkRequestId).toBe('[redacted:123456]');
  });

  it('keeps request ids only when the user explicitly enables it', () => {
    expect(sanitizeTurn(turn, true).requestId).toBe('request-uvwxyz');
  });

  it('produces a readable report', () => {
    const state = {
      turns: [turn], settings: { ...DEFAULT_SETTINGS },
      parserHealth: { lastSuccessAt: turn.observedAt, lastFailureAt: null, consecutiveFailures: 0 }
    };
    const english = buildMarkdownReport(state, 'en');
    const chinese = buildMarkdownReport(state, 'zh');
    expect(english).toContain('# ChatGPT Route Inspector Report');
    expect(chinese).toContain('# ChatGPT Route Inspector 报告');
    for (const report of [english, chinese]) {
      expect(report).toContain('gpt-5-6-pro');
      expect(report).toContain('resolved_model_slug');
      expect(report).toContain('[redacted:uvwxyz]');
      expect(report).not.toContain('secret-conversation');
      expect(report).not.toContain('%');
    }
  });
});
