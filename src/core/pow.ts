import type { PowObservation, PowReading } from './types';

const MAX_POW_HEX_LENGTH = 256;
const MAX_POW_READINGS = 32;

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

export interface ParsedPowDifficulty {
  rawHex: string;
  decimal: string;
}

export function parsePowDifficulty(value: unknown): ParsedPowDifficulty | null {
  if (typeof value !== 'string') return null;
  const rawHex = value.trim();
  if (!rawHex || rawHex.length > MAX_POW_HEX_LENGTH) return null;
  const match = /^(?:0[xX])?([0-9a-fA-F]+)$/.exec(rawHex);
  const digits = match?.[1];
  if (!digits) return null;
  try {
    return { rawHex, decimal: BigInt('0x' + digits).toString(10) };
  } catch {
    return null;
  }
}

export function parsePowResponse(value: unknown): ParsedPowDifficulty | null {
  const root = asRecord(value);
  if (!root) return null;
  const roots = [root, asRecord(root.chat_requirements), asRecord(root.requirements)]
    .filter((candidate): candidate is UnknownRecord => candidate !== null);
  for (const candidate of roots) {
    const proofOfWork = asRecord(candidate.proofofwork) ??
      asRecord(candidate.proof_of_work) ??
      asRecord(candidate.pow);
    const parsed = parsePowDifficulty(proofOfWork?.difficulty);
    if (parsed) return parsed;
  }
  return null;
}

export function normalizePowObservation(value: unknown): PowReading | null {
  const record = asRecord(value);
  if (!record) return null;
  const parsed = parsePowDifficulty(record.rawHex);
  if (!parsed || typeof record.observedAt !== 'string' || !Number.isFinite(Date.parse(record.observedAt))) return null;
  const tabId = typeof record.tabId === 'number' && Number.isInteger(record.tabId) && record.tabId >= 0
    ? record.tabId
    : null;
  return { ...parsed, observedAt: record.observedAt, tabId };
}

export function upsertPowReading(readings: PowReading[], observation: PowObservation): PowReading[] {
  const reading = normalizePowObservation(observation);
  if (!reading) return readings;
  return [reading, ...readings.filter((item) => item.tabId !== reading.tabId)]
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))
    .slice(0, MAX_POW_READINGS);
}
