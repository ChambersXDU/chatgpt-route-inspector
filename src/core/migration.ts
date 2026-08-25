import { normalizeObservation } from './observation';
import { createTurn } from './turns';
import type { CaptureMode, CaptureSource, RouteTurn } from './types';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function sourcesFrom(record: UnknownRecord): CaptureSource[] {
  const allowed = new Set<CaptureSource>(['page_fetch', 'page_websocket', 'conversation_record', 'assistant_dom']);
  const sources = Array.isArray(record.sources)
    ? record.sources.filter((source): source is CaptureSource => allowed.has(source as CaptureSource))
    : [];
  return [...new Set(sources)];
}

function inferMode(record: UnknownRecord, sources: CaptureSource[]): CaptureMode {
  if (record.captureMode === 'live' || record.captureMode === 'reload') return record.captureMode;
  if ((sources.includes('conversation_record') || sources.includes('assistant_dom')) &&
      !sources.includes('page_fetch') && !sources.includes('page_websocket')) return 'reload';
  if (typeof record.pageUrl === 'string' && /\/backend-api\/conversations?\//.test(record.pageUrl)) return 'reload';
  return 'live';
}

export function migrateStoredTurn(value: unknown): RouteTurn | null {
  const record = asRecord(value);
  if (!record) return null;
  const sources = sourcesFrom(record);
  if (Array.isArray(record.sources) && record.sources.length > 0 && sources.length === 0) return null;
  const source = sources[0] ?? 'page_fetch';
  const captureMode = inferMode(record, sources);
  const observation = normalizeObservation({ ...record, source, captureMode });
  if (!observation) return null;
  const turn = createTurn(observation);
  return { ...turn, sources: sources.length > 0 ? sources : [source] };
}
