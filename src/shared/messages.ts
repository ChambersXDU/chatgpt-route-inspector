import type { InspectorSettings, InspectorState, RouteObservation } from '../core/types';

export type RuntimeRequest =
  | { type: 'route:observation'; observation: RouteObservation }
  | { type: 'route:get-state'; tabId?: number }
  | { type: 'route:update-settings'; settings: Partial<InspectorSettings> }
  | { type: 'route:clear' }
  | { type: 'route:open-dashboard' };

export interface RuntimeResponse {
  ok: boolean;
  state?: InspectorState;
  error?: string;
  tabId?: number;
}

export interface PageBridgeEnvelope {
  source: 'chatgpt-route-inspector';
  version: 1;
  observation: RouteObservation;
}

export function isPageBridgeEnvelope(value: unknown): value is PageBridgeEnvelope {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.source !== 'chatgpt-route-inspector' || candidate.version !== 1) return false;
  const observation = candidate.observation;
  if (!observation || typeof observation !== 'object') return false;
  const record = observation as Record<string, unknown>;
  return typeof record.captureId === 'string' &&
    typeof record.observedAt === 'string' &&
    ['page_fetch', 'page_websocket', 'conversation_record'].includes(String(record.source)) &&
    ['live', 'reload'].includes(String(record.captureMode)) &&
    ['requested', 'responding', 'completed', 'failed'].includes(String(record.phase));
}
