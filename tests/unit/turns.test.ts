import { describe, expect, it } from 'vitest';
import { createTurn, mergeTurn, upsertTurn } from '../../src/core/turns';

const request = {
  captureId: 'capture-1', source: 'page_fetch' as const, captureMode: 'live' as const,
  phase: 'requested' as const, observedAt: '2026-08-11T01:00:00.000Z',
  startedAt: '2026-08-11T01:00:00.000Z', requestedModel: 'gpt-5-6-pro',
  conversationId: 'conv-1'
};

describe('route turn correlation', () => {
  it('creates a pending unknown turn and calculates duration when completed', () => {
    const initial = createTurn(request);
    expect(initial).toMatchObject({ verdict: 'unknown', phase: 'requested', durationMs: null, captureMode: 'live' });
    const completed = mergeTurn(initial, {
      captureId: 'capture-1', source: 'page_fetch', captureMode: 'live', phase: 'completed',
      observedAt: '2026-08-11T01:00:02.500Z', completedAt: '2026-08-11T01:00:02.500Z',
      resolvedModelSlug: 'gpt-5-5-mini', serverModelSlug: 'gpt-5-5-mini', requestId: 'req-1'
    });
    expect(completed).toMatchObject({
      verdict: 'mismatch', routeModel: 'gpt-5-5-mini', durationMs: 2500, requestId: 'req-1'
    });
  });

  it('keeps live and reload observations separate even when request ids match', () => {
    let turns = upsertTurn([], {
      ...request, captureId: 'stream', requestId: 'req-shared', phase: 'completed',
      completedAt: '2026-08-11T01:00:01.000Z', resolvedModelSlug: 'gpt-5-5-mini'
    });
    turns = upsertTurn(turns, {
      captureId: 'record', source: 'conversation_record', captureMode: 'reload', phase: 'completed',
      observedAt: '2026-08-11T01:00:03.000Z', requestId: 'req-shared', responseModelSlug: 'gpt-5-5-mini'
    });
    expect(turns).toHaveLength(2);
    expect(turns.map((turn) => turn.captureMode).sort()).toEqual(['live', 'reload']);
  });

  it('still correlates two live observations by request id', () => {
    const turns = upsertTurn([createTurn({ ...request, requestId: 'req-shared' })], {
      captureId: 'second-live', source: 'page_fetch', captureMode: 'live', phase: 'completed',
      observedAt: '2026-08-11T01:00:01.000Z', requestId: 'req-shared', conversationId: 'conv-1',
      resolvedModelSlug: 'gpt-5-6-pro'
    });
    expect(turns).toHaveLength(1);
    expect(turns[0]?.sources).toEqual(['page_fetch']);
  });

  it('does not merge a shared request id across conversations', () => {
    const turns = upsertTurn([createTurn({ ...request, requestId: 'req-shared' })], {
      captureId: 'other-conversation', source: 'page_fetch', captureMode: 'live', phase: 'completed',
      observedAt: '2026-08-11T01:00:01.000Z', requestId: 'req-shared', conversationId: 'conv-2',
      resolvedModelSlug: 'gpt-5-6-pro'
    });
    expect(turns).toHaveLength(2);
  });

  it('merges WebSocket fields by capture id without regressing a completed phase', () => {
    const completed = createTurn({
      ...request, phase: 'completed', completedAt: '2026-08-11T01:00:01.000Z'
    });
    const merged = mergeTurn(completed, {
      captureId: request.captureId, source: 'page_websocket', captureMode: 'live', phase: 'responding',
      observedAt: '2026-08-11T01:00:02.000Z', resolvedModelSlug: 'gpt-5-5-mini'
    });
    expect(merged).toMatchObject({
      phase: 'completed', routeModel: 'gpt-5-5-mini', verdict: 'mismatch',
      sources: ['page_fetch', 'page_websocket']
    });
  });

  it('keeps unrelated captures separate and handles invalid durations', () => {
    const turns = upsertTurn([createTurn(request)], {
      captureId: 'capture-2', source: 'page_fetch', captureMode: 'live', phase: 'failed',
      observedAt: 'bad-date', completedAt: 'also-bad'
    });
    expect(turns).toHaveLength(2);
    expect(turns.find((turn) => turn.captureId === 'capture-2')?.durationMs).toBeNull();
  });
});
