import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseConversationCorrelation, parseConversationRequest } from '../../src/core/request-parser';

const fixture = readFileSync(new URL('../fixtures/conversation-request.json', import.meta.url), 'utf8');

describe('parseConversationRequest', () => {
  it('extracts only the request routing whitelist', () => {
    const result = parseConversationRequest(fixture);
    expect(result).toMatchObject({
      requestedModel: 'gpt-5-6-pro',
      thinkingEffort: 'standard',
      conversationId: 'conv-private-123456',
      conversationMode: 'primary_assistant',
      selectedSourcesCount: 2
    });
    expect(JSON.stringify(result)).not.toContain('SECRET_PROMPT');
    expect(JSON.stringify(result)).not.toContain('private.pdf');
  });

  it('returns empty fields for malformed or non-object JSON', () => {
    expect(parseConversationRequest('{bad').requestedModel).toBeNull();
    expect(parseConversationRequest('[]').conversationId).toBeNull();
  });

  it('extracts bounded in-memory correlation ids without retaining message content', () => {
    const result = parseConversationCorrelation(fixture);
    expect(result).toEqual({
      conversationId: 'conv-private-123456',
      inputMessageId: 'input-private-123456',
      parentMessageId: 'parent-private-123456'
    });
    expect(JSON.stringify(result)).not.toContain('SECRET_PROMPT');
    expect(parseConversationCorrelation('{bad')).toEqual({
      conversationId: null,
      inputMessageId: null,
      parentMessageId: null
    });
    expect(parseConversationCorrelation(JSON.stringify({
      conversation_id: 'x'.repeat(513), messages: [{ id: 'y'.repeat(513) }]
    }))).toEqual({ conversationId: null, inputMessageId: null, parentMessageId: null });
  });
});
