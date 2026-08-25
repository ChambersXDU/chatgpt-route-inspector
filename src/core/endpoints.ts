export type EndpointKind = 'conversation_stream' | 'conversation_record' | 'pow_requirements' | 'other';

const POW_REQUIREMENTS_PATHS = new Set([
  '/backend-api/sentinel/chat-requirements/prepare',
  '/backend-anon/sentinel/chat-requirements/prepare',
  '/api/sentinel/chat-requirements/prepare',
  '/backend-api/sentinel/chat-requirements',
  '/backend-anon/sentinel/chat-requirements',
  '/api/sentinel/chat-requirements'
]);

export interface EndpointMatch {
  kind: EndpointKind;
  conversationId: string | null;
}

export function classifyEndpoint(input: string, base = 'https://chatgpt.com/'): EndpointMatch {
  let url: URL;
  try {
    url = new URL(input, base);
  } catch {
    return { kind: 'other', conversationId: null };
  }

  if (/^\/backend-api\/f\/conversations?$/.test(url.pathname)) {
    return { kind: 'conversation_stream', conversationId: null };
  }

  const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/$/, '') : url.pathname;
  if (POW_REQUIREMENTS_PATHS.has(pathname)) {
    return { kind: 'pow_requirements', conversationId: null };
  }

  const match = /^\/backend-api\/conversations?\/([^/]+)$/.exec(url.pathname);
  if (match?.[1]) {
    return { kind: 'conversation_record', conversationId: decodeURIComponent(match[1]) };
  }

  return { kind: 'other', conversationId: null };
}
