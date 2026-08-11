import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createTurn } from '../../src/core/turns';

describe('route-turn schema', () => {
  it('declares every property emitted by RouteTurn and requires the complete record', () => {
    const schema = JSON.parse(readFileSync(new URL('../../schemas/route-turn.v1.schema.json', import.meta.url), 'utf8')) as {
      properties: Record<string, unknown>; required: string[];
    };
    const turn = createTurn({
      captureId: 'schema-test', source: 'page_fetch', captureMode: 'live', phase: 'completed',
      observedAt: '2026-08-11T01:00:00.000Z'
    });
    expect(Object.keys(turn).filter((key) => !(key in schema.properties))).toEqual([]);
    expect(Object.keys(turn).filter((key) => !schema.required.includes(key))).toEqual([]);
  });
});
