import { assessRoute } from './assessment';
import {
  EMPTY_ROUTE_FIELDS,
  ROUTE_SCHEMA,
  ROUTE_SCHEMA_VERSION,
  type RouteObservation,
  type RouteTurn
} from './types';

function duration(startedAt: string, completedAt: string | null): number | null {
  if (!completedAt) return null;
  const value = Date.parse(completedAt) - Date.parse(startedAt);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function fieldsFromObservation(observation: RouteObservation) {
  return {
    ...EMPTY_ROUTE_FIELDS,
    requestedModel: observation.requestedModel ?? null,
    responseModelSlug: observation.responseModelSlug ?? null,
    defaultModelSlug: observation.defaultModelSlug ?? null,
    resolvedModelSlug: observation.resolvedModelSlug ?? null,
    serverModelSlug: observation.serverModelSlug ?? null,
    domModelSlug: observation.domModelSlug ?? null,
    thinkingEffort: observation.thinkingEffort ?? null,
    planType: observation.planType ?? null,
    requestId: observation.requestId ?? null,
    conversationId: observation.conversationId ?? null,
    conversationMode: observation.conversationMode ?? null,
    selectedSourcesCount: observation.selectedSourcesCount ?? null,
    toolInvoked: observation.toolInvoked ?? null,
    toolName: observation.toolName ?? null,
    isSearch: observation.isSearch ?? null,
    hadImage: observation.hadImage ?? null,
    fastConvo: observation.fastConvo ?? null
  };
}

export function createTurn(observation: RouteObservation): RouteTurn {
  const fields = fieldsFromObservation(observation);
  const completedAt = observation.completedAt ?? null;
  const startedAt = observation.startedAt ?? observation.observedAt;
  return {
    schema: ROUTE_SCHEMA,
    schemaVersion: ROUTE_SCHEMA_VERSION,
    captureId: observation.captureId,
    sources: [observation.source],
    captureMode: observation.captureMode,
    phase: observation.phase,
    tabId: observation.tabId ?? null,
    pageUrl: observation.pageUrl ?? null,
    networkRequestId: observation.networkRequestId ?? null,
    observedAt: observation.observedAt,
    startedAt,
    completedAt,
    durationMs: duration(startedAt, completedAt),
    errorCode: observation.errorCode ?? null,
    ...fields,
    ...assessRoute(fields)
  };
}

function pick<T>(current: T | null, incoming: T | null): T | null {
  return incoming ?? current;
}

const phaseRank = {
  requested: 0,
  responding: 1,
  completed: 2,
  failed: 2
} as const;

function monotonicPhase(current: RouteTurn['phase'], incoming: RouteObservation['phase']): RouteTurn['phase'] {
  return phaseRank[incoming] >= phaseRank[current] ? incoming : current;
}

export function mergeTurn(turn: RouteTurn, observation: RouteObservation): RouteTurn {
  const incoming = fieldsFromObservation(observation);
  const fields = {
    requestedModel: pick(turn.requestedModel, incoming.requestedModel),
    responseModelSlug: pick(turn.responseModelSlug, incoming.responseModelSlug),
    defaultModelSlug: pick(turn.defaultModelSlug, incoming.defaultModelSlug),
    resolvedModelSlug: pick(turn.resolvedModelSlug, incoming.resolvedModelSlug),
    serverModelSlug: pick(turn.serverModelSlug, incoming.serverModelSlug),
    domModelSlug: pick(turn.domModelSlug, incoming.domModelSlug),
    thinkingEffort: pick(turn.thinkingEffort, incoming.thinkingEffort),
    planType: pick(turn.planType, incoming.planType),
    requestId: pick(turn.requestId, incoming.requestId),
    conversationId: pick(turn.conversationId, incoming.conversationId),
    conversationMode: pick(turn.conversationMode, incoming.conversationMode),
    selectedSourcesCount: pick(turn.selectedSourcesCount, incoming.selectedSourcesCount),
    toolInvoked: pick(turn.toolInvoked, incoming.toolInvoked),
    toolName: pick(turn.toolName, incoming.toolName),
    isSearch: pick(turn.isSearch, incoming.isSearch),
    hadImage: pick(turn.hadImage, incoming.hadImage),
    fastConvo: pick(turn.fastConvo, incoming.fastConvo)
  };
  const completedAt = observation.completedAt ?? turn.completedAt;
  return {
    ...turn,
    ...fields,
    ...assessRoute(fields),
    sources: [...new Set([...turn.sources, observation.source])],
    captureMode: observation.captureMode,
    phase: monotonicPhase(turn.phase, observation.phase),
    tabId: observation.tabId ?? turn.tabId,
    pageUrl: observation.pageUrl ?? turn.pageUrl,
    networkRequestId: observation.networkRequestId ?? turn.networkRequestId,
    observedAt: observation.observedAt,
    completedAt,
    durationMs: duration(turn.startedAt, completedAt),
    errorCode: observation.errorCode ?? turn.errorCode
  };
}

export function upsertTurn(turns: RouteTurn[], observation: RouteObservation): RouteTurn[] {
  const index = turns.findIndex((turn) =>
    turn.captureId === observation.captureId ||
    (turn.captureMode === observation.captureMode &&
      observation.requestId !== undefined && observation.requestId !== null &&
      turn.requestId === observation.requestId &&
      observation.conversationId !== undefined && observation.conversationId !== null &&
      turn.conversationId === observation.conversationId)
  );
  if (index === -1) return [createTurn(observation), ...turns];
  const copy = [...turns];
  const existing = copy[index];
  if (!existing) return [createTurn(observation), ...turns];
  copy[index] = mergeTurn(existing, observation);
  return copy.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
}
