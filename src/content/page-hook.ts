import { classifyEndpoint } from '../core/endpoints';
import {
  parseConversationCorrelation,
  parseConversationRequest,
  type ConversationCorrelation
} from '../core/request-parser';
import { mergeRouteFields, parseResponseText } from '../core/response-parser';
import type { RouteFields, RouteObservation } from '../core/types';
import { parseWebSocketFrame, type WebSocketRouteEvidence } from '../core/websocket-parser';
import type { PageBridgeEnvelope } from '../shared/messages';

const nativeFetch = window.fetch;
const nativeWebSocket = window.WebSocket;
const allowedOrigins = new Set(__ROUTE_INSPECTOR_ALLOWED_ORIGINS__);
const MAX_CONVERSATION_RECORD_BYTES = 8 * 1024 * 1024;
const MAX_STREAM_EVENT_BYTES = 1024 * 1024;
const MAX_PENDING_CAPTURES = 32;
const PENDING_CAPTURE_TTL_MS = 10 * 60 * 1000;

function now(): string {
  return new Date().toISOString();
}

function safePageUrl(): string {
  return `${location.origin}${location.pathname}`;
}

function emit(observation: RouteObservation): void {
  const envelope: PageBridgeEnvelope = {
    source: 'chatgpt-route-inspector',
    version: 1,
    observation
  };
  window.postMessage(envelope, location.origin);
}

function requestUrl(input: RequestInfo | URL): string {
  if (input instanceof Request) return input.url;
  return String(input);
}

