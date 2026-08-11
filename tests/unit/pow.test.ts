import { describe, expect, it } from 'vitest';
import { normalizePowObservation, parsePowDifficulty, parsePowResponse, upsertPowReading } from '../../src/core/pow';

describe('PoW difficulty parsing', () => {
  it('preserves the server hex string and converts it exactly to decimal', () => {
    expect(parsePowDifficulty('063556')).toEqual({ rawHex: '063556', decimal: '406870' });
    expect(parsePowDifficulty('0x000032')).toEqual({ rawHex: '0x000032', decimal: '50' });
  });

  it('uses bigint so large values do not lose precision', () => {
    expect(parsePowDifficulty('FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF')?.decimal)
      .toBe('340282366920938463463374607431768211455');
  });

  it('supports current and compatibility response wrappers', () => {
    expect(parsePowResponse({ proofofwork: { difficulty: '063556' } })?.rawHex).toBe('063556');
    expect(parsePowResponse({ chat_requirements: { proof_of_work: { difficulty: '0x10' } } })?.decimal).toBe('16');
    expect(parsePowResponse({ requirements: { pow: { difficulty: 'ff' } } })?.decimal).toBe('255');
  });

  it('rejects malformed or oversized values', () => {
    expect(parsePowDifficulty(63556)).toBeNull();
    expect(parsePowDifficulty('0x')).toBeNull();
    expect(parsePowDifficulty('12-not-hex')).toBeNull();
    expect(parsePowDifficulty('f'.repeat(257))).toBeNull();
    expect(parsePowResponse({ proofofwork: { seed: 'private' } })).toBeNull();
  });

  it('recomputes decimal values and retains only the latest reading per tab', () => {
    const first = normalizePowObservation({ rawHex: '01', decimal: '999', observedAt: '2026-08-11T01:00:00.000Z', tabId: 7 });
    expect(first?.decimal).toBe('1');
    const readings = upsertPowReading(first ? [first] : [], {
      rawHex: '02', observedAt: '2026-08-11T01:01:00.000Z', tabId: 7
    });
    expect(readings).toEqual([{
      rawHex: '02', decimal: '2', observedAt: '2026-08-11T01:01:00.000Z', tabId: 7
    }]);
  });
});
