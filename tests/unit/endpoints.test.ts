import { describe, expect, it } from 'vitest';
import { classifyEndpoint } from '../../src/core/endpoints';

describe('classifyEndpoint', () => {
  it('matches the conversation stream endpoint', () => {
    expect(classifyEndpoint('/backend-api/f/conversation')).toEqual({
      kind: 'conversation_stream', conversationId: null
    });
  });

  it('extracts a conversation id from a record endpoint', () => {
    expect(classifyEndpoint('https://chatgpt.com/backend-api/conversation/a%20b')).toEqual({
      kind: 'conversation_record', conversationId: 'a b'
    });
  });

  it('matches current and legacy PoW requirements endpoints', () => {
    for (const path of [
      '/backend-api/sentinel/chat-requirements/prepare',
      '/backend-anon/sentinel/chat-requirements/prepare/',
      '/api/sentinel/chat-requirements/prepare',
      '/backend-api/sentinel/chat-requirements',
      '/backend-anon/sentinel/chat-requirements/',
      '/api/sentinel/chat-requirements'
    ]) {
      expect(classifyEndpoint(path).kind).toBe('pow_requirements');
    }
  });

  it('does not match similar or malformed paths', () => {
    expect(classifyEndpoint('/backend-api/f/conversation/extra').kind).toBe('other');
    expect(classifyEndpoint('/backend-api/conversation/a/messages').kind).toBe('other');
    expect(classifyEndpoint('/backend-api/sentinel/chat-requirements/finalize').kind).toBe('other');
    expect(classifyEndpoint('/backend-api/sentinel/chat-requirements/prepare/extra').kind).toBe('other');
    expect(classifyEndpoint('http://%')).toEqual({ kind: 'other', conversationId: null });
  });
});