function isAllowedRequest(url: string): boolean {
  try {
    return allowedOrigins.has(location.origin) && new URL(url, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

async function requestBody(input: RequestInfo | URL, init?: RequestInit): Promise<string | null> {
  if (typeof init?.body === 'string') return init.body;
  if (input instanceof Request) {
    try {
      return await input.clone().text();
    } catch {
      return null;
    }
  }
  return null;
}

function fieldsSignature(fields: RouteFields): string {
  return JSON.stringify([
    fields.requestedModel,
    fields.responseModelSlug,
    fields.defaultModelSlug,
    fields.resolvedModelSlug,
    fields.serverModelSlug,
    fields.requestId,
    fields.toolInvoked,
    fields.toolName
  ]);
}

interface PendingLiveCapture extends ConversationCorrelation {
  captureId: string;
  startedAt: string;
  expiresAt: number;
  webSocketFields: RouteFields;
  lastWebSocketSignature: string;
}

const pendingLiveCaptures = new Map<string, PendingLiveCapture>();

function prunePendingCaptures(timestamp = Date.now()): void {
  for (const [captureId, pending] of pendingLiveCaptures) {
    if (pending.expiresAt <= timestamp) pendingLiveCaptures.delete(captureId);
  }
}

function registerPendingCapture(
  captureId: string,
  startedAt: string,
  correlation: ConversationCorrelation
): void {
  prunePendingCaptures();
  if (!correlation.conversationId && !correlation.inputMessageId && !correlation.parentMessageId) return;
  while (pendingLiveCaptures.size >= MAX_PENDING_CAPTURES) {
    const oldest = pendingLiveCaptures.keys().next().value as string | undefined;
    if (!oldest) break;
    pendingLiveCaptures.delete(oldest);
  }
  const emptyFields = mergeRouteFields();
  pendingLiveCaptures.set(captureId, {
    captureId,
    startedAt,
    ...correlation,
    expiresAt: Date.now() + PENDING_CAPTURE_TTL_MS,
    webSocketFields: emptyFields,
    lastWebSocketSignature: fieldsSignature(emptyFields)
  });
}

function uniqueCandidate(candidates: PendingLiveCapture[]): PendingLiveCapture | null {
  return candidates.length === 1 ? candidates[0] ?? null : null;
}

function pendingCaptureFor(evidence: WebSocketRouteEvidence): PendingLiveCapture | null {
  prunePendingCaptures();
  const pending = [...pendingLiveCaptures.values()];
  const inputMatches = pending.filter((candidate) =>
    Boolean(candidate.inputMessageId) &&
    (evidence.messageIds.includes(candidate.inputMessageId ?? '') ||
      evidence.parentIds.includes(candidate.inputMessageId ?? ''))
  );
  if (inputMatches.length > 0) return uniqueCandidate(inputMatches);

  const parentMatches = pending.filter((candidate) =>
    Boolean(candidate.parentMessageId) &&
    evidence.parentIds.includes(candidate.parentMessageId ?? '') &&
    (evidence.conversationIds.length === 0 ||
      !candidate.conversationId || evidence.conversationIds.includes(candidate.conversationId))
  );
  if (parentMatches.length > 0) return uniqueCandidate(parentMatches);

  const conversationMatches = pending.filter((candidate) =>
    Boolean(candidate.conversationId) && evidence.conversationIds.includes(candidate.conversationId ?? '')
  );
  return uniqueCandidate(conversationMatches);
}

function hasWebSocketMetadata(fields: RouteFields): boolean {
  return Boolean(
    fields.responseModelSlug ||
    fields.resolvedModelSlug ||
    fields.serverModelSlug ||
    fields.requestId ||
    fields.planType
  );
}

function handleWebSocketText(raw: string): void {
  const evidenceItems = parseWebSocketFrame(raw);
  const updates = new Map<string, { pending: PendingLiveCapture; fields: RouteFields; terminal: boolean }>();

  for (const evidence of evidenceItems) {
    const pending = pendingCaptureFor(evidence);
    if (!pending) continue;
    if (!pending.conversationId && evidence.conversationIds.length === 1) {
      pending.conversationId = evidence.conversationIds[0] ?? null;
    }
    const current = updates.get(pending.captureId);
    updates.set(pending.captureId, {
      pending,
      fields: mergeRouteFields(current?.fields ?? pending.webSocketFields, evidence.fields),
      terminal: Boolean(current?.terminal || evidence.terminal)
    });
  }

  for (const { pending, fields, terminal } of updates.values()) {
    pending.webSocketFields = mergeRouteFields(fields, { conversationId: pending.conversationId });
    const signature = fieldsSignature(pending.webSocketFields);
    const shouldEmit = hasWebSocketMetadata(pending.webSocketFields) &&
      (signature !== pending.lastWebSocketSignature || terminal);
    if (shouldEmit) {
      pending.lastWebSocketSignature = signature;
      const observedAt = now();
      const observation: RouteObservation = {
        captureId: pending.captureId,
        source: 'page_websocket',
        captureMode: 'live',
        phase: terminal ? 'completed' : 'responding',
        observedAt,
        startedAt: pending.startedAt,
        pageUrl: safePageUrl(),
        ...pending.webSocketFields
      };
      if (terminal) observation.completedAt = observedAt;
      emit(observation);
    }
    if (terminal) pendingLiveCaptures.delete(pending.captureId);
  }
}

async function parseSseStream(
  response: Response,
  captureId: string,
  startedAt: string,
  baseFields: RouteFields
): Promise<void> {
  const body = response.body;
  if (!body) throw new Error('stream_body_missing');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let fields = baseFields;
  let lastSignature = fieldsSignature(fields);

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    if (buffer.length > MAX_STREAM_EVENT_BYTES && !buffer.includes('\n')) {
      await reader.cancel('route metadata event exceeded safety limit');
      throw new Error('stream_event_too_large');
    }
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.length > MAX_STREAM_EVENT_BYTES) throw new Error('stream_event_too_large');
      if (!line.startsWith('data:')) continue;
      const parsed = parseResponseText(line)[0];
      if (!parsed) continue;
      fields = mergeRouteFields(fields, parsed);
      const signature = fieldsSignature(fields);
      if (signature !== lastSignature) {
        lastSignature = signature;
        emit({
          captureId,
          source: 'page_fetch',
          captureMode: 'live',
          phase: 'responding',
          observedAt: now(),
          startedAt,
          pageUrl: safePageUrl(),
          ...fields
        });
      }
    }
    if (done) break;
  }

  if (buffer.startsWith('data:')) {
    const parsed = parseResponseText(buffer)[0];
    if (parsed) fields = mergeRouteFields(fields, parsed);
  }
  emit({
    captureId,
    source: 'page_fetch',
    captureMode: 'live',
    phase: 'completed',
    observedAt: now(),
    startedAt,
    completedAt: now(),
    pageUrl: safePageUrl(),
    ...fields
  });
}

