import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseWebSocketFrame } from '../../src/core/websocket-parser';

const frame = readFileSync(new URL('../fixtures/websocket-route-frame.json', import.meta.url), 'utf8');

describe('WebSocket route parser', () => {
  it('extracts bounded route and correlation evidence from encoded SSE without retaining content', () => {
    const [result] = parseWebSocketFrame(frame);
    expect(result).toBeDefined();
    expect(result?.fields).toMatchObject({
      responseModelSlug: 'gpt-5-6-pro',
      resolvedModelSlug: 'gpt-5-5-mini',
      serverModelSlug: 'gpt-5-5-mini',
      requestId: 'req-ws-123456',
      conversationId: 'conv-private-123456'
    });
    expect(result?.conversationIds).toEqual(['conv-private-123456']);
    expect(result?.messageIds).toEqual(['input-private-123456', 'assistant-private-123456']);
    expect(result?.parentIds).toEqual(['parent-private-123456', 'input-private-123456']);
    expect(result?.terminal).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/SECRET_PROMPT|SECRET_ANSWER/);
  });

  it('fails closed for unrelated, malformed, binary-shaped, and oversized frame text', () => {
    expect(parseWebSocketFrame('not json')).toEqual([]);
    expect(parseWebSocketFrame('{"payload":{}}')).toEqual([]);
    expect(parseWebSocketFrame('[{"payload":{"payload":{"encoded_item":7}}}]')).toEqual([]);
    expect(parseWebSocketFrame('x'.repeat(2 * 1024 * 1024 + 1))).toEqual([]);
  });

  it('caps the number of envelopes inspected', () => {
    const item = {
      payload: { payload: { encoded_item: 'data: {"conversation_id":"conv"}\n' } }
    };
    expect(parseWebSocketFrame(JSON.stringify(Array.from({ length: 20 }, () => item)))).toHaveLength(16);
  });
});
