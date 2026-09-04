import type { InspectorState, RouteTurn } from './types';

/**
 * Return the newest usable capture for the active tab, independent of the
 * legacy live/reload setting. The turn list is stored newest-first.
 */
export function latestTurnForTab(state: InspectorState, tabId?: number): RouteTurn | null {
  if (tabId === undefined) return null;
  const turns = state.turns.filter((turn) => turn.tabId === tabId);
  return turns.find((turn) => turn.phase !== 'failed') ?? turns[0] ?? null;
}