async function parseConversationJson(
  response: Response,
  captureId: string,
  startedAt: string,
  conversationId: string | null
): Promise<void> {
  const declaredLength = Number(response.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_CONVERSATION_RECORD_BYTES) {
    emit({
      captureId,
      source: 'conversation_record',
      captureMode: 'reload',
      phase: 'failed',
      observedAt: now(),
      startedAt,
      completedAt: now(),
      pageUrl: safePageUrl(),
      conversationId,
      errorCode: 'record_too_large'
    });
    return;
  }
  const raw = await response.text();
  if (raw.length > MAX_CONVERSATION_RECORD_BYTES) {
    emit({
      captureId,
      source: 'conversation_record',
      captureMode: 'reload',
      phase: 'failed',
      observedAt: now(),
      startedAt,
      completedAt: now(),
      pageUrl: safePageUrl(),
      conversationId,
      errorCode: 'record_too_large'
    });
    return;
  }
  const results = parseResponseText(raw).filter((fields) =>
    Boolean(fields.responseModelSlug || fields.resolvedModelSlug || fields.serverModelSlug)
  );
  for (const [index, fields] of results.entries()) {
    emit({
      captureId: `${captureId}:${fields.requestId ?? index}`,
      source: 'conversation_record',
      captureMode: 'reload',
      phase: 'completed',
      observedAt: now(),
      startedAt,
      completedAt: now(),
      pageUrl: safePageUrl(),
      ...fields,
      conversationId: conversationId ?? fields.conversationId
    });
  }
}

async function inspectFetch(
  downstreamFetch: typeof window.fetch,
  receiver: unknown,
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const downstreamReceiver = receiver ?? window;
  const url = requestUrl(input);
  const endpoint = classifyEndpoint(url, location.href);
  if (!isAllowedRequest(url) || endpoint.kind === 'other') {
    return downstreamFetch.call(downstreamReceiver, input, init);
  }

  const captureId = crypto.randomUUID();
  const startedAt = now();
  const bodyPromise = endpoint.kind === 'conversation_stream' ? requestBody(input, init) : Promise.resolve(null);
  const requestFieldsPromise = bodyPromise.then((raw) => {
    if (!raw) return null;
    const fields = parseConversationRequest(raw);
    registerPendingCapture(captureId, startedAt, parseConversationCorrelation(raw));
    emit({
      captureId,
      source: 'page_fetch',
      captureMode: 'live',
      phase: 'requested',
      observedAt: now(),
      startedAt,
      pageUrl: safePageUrl(),
      ...fields
    });
    return fields;
  });
  const responsePromise = downstreamFetch.call(downstreamReceiver, input, init);

  try {
    const response = await responsePromise;
    const clone = response.clone();
    if (endpoint.kind === 'conversation_stream') {
      void requestFieldsPromise.then((fields) => parseSseStream(
        clone,
        captureId,
        startedAt,
        fields ?? mergeRouteFields()
      )).catch(() => emit({
        captureId,
        source: 'page_fetch',
        captureMode: 'live',
        phase: 'failed',
        observedAt: now(),
        startedAt,
        completedAt: now(),
        pageUrl: safePageUrl(),
        errorCode: 'stream_parse_failed'
      }));
    } else {
      void parseConversationJson(clone, captureId, startedAt, endpoint.conversationId).catch(() => emit({
        captureId,
        source: 'conversation_record',
        captureMode: 'reload',
        phase: 'failed',
        observedAt: now(),
        startedAt,
        completedAt: now(),
        pageUrl: safePageUrl(),
        conversationId: endpoint.conversationId,
        errorCode: 'record_parse_failed'
      }));
    }
    return response;
  } catch (error) {
    emit({
      captureId,
      source: endpoint.kind === 'conversation_stream' ? 'page_fetch' : 'conversation_record',
      captureMode: endpoint.kind === 'conversation_stream' ? 'live' : 'reload',
      phase: 'failed',
      observedAt: now(),
      startedAt,
      completedAt: now(),
      pageUrl: safePageUrl(),
      errorCode: error instanceof Error ? error.name : 'fetch_failed'
    });
    throw error;
  }
}

