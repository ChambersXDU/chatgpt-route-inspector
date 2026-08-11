import { DEFAULT_SETTINGS, type InspectorState, type RouteObservation } from '../core/types';
import { browserUiLanguage, normalizeUiLanguage } from '../core/language';
import { migrateStoredTurn } from '../core/migration';
import { upsertTurn } from '../core/turns';

const STORAGE_KEY = 'chatgptRouteInspectorStateV1';
let queue = Promise.resolve();

export function defaultState(): InspectorState {
  return {
    turns: [],
    settings: { ...DEFAULT_SETTINGS, uiLanguage: browserUiLanguage() },
    parserHealth: { lastSuccessAt: null, lastFailureAt: null, consecutiveFailures: 0 }
  };
}

export async function readState(): Promise<InspectorState> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const candidate = stored[STORAGE_KEY] as Partial<InspectorState> | undefined;
  if (!candidate) return defaultState();
  const turns = Array.isArray(candidate.turns)
    ? candidate.turns.map(migrateStoredTurn).filter((turn): turn is NonNullable<typeof turn> => turn !== null)
    : [];
  const captureMode = candidate.settings?.captureMode === 'reload' ? 'reload' : 'live';
  const uiLanguage = normalizeUiLanguage(candidate.settings?.uiLanguage) ?? browserUiLanguage();
  return {
    turns,
    settings: { ...DEFAULT_SETTINGS, ...candidate.settings, captureMode, uiLanguage },
    parserHealth: candidate.parserHealth ?? { lastSuccessAt: null, lastFailureAt: null, consecutiveFailures: 0 }
  };
}

export function mutateState(mutator: (state: InspectorState) => InspectorState | Promise<InspectorState>): Promise<InspectorState> {
  const operation = queue.then(async () => {
    const current = await readState();
    const next = await mutator(current);
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
    return next;
  });
  queue = operation.then(() => undefined, () => undefined);
  return operation;
}

export function storeObservation(observation: RouteObservation): Promise<InspectorState> {
  return mutateState((state) => {
    const turns = upsertTurn(state.turns, observation).slice(0, state.settings.retentionLimit);
    const failed = observation.phase === 'failed';
    return {
      ...state,
      turns,
      parserHealth: failed
        ? { lastSuccessAt: state.parserHealth.lastSuccessAt, lastFailureAt: observation.observedAt, consecutiveFailures: state.parserHealth.consecutiveFailures + 1 }
        : { lastSuccessAt: observation.observedAt, lastFailureAt: state.parserHealth.lastFailureAt, consecutiveFailures: 0 }
    };
  });
}
