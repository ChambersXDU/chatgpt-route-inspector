export type EndpointKind = 'conversation_stream' | 'conversation_record' | 'other';

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

  if (url.pathname === '/backend-api/f/conversation') {
    return { kind: 'conversation_stream', conversationId: null };
  }

  const match = /^\/backend-api\/conversation\/([^/]+)$/.exec(url.pathname);
  if (match?.[1]) {
    return { kind: 'conversation_record', conversationId: decodeURIComponent(match[1]) };
  }

  return { kind: 'other', conversationId: null };
}