interface FetchGeneration {
  capturesRawResponse: boolean;
  downstream: typeof window.fetch;
  wrapper: typeof window.fetch;
}

function createFetchGeneration(
  downstream: typeof window.fetch,
  capturesRawResponse: boolean
): FetchGeneration {
  const generation = {
    capturesRawResponse,
    downstream,
    wrapper: nativeFetch
  } satisfies FetchGeneration;
  generation.wrapper = async function routeInspectorFetch(
    this: unknown,
    input: RequestInfo | URL,
    init?: RequestInit
  ): Promise<Response> {
    const receiver = this ?? window;
    if (generation.capturesRawResponse) {
      return inspectFetch(generation.downstream, receiver, input, init);
    }
    return generation.downstream.call(receiver, input, init);
  };
  return generation;
}

let currentFetchGeneration = createFetchGeneration(nativeFetch, true);

function adoptDownstreamFetch(candidate: unknown): void {
  if (typeof candidate !== 'function' || candidate === currentFetchGeneration.wrapper) return;
  currentFetchGeneration = createFetchGeneration(
    candidate as typeof window.fetch,
    candidate === nativeFetch
  );
}

function routeFetchGetter(): typeof window.fetch {
  return currentFetchGeneration.wrapper;
}

function routeFetchSetter(candidate: unknown): void {
  adoptDownstreamFetch(candidate);
}

function installFetchHook(): void {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'fetch');
    if (descriptor?.get === routeFetchGetter && descriptor.set === routeFetchSetter) return;
    adoptDownstreamFetch(window.fetch);
    try {
      Object.defineProperty(window, 'fetch', {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get: routeFetchGetter,
        set: routeFetchSetter
      });
    } catch {
      window.fetch = currentFetchGeneration.wrapper;
    }
  } catch {
    // A hostile or frozen page fetch must not throw repeatedly from the recovery timer.
  }
}

type WebSocketConstructor = typeof window.WebSocket;

interface WebSocketGeneration {
  capturesRawMessages: boolean;
  downstream: WebSocketConstructor;
  wrapper: WebSocketConstructor;
}

const observedSockets = new WeakSet<WebSocket>();

function isAllowedWebSocket(url: string): boolean {
  if (!allowedOrigins.has(location.origin)) return false;
  try {
    const parsed = new URL(url, location.href);
    if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') return false;
    const httpOrigin = `${parsed.protocol === 'wss:' ? 'https:' : 'http:'}//${parsed.host}`;
    if (allowedOrigins.has(httpOrigin)) return true;
    const hostname = parsed.hostname.toLowerCase();
    return hostname.endsWith('.chatgpt.com') || hostname.endsWith('.openai.com');
  } catch {
    return false;
  }
}

function observeWebSocket(socket: WebSocket): void {
  if (observedSockets.has(socket) || !isAllowedWebSocket(socket.url)) return;
  observedSockets.add(socket);
  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return;
    const raw = event.data;
    queueMicrotask(() => handleWebSocketText(raw));
  });
}

