import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseConversationRequest } from '../../src/core/request-parser';
import { mergeRouteFields, parseConversationRecord, parseSseResponse } from '../../src/core/response-parser';
import { createTurn, upsertTurn } from '../../src/core/turns';
import { parseWebSocketFrame } from '../../src/core/websocket-parser';

const request = readFileSync(new URL('../fixtures/conversation-request.json', import.meta.url), 'utf8');
const abnormal = readFileSync(new URL('../fixtures/abnormal-response.sse', import.meta.url), 'utf8');
const normal = readFileSync(new URL('../fixtures/normal-response.sse', import.meta.url), 'utf8');
const conversationRecord = JSON.parse(readFileSync(new URL('../fixtures/conversation-record.json', import.meta.url), 'utf8')) as unknown;
const handoff = readFileSync(new URL('../fixtures/handoff-response.sse', import.meta.url), 'utf8');
const webSocketFrame = readFileSync(new URL('../fixtures/websocket-route-frame.json', import.meta.url), 'utf8');

describe('request-to-route evidence pipeline', () => {
  it('reports a route-field conflict when explicit live routing differs from the model label', () => {
    const fields = mergeRouteFields(parseConversationRequest(request), parseSseResponse(abnormal));
    const turn = createTurn({
      captureId: 'integration-mismatch', source: 'page_fetch', captureMode: 'live', phase: 'completed',
      observedAt: '2026-08-11T01:00:10.000Z', startedAt: '2026-08-11T01:00:00.000Z',
      completedAt: '2026-08-11T01:00:10.000Z', ...fields
    });
    expect(turn).toMatchObject({
      requestedModel: 'gpt-5-6-pro',
      routeModel: null,
      routeModelSources: ['resolved_model_slug', 'server_ste_metadata.model_slug', 'assistant.metadata.model_slug'],
      modelLabel: 'gpt-5-6-pro',
      verdict: 'conflict',
      captureMode: 'live'
    });
    expect(JSON.stringify(turn)).not.toMatch(/SECRET_PROMPT|SECRET_ANSWER|confidence/i);
  });

  it('does not false-positive when requested and live response route models agree', () => {
    const fields = mergeRouteFields(parseConversationRequest(request), parseSseResponse(normal));
    const turn = createTurn({
      captureId: 'integration-normal', source: 'page_fetch', captureMode: 'live', phase: 'completed',
      observedAt: '2026-08-11T01:00:00.000Z', ...fields
    });
    expect(turn).toMatchObject({ routeModel: 'gpt-5-6-pro', verdict: 'normal', captureMode: 'live' });
  });

  it('merges a handoff-only fetch with the correlated WebSocket route into one live turn', () => {
    const requestFields = parseConversationRequest(request);
    const handoffFields = parseSseResponse(handoff);
    const [webSocketEvidence] = parseWebSocketFrame(webSocketFrame);
    expect(webSocketEvidence).toBeDefined();

    let turns = upsertTurn([], {
      captureId: 'integration-websocket', source: 'page_fetch', captureMode: 'live', phase: 'requested',
      observedAt: '2026-08-11T01:00:00.000Z', startedAt: '2026-08-11T01:00:00.000Z',
      ...requestFields
    });
    turns = upsertTurn(turns, {
      captureId: 'integration-websocket', source: 'page_fetch', captureMode: 'live', phase: 'completed',
      observedAt: '2026-08-11T01:00:01.000Z', completedAt: '2026-08-11T01:00:01.000Z',
      ...handoffFields
    });
    turns = upsertTurn(turns, {
      captureId: 'integration-websocket', source: 'page_websocket', captureMode: 'live', phase: 'completed',
      observedAt: '2026-08-11T01:00:05.000Z', completedAt: '2026-08-11T01:00:05.000Z',
      ...webSocketEvidence?.fields
    });

    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({
      requestedModel: 'gpt-5-6-pro',
      routeModel: null,
      verdict: 'conflict',
      phase: 'completed',
      sources: ['page_fetch', 'page_websocket'],
      durationMs: 5000
    });
    expect(JSON.stringify(turns)).not.toMatch(/SECRET_PROMPT|SECRET_ANSWER|HANDOFF_SECRET/);
  });

  it('extracts a completed assistant route after a conversation reload', () => {
    const [fields] = parseConversationRecord(conversationRecord);
    expect(fields).toBeDefined();
    const turn = createTurn({
      captureId: 'integration-reload', source: 'conversation_record', captureMode: 'reload',
      phase: 'completed', observedAt: '2026-08-11T01:05:00.000Z', ...fields
    });
    expect(turn).toMatchObject({
      requestedModel: null,
      routeModel: null,
      routeModelSources: ['resolved_model_slug', 'assistant.metadata.model_slug'],
      modelLabel: 'gpt-5-6-pro',
      verdict: 'conflict',
      captureMode: 'reload'
    });
  });
});
