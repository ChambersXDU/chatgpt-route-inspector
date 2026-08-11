import { describe, expect, it } from 'vitest';
import { conversationIdFromPathname, redactConversationPathname } from '../../src/core/chatgpt-path';

describe('ChatGPT conversation paths', () => {
  it('extracts conversation ids from standard and project conversations', () => {
    expect(conversationIdFromPathname('/c/standard-conversation')).toBe('standard-conversation');
    expect(conversationIdFromPathname('/g/g-p-project/c/project%20conversation')).toBe('project conversation');
  });

  it('rejects non-conversation and malformed paths', () => {
    expect(conversationIdFromPathname('/g/g-p-project')).toBeNull();
    expect(conversationIdFromPathname('/backend-api/conversation/private-id')).toBeNull();
    expect(conversationIdFromPathname('/g/g-p-project/c/%')).toBeNull();
  });

  it('redacts both conversation and project identifiers', () => {
    expect(redactConversationPathname('/c/standard-conversation')).toBe('/c/[redacted]');
    expect(redactConversationPathname('/g/g-p-project/c/project-conversation')).toBe('/g/[redacted]/c/[redacted]');
    expect(redactConversationPathname('/g/g-p-project')).toBe('/g/g-p-project');
  });
});
