import { parseSseResponse } from './response-parser';
import type { RouteFields } from './types';

type UnknownRecord = Record<string, unknown>;

const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const MAX_ENCODED_ITEM_BYTES = 1024 * 1024;
const MAX_ENVELOPES = 16;
const MAX_CORRELATION_IDS = 8;
const MAX_ID_LENGTH = 512;

export interface WebSocketRouteEvidence {
  fields: RouteFields;
  conversationIds: string[];
  messageIds: string[];
  parentIds: string[];
  terminal: boolean;
}

interface CorrelationAccumulator {
  conversationIds: string[];
  messageIds: string[];
  parentIds: string[];
  terminal: boolean;
  visited: number;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function boundedId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH
    ? value
    : null;
}

function pushUnique(values: string[], value: string | null): void {
  if (value && values.length < MAX_CORRELATION_IDS && !values.includes(value)) values.push(value);
}

function collectCorrelation(
  value: unknown,
  result: CorrelationAccumulator,
  depth = 0
): void {
  if (depth > 8 || result.visited >= 500) return;
  result.visited += 1;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 32)) collectCorrelation(item, result, depth + 1);
    return;
  }
  const record = asRecord(value);
  if (!record) return;

  pushUnique(result.conversationIds, boundedId(record.conversation_id));
  pushUnique(result.parentIds, boundedId(record.parent_id));
  pushUnique(result.parentIds, boundedId(record.parent));

  const author = asRecord(record.author);
  if (author) pushUnique(result.messageIds, boundedId(record.id));
  const message = asRecord(record.message);
  if (message) pushUnique(result.messageIds, boundedId(message.id));

  if (record.type === 'server_ste_metadata') {
    result.terminal = true;
  }

  for (const nested of Object.values(record)) {
    if (nested && typeof nested === 'object') collectCorrelation(nested, result, depth + 1);
  }
}

function evidenceFromEncodedItem(encodedItem: string): WebSocketRouteEvidence {
  const correlation: CorrelationAccumulator = {
    conversationIds: [],
    messageIds: [],
    parentIds: [],
    terminal: false,
    visited: 0
  };

  for (const line of encodedItem.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    if (payload === '[DONE]') {
      correlation.terminal = true;
      continue;
    }
    try {
      collectCorrelation(JSON.parse(payload) as unknown, correlation);
    } catch {
      // Partial events are ignored; later complete events carry the same identifiers.
    }
  }

  const fields = parseSseResponse(encodedItem);
  pushUnique(correlation.conversationIds, fields.conversationId);
  return {
    fields,
    conversationIds: correlation.conversationIds,
    messageIds: correlation.messageIds,
    parentIds: correlation.parentIds,
    terminal: correlation.terminal
  };
}

export function parseWebSocketFrame(raw: string): WebSocketRouteEvidence[] {
  if (raw.length === 0 || raw.length > MAX_FRAME_BYTES) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const results: WebSocketRouteEvidence[] = [];
  for (const candidate of parsed.slice(0, MAX_ENVELOPES)) {
    const envelope = asRecord(candidate);
    const outerPayload = asRecord(envelope?.payload);
    const innerPayload = asRecord(outerPayload?.payload);
    const encodedItem = innerPayload?.encoded_item;
    if (typeof encodedItem !== 'string' || encodedItem.length === 0 || encodedItem.length > MAX_ENCODED_ITEM_BYTES) continue;
    results.push(evidenceFromEncodedItem(encodedItem));
  }
  return results;
}
