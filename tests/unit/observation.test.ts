import { describe, expect, it } from 'vitest';
import { normalizeObservation } from '../../src/core/observation';

describe('normalizeObservation', () => {
  it('keeps only bounded route fields and strips sensitive URL parts', () => {
    const result = normalizeObservation({
      captureId: 'capture-1', source: 'page_fetch', captureMode: 'live', phase: 'completed',
      observedAt: '2026-08-11T01:00:00.000Z',
      pageUrl: 'https://chatgpt.com/backend-api/conversation/private-id?token=secret#fragment',
      requestedModel: `gpt-${'x'.repeat(400)}`, selectedSourcesCount: 2, toolInvoked: false,
      prompt: 'SECRET_PROMPT', answer: 'SECRET_ANSWER'
    });
    expect(result?.pageUrl).toBe('https://chatgpt.com/backend-api/conversation/[redacted]');
    expect(result?.requestedModel).toHaveLength(256);
    expect(result).not.toHaveProperty('prompt');
    expect(result).not.toHaveProperty('answer');
  });

  it('redacts project and conversation ids from project conversation URLs', () => {
    const result = normalizeObservation({
      captureId: 'capture-project', source: 'conversation_record', captureMode: 'reload', phase: 'completed',
      observedAt: '2026-08-11T01:00:00.000Z',
      pageUrl: 'https://chatgpt.com/g/g-p-private-project/c/private-conversation?token=secret#fragment'
    });
    expect(result?.pageUrl).toBe('https://chatgpt.com/g/[redacted]/c/[redacted]');
  });

  it('redacts ids from the plural conversation record endpoint', () => {
    const result = normalizeObservation({
      captureId: 'capture-plural', source: 'conversation_record', captureMode: 'reload', phase: 'completed',
      observedAt: '2026-08-11T01:00:00.000Z',
      pageUrl: 'https://chatgpt.com/backend-api/conversations/private-id?num_turns=100'
    });
    expect(result?.pageUrl).toBe('https://chatgpt.com/backend-api/conversations/[redacted]');
  });

  it('rejects invalid sources, modes, dates, and non-object input', () => {
    expect(normalizeObservation(null)).toBeNull();
    expect(normalizeObservation({ captureId: 'x', source: 'forged', captureMode: 'live', phase: 'completed', observedAt: new Date().toISOString() })).toBeNull();
    expect(normalizeObservation({ captureId: 'x', source: 'page_fetch', captureMode: 'automatic', phase: 'completed', observedAt: new Date().toISOString() })).toBeNull();
    expect(normalizeObservation({ captureId: 'x', source: 'page_fetch', captureMode: 'live', phase: 'completed', observedAt: 'not-a-date' })).toBeNull();
  });

  it('drops malformed optional values while retaining valid lifecycle fields', () => {
    const result = normalizeObservation({
      captureId: 'x', source: 'page_fetch', captureMode: 'live', phase: 'failed',
      observedAt: '2026-08-11T01:00:00.000Z', tabId: -2, pageUrl: 'javascript:alert(1)',
      selectedSourcesCount: -1, startedAt: 'invalid', completedAt: '2026-08-11T01:00:01.000Z',
      errorCode: 'capture_failed'
    });
    expect(result).not.toHaveProperty('tabId');
    expect(result).not.toHaveProperty('pageUrl');
    expect(result).not.toHaveProperty('startedAt');
    expect(result).toMatchObject({
      captureMode: 'live', completedAt: '2026-08-11T01:00:01.000Z',
      errorCode: 'capture_failed', selectedSourcesCount: null
    });
  });

  it('accepts a bounded assistant DOM model without retaining message text', () => {
    const result = normalizeObservation({
      captureId: 'dom-1', source: 'assistant_dom', captureMode: 'reload', phase: 'completed',
      observedAt: '2026-08-11T01:00:00.000Z', domModelSlug: `gpt-${'x'.repeat(400)}`,
      textContent: 'PRIVATE_ASSISTANT_TEXT'
    });
    expect(result).toMatchObject({ source: 'assistant_dom', captureMode: 'reload' });
    expect(result?.domModelSlug).toHaveLength(256);
    expect(result).not.toHaveProperty('textContent');
  });

  it('accepts WebSocket evidence while stripping raw frame data', () => {
    const result = normalizeObservation({
      captureId: 'ws-1', source: 'page_websocket', captureMode: 'live', phase: 'completed',
      observedAt: '2026-08-11T01:00:00.000Z', resolvedModelSlug: 'gpt-5-5-mini',
      encodedItem: 'SECRET_ANSWER', rawFrame: 'PRIVATE_FRAME'
    });
    expect(result).toMatchObject({ source: 'page_websocket', resolvedModelSlug: 'gpt-5-5-mini' });
    expect(result).not.toHaveProperty('encodedItem');
    expect(result).not.toHaveProperty('rawFrame');
  });
});
