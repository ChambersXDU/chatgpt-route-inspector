const STANDARD_CONVERSATION_PATH = /^\/c\/([^/]+)(?=\/|$)/;
const PROJECT_CONVERSATION_PATH = /^\/g\/[^/]+\/c\/([^/]+)(?=\/|$)/;

function conversationMatch(pathname: string): RegExpExecArray | null {
  return STANDARD_CONVERSATION_PATH.exec(pathname) ?? PROJECT_CONVERSATION_PATH.exec(pathname);
}

export function conversationIdFromPathname(pathname: string): string | null {
  const encodedId = conversationMatch(pathname)?.[1];
  if (!encodedId) return null;
  try {
    return decodeURIComponent(encodedId) || null;
  } catch {
    return null;
  }
}

export function redactConversationPathname(pathname: string): string {
  if (PROJECT_CONVERSATION_PATH.test(pathname)) {
    return pathname.replace(/^\/g\/[^/]+\/c\/[^/]+/, '/g/[redacted]/c/[redacted]');
  }
  if (STANDARD_CONVERSATION_PATH.test(pathname)) {
    return pathname.replace(/^\/c\/[^/]+/, '/c/[redacted]');
  }
  return pathname;
}