function copyWebSocketConstructorShape(
  wrapper: WebSocketConstructor,
  downstream: WebSocketConstructor
): void {
  try {
    Object.setPrototypeOf(wrapper, Object.getPrototypeOf(downstream));
  } catch {
    // Constructor inheritance is cosmetic; instance behavior remains native.
  }
  for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(downstream, key) ??
      Object.getOwnPropertyDescriptor(nativeWebSocket, key);
    if (!descriptor) continue;
    try {
      Object.defineProperty(wrapper, key, descriptor);
    } catch {
      // A non-standard downstream wrapper may expose non-configurable statics.
    }
  }
  try {
    Object.defineProperty(wrapper, 'prototype', {
      value: downstream.prototype,
      writable: false,
      enumerable: false,
      configurable: false
    });
  } catch {
    // The default wrapper prototype still leaves the returned native instance untouched.
  }
  try {
    Object.defineProperty(wrapper, 'name', { value: 'WebSocket', configurable: true });
    Object.defineProperty(wrapper, 'length', { value: downstream.length, configurable: true });
    const nativeSource = Function.prototype.toString.call(downstream);
    Object.defineProperty(wrapper, 'toString', {
      value: () => nativeSource,
      configurable: true
    });
  } catch {
    // Function metadata must never prevent the page from constructing a socket.
  }
}

function createWebSocketGeneration(
  downstream: WebSocketConstructor,
  capturesRawMessages: boolean
): WebSocketGeneration {
  const generation = {
    capturesRawMessages,
    downstream,
    wrapper: nativeWebSocket
  } satisfies WebSocketGeneration;
  generation.wrapper = function routeInspectorWebSocket(
    this: WebSocket,
    url: string | URL,
    protocols?: string | string[]
  ): WebSocket {
    if (!new.target) throw new TypeError("Failed to construct 'WebSocket': Please use the 'new' operator.");
    const argumentsList = arguments.length > 1 ? [url, protocols] : [url];
    const invokedTarget = new.target as unknown as WebSocketConstructor;
    const newTarget = invokedTarget === generation.wrapper
      ? generation.downstream
      : invokedTarget;
    const socket = Reflect.construct(generation.downstream, argumentsList, newTarget) as WebSocket;
    if (generation.capturesRawMessages) observeWebSocket(socket);
    return socket;
  } as unknown as WebSocketConstructor;
  copyWebSocketConstructorShape(generation.wrapper, downstream);
  return generation;
}

let currentWebSocketGeneration = createWebSocketGeneration(nativeWebSocket, true);

function adoptDownstreamWebSocket(candidate: unknown): void {
  if (typeof candidate !== 'function' || candidate === currentWebSocketGeneration.wrapper) return;
  currentWebSocketGeneration = createWebSocketGeneration(
    candidate as WebSocketConstructor,
    candidate === nativeWebSocket
  );
}

function routeWebSocketGetter(): WebSocketConstructor {
  return currentWebSocketGeneration.wrapper;
}

function routeWebSocketSetter(candidate: unknown): void {
  adoptDownstreamWebSocket(candidate);
}

function installWebSocketHook(): void {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'WebSocket');
    if (descriptor?.get === routeWebSocketGetter && descriptor.set === routeWebSocketSetter) return;
    adoptDownstreamWebSocket(window.WebSocket);
    try {
      Object.defineProperty(window, 'WebSocket', {
        configurable: true,
        enumerable: descriptor?.enumerable ?? true,
        get: routeWebSocketGetter,
        set: routeWebSocketSetter
      });
    } catch {
      window.WebSocket = currentWebSocketGeneration.wrapper;
    }
  } catch {
    // A hostile or frozen page WebSocket must not break ChatGPT or the recovery timer.
  }
}

installFetchHook();
installWebSocketHook();
queueMicrotask(() => {
  installFetchHook();
  installWebSocketHook();
});
document.addEventListener('DOMContentLoaded', () => {
  installFetchHook();
  installWebSocketHook();
}, { once: true });
window.addEventListener('load', () => {
  installFetchHook();
  installWebSocketHook();
}, { once: true });
window.setInterval(() => {
  installFetchHook();
  installWebSocketHook();
  prunePendingCaptures();
}, 1000);
