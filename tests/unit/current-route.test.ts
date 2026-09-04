import { describe, expect, it } from 'vitest';
import { latestTurnForTab } from '../../src/core/current-route';
import {
  EMPTY_ROUTE_FIELDS,
  ROUTE_SCHEMA,
  ROUTE_SCHEMA_VERSION,
  DEFAULT_SETTINGS,
  type RouteTurn
} from '../../src/core/types';

function turn(overrides: Partial<RouteTurn> = {}): RouteTurn {
  return {
    schema: ROUTE_SCHEMA,
    schemaVersion: ROUTE_SCHEMA_VERSION,
    captureId: 'capture',
    sources: ['conversation_record'],
    captureMode: 'reload',
    phase: 'completed',
    tabId: 7,
    pageUrl: null,
    networkRequestId: null,
    observedAt: '2026-09-04T10:00:00.000Z',
    startedAt: '2026-09-04T10:00:00.000Z',
    completedAt: '2026-09-04T10:00:00.000Z',
    durationMs: 0,
    errorCode: null,
    ...EMPTY_ROUTE_FIELDS,
    verdict: 'unknown',
    routeModel: null,
    routeModelSources: [],
    modelLabel: null,
    modelLabelSources: [],
    modelLabelConflict: false,
    reasons: [],
    ...overrides
  };
}

const state = (turns: RouteTurn[]) => ({
  turns,
  powReadings: [],
  settings: DEFAULT_SETTINGS,
  parserHealth: { lastSuccessAt: null, lastFailureAt: null, consecutiveFailures: 0 }
});

describe('latestTurnForTab', () => {
  it('returns a reloaded conversation when that is the newest capture', () => {
    const reload = turn({ captureId: 'reload', captureMode: 'reload', routeModel: 'gpt-5-5' });
    expect(latestTurnForTab(state([reload]), 7)?.captureId).toBe('reload');
  });

  it('switches to a newer live message without consulting the legacy capture mode setting', () => {
    const live = turn({ captureId: 'live', captureMode: 'live', observedAt: '2026-09-04T10:01:00.000Z', routeModel: 'gpt-5-6-pro' });
    const reload = turn({ captureId: 'reload', captureMode: 'reload', routeModel: 'gpt-5-5' });
    const current = latestTurnForTab(state([live, reload]), 7);
    expect(current?.captureId).toBe('live');
    expect(current?.routeModel).toBe('gpt-5-6-pro');
  });

  it('returns a responding live turn immediately so the popup can show a loading state', () => {
    const pending = turn({ captureId: 'pending', captureMode: 'live', phase: 'responding', routeModel: null });
    const reload = turn({ captureId: 'reload', captureMode: 'reload', routeModel: 'gpt-5-5' });
    expect(latestTurnForTab(state([pending, reload]), 7)?.captureId).toBe('pending');
  });

  it('skips a failed newest capture and falls back to the last usable one', () => {
    const failed = turn({ captureId: 'failed', captureMode: 'live', phase: 'failed' });
    const previous = turn({ captureId: 'previous', captureMode: 'reload', routeModel: 'gpt-5-5' });
    expect(latestTurnForTab(state([failed, previous]), 7)?.captureId).toBe('previous');
  });

  it('never leaks a capture from another tab', () => {
    const other = turn({ captureId: 'other', tabId: 99, routeModel: 'gpt-5-6-pro' });
    expect(latestTurnForTab(state([other]), 7)).toBeNull();
    expect(latestTurnForTab(state([other]), undefined)).toBeNull();
  });
});
