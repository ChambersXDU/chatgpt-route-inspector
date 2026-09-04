import { describe, expect, it } from 'vitest';
import { latestTurnForTab } from '../../src/core/current-route';
import { upsertTurn } from '../../src/core/turns';
import { DEFAULT_SETTINGS, type InspectorState, type RouteObservation, type RouteTurn } from '../../src/core/types';

function state(turns: RouteTurn[]): InspectorState {
  return {
    turns,
    powReadings: [],
    settings: DEFAULT_SETTINGS,
    parserHealth: { lastSuccessAt: null, lastFailureAt: null, consecutiveFailures: 0 }
  };
}

function add(turns: RouteTurn[], observation: RouteObservation): RouteTurn[] {
  return upsertTurn(turns, { ...observation, tabId: 3, pageUrl: 'https://chatgpt.com/c/route-test' });
}

describe('automatic current route flow', () => {
  it('shows reload first, then automatically follows the newest sent message', () => {
    let turns: RouteTurn[] = [];

    turns = add(turns, {
      captureId: 'reload-1',
      source: 'conversation_record',
      captureMode: 'reload',
      phase: 'completed',
      observedAt: '2026-09-04T10:00:00.000Z',
      startedAt: '2026-09-04T10:00:00.000Z',
      completedAt: '2026-09-04T10:00:00.000Z',
      conversationId: 'route-test',
      resolvedModelSlug: 'gpt-5-5'
    });

    expect(latestTurnForTab(state(turns), 3)?.routeModel).toBe('gpt-5-5');
    expect(latestTurnForTab(state(turns), 3)?.captureMode).toBe('reload');

    turns = add(turns, {
      captureId: 'live-1',
      source: 'page_fetch',
      captureMode: 'live',
      phase: 'requested',
      observedAt: '2026-09-04T10:01:00.000Z',
      startedAt: '2026-09-04T10:01:00.000Z',
      conversationId: 'route-test',
      requestedModel: 'gpt-5-6-pro'
    });

    expect(latestTurnForTab(state(turns), 3)?.captureId).toBe('live-1');
    expect(latestTurnForTab(state(turns), 3)?.phase).toBe('requested');

    turns = add(turns, {
      captureId: 'live-1',
      source: 'page_fetch',
      captureMode: 'live',
      phase: 'completed',
      observedAt: '2026-09-04T10:01:02.000Z',
      startedAt: '2026-09-04T10:01:00.000Z',
      completedAt: '2026-09-04T10:01:02.000Z',
      conversationId: 'route-test',
      requestedModel: 'gpt-5-6-pro',
      resolvedModelSlug: 'gpt-5-6-pro'
    });

    const current = latestTurnForTab(state(turns), 3);
    expect(current?.captureId).toBe('live-1');
    expect(current?.captureMode).toBe('live');
    expect(current?.routeModel).toBe('gpt-5-6-pro');
  });
});
