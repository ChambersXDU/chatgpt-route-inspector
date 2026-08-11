import type { CaptureMode, InspectorState, RouteTurn, UiLanguage } from '../core/types';
import { isPageBridgeEnvelope, type RuntimeRequest, type RuntimeResponse } from '../shared/messages';
import { AUTHOR_LINK, AUTHOR_TEXT } from '../ui/shared/branding';
import { t } from '../ui/shared/i18n';

let state: InspectorState | null = null;
let host: HTMLElement | null = null;
let ownTabId: number | null = null;
let scanTimer: number | null = null;
let scanRunning = false;
let reloadScanEnabledForDocument = false;
const documentStartedAtMs = Date.now();
const DOM_FALLBACK_DELAY_MS = 1200;
const seenDomRoutes = new Set<string>();

const stateReady = chrome.runtime.sendMessage<RuntimeRequest, RuntimeResponse>({ type: 'route:get-state' })
  .then((response) => {
    ownTabId = response.tabId ?? null;
    if (response.state) {
      state = response.state;
      reloadScanEnabledForDocument = state.settings.captureMode === 'reload';
      render();
      scheduleReloadDomScan();
    }
  })
  .catch(() => undefined);

function currentTurn(): RouteTurn | null {
  if (!state) return null;
  const mode = state.settings.captureMode;
  const conversationId = mode === 'reload' ? conversationIdFromPath() : null;
  if (mode === 'reload' && !conversationId) return null;
  if (ownTabId !== null) {
    return state.turns.find((turn) =>
      turn.tabId === ownTabId &&
      turn.captureMode === mode &&
      (mode !== 'reload' || turn.conversationId === conversationId)
    ) ?? null;
  }
  return state.turns.find((turn) =>
    turn.tabId === null &&
    turn.captureMode === mode &&
    turn.pageUrl?.startsWith(location.origin) &&
    (mode !== 'reload' || turn.conversationId === conversationId)
  ) ?? null;
}

function modeLabel(mode: CaptureMode, language: UiLanguage): string {
  return t(language, mode === 'live' ? 'mode.live' : 'mode.reload');
}

function routeSource(turn: RouteTurn | null, language: UiLanguage): string {
  return turn?.routeModelSources.join(' + ') || t(language, 'value.noRouteField');
}

function labelSource(turn: RouteTurn | null, language: UiLanguage): string {
  return turn?.modelLabelSources.join(' + ') || t(language, 'value.noLabelField');
}

function labelValue(turn: RouteTurn | null, language: UiLanguage): string {
  if (turn?.modelLabelConflict) return t(language, 'value.labelConflict');
  return turn?.modelLabel ?? '—';
}

function verdictCopy(turn: RouteTurn | null, mode: CaptureMode, language: UiLanguage): { label: string; tone: string } {
  if (!turn) return { label: t(language, mode === 'live' ? 'result.waitingNext' : 'result.waitingReload'), tone: 'idle' };
  if (turn.verdict === 'normal') return { label: t(language, 'result.normal'), tone: 'normal' };
  if (turn.verdict === 'mismatch') return { label: t(language, 'result.mismatchDetected'), tone: 'danger' };
  if (turn.verdict === 'conflict') return { label: t(language, 'result.actualRouteConflict'), tone: 'danger' };
  if (turn.routeModel) return { label: t(language, 'result.routeRead'), tone: 'warn' };
  if (turn.modelLabel || turn.modelLabelConflict) return { label: t(language, 'result.labelOnly'), tone: 'warn' };
  return { label: t(language, turn.phase === 'completed' ? 'result.routeMissing' : 'result.capturing'), tone: 'warn' };
}

function escapeHtml(value: unknown): string {
  return String(value ?? '—').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char] ?? char);
}

function conversationIdFromPath(): string | null {
  const match = /^\/c\/([^/]+)/.exec(location.pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function hasCurrentDocumentConversationRecord(): boolean {
  if (!state || ownTabId === null) return false;
  const conversationId = conversationIdFromPath();
  if (!conversationId) return false;
  return state.turns.some((turn) =>
    turn.tabId === ownTabId &&
    turn.captureMode === 'reload' &&
    turn.conversationId === conversationId &&
    turn.phase === 'completed' &&
    turn.sources.includes('conversation_record') &&
    Date.parse(turn.observedAt) >= documentStartedAtMs &&
    Boolean(turn.routeModel || turn.modelLabel || turn.modelLabelConflict)
  );
}

async function scanReloadDom(): Promise<void> {
  if (!reloadScanEnabledForDocument || scanRunning || state?.settings.autoCaptureEnabled === false || state?.settings.captureMode !== 'reload') return;
  if (hasCurrentDocumentConversationRecord()) return;
  scanRunning = true;
  try {
    const nodes = [...document.querySelectorAll<HTMLElement>('[data-message-author-role="assistant"][data-message-model-slug]')];
    for (const [index, node] of nodes.entries()) {
      const model = node.getAttribute('data-message-model-slug')?.trim() ?? '';
      if (!model || model.length > 256) continue;
      const messageKey = node.getAttribute('data-message-id') ?? String(index);
      const key = `${location.pathname}\u0000${messageKey}\u0000${model}`;
      if (seenDomRoutes.has(key)) continue;

      const observedAt = new Date().toISOString();
      try {
        const response = await chrome.runtime.sendMessage<RuntimeRequest, RuntimeResponse>({
          type: 'route:observation',
          observation: {
            captureId: crypto.randomUUID(),
            source: 'assistant_dom',
            captureMode: 'reload',
            phase: 'completed',
            observedAt,
            startedAt: observedAt,
            completedAt: observedAt,
            pageUrl: `${location.origin}${location.pathname}`,
            conversationId: conversationIdFromPath(),
            domModelSlug: model
          }
        });
        seenDomRoutes.add(key);
        if (response.state) state = response.state;
      } catch {
        // A transient extension reload leaves the node eligible for a later scan.
      }
    }
    render();
  } finally {
    scanRunning = false;
  }
}

function scheduleReloadDomScan(): void {
  if (scanTimer !== null) return;
  scanTimer = window.setTimeout(() => {
    scanTimer = null;
    void scanReloadDom();
  }, DOM_FALLBACK_DELAY_MS);
}

async function updateSettings(settings: Partial<InspectorState['settings']>): Promise<void> {
  if (settings.captureMode !== undefined) reloadScanEnabledForDocument = false;
  const response = await chrome.runtime.sendMessage<RuntimeRequest, RuntimeResponse>({
    type: 'route:update-settings',
    settings
  });
  if (response.state) {
    state = response.state;
    render();
    scheduleReloadDomScan();
  }
}

function render(): void {
  if (!state?.settings.overlayEnabled) {
    host?.remove();
    host = null;
    return;
  }
  if (!host) {
    host = document.createElement('div');
    host.id = 'chatgpt-route-inspector-root';
    document.documentElement.append(host);
    host.attachShadow({ mode: 'open' });
  }
  const root = host.shadowRoot;
  if (!root) return;
  const language = state.settings.uiLanguage;
  const mode = state.settings.captureMode;
  const turn = currentTurn();
  const copy = verdictCopy(turn, mode, language);
  const routeModel = turn?.verdict === 'conflict' ? t(language, 'result.routeConflict') : turn?.routeModel ?? (turn ? t(language, 'value.unavailable') : null);
  const hint = t(language, mode === 'live' ? 'overlay.liveHint' : 'overlay.reloadHint');
  const requestedModel = turn?.requestedModel ?? (mode === 'reload' && turn ? t(language, 'value.reloadNoRequest') : null);
  root.innerHTML = `
    <style>
      :host{all:initial}*{box-sizing:border-box}.probe{position:fixed;right:18px;bottom:18px;z-index:2147483647;width:356px;color:#f3f5ec;background:#10130f;border:1px solid #404a3b;box-shadow:0 24px 64px rgba(0,0,0,.42);font-family:"Bahnschrift","Avenir Next Condensed",sans-serif}.head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 11px;border-bottom:1px solid #30372d}.brand{display:flex;align-items:center;gap:8px;min-width:0}.brand-copy{display:grid;gap:2px;min-width:0}.brand-line{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 7px}.radar{width:17px;height:17px;border:1px solid #697461;border-radius:50%;position:relative;flex:0 0 auto}.radar:after{content:"";position:absolute;inset:5px;border-radius:50%;background:#a9f04d;box-shadow:0 0 12px #a9f04d}.title{font:700 11px/1.1 "Cascadia Mono",monospace;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}.author{color:#75c5d8;font:700 8px/1.1 "Bahnschrift",sans-serif;text-decoration:none;text-underline-offset:2px;white-space:nowrap}.author:hover{text-decoration:underline}.status{max-width:145px;text-align:right;font:10px/1.25 "Cascadia Mono",monospace;color:${copy.tone === 'normal' ? '#a9f04d' : copy.tone === 'danger' ? '#f07868' : '#efb55d'}}.body{padding:12px}.modes{display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-bottom:9px}.modes button{border:1px solid #30372d;background:#121612;color:#899382;padding:7px 6px;cursor:pointer;font:9px "Cascadia Mono",monospace}.modes button.active{border-color:#a9f04d;color:#a9f04d;background:rgba(169,240,77,.08);box-shadow:inset 3px 0 #a9f04d}.hint{margin:0 1px 9px;color:#899382;font:9px/1.4 "Cascadia Mono",monospace}.route{display:grid;grid-template-columns:1fr 24px 1fr;align-items:center;gap:6px;padding:11px;background:#171b16;border:1px solid #30372d}.model small{display:block;color:#899382;font:8px "Cascadia Mono",monospace;text-transform:uppercase;letter-spacing:.1em}.model b{display:block;margin-top:4px;overflow:hidden;text-overflow:ellipsis;font-size:12px;white-space:nowrap}.arrow{text-align:center;color:#697461}.meta{display:grid;grid-template-columns:70px minmax(0,1fr);gap:5px 8px;margin-top:9px;color:#899382;font:8px/1.4 "Cascadia Mono",monospace}.meta code{color:#75c5d8;overflow-wrap:anywhere}.actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:10px}.actions button{border:1px solid #404a3b;background:#171b16;color:#dfe4d8;padding:7px;cursor:pointer;font:9px "Cascadia Mono",monospace}.actions button:hover{border-color:#a9f04d}.actions .hide{color:#efb55d;border-color:rgba(239,181,93,.55)}.danger .route{border-color:rgba(240,120,104,.65);box-shadow:inset 3px 0 #f07868}.normal .route{border-color:rgba(169,240,77,.45);box-shadow:inset 3px 0 #a9f04d}@media(max-width:560px){.probe{right:8px;bottom:8px;max-width:calc(100vw - 16px)}}
    </style>
    <section class="probe ${copy.tone}">
      <header class="head"><div class="brand"><span class="radar"></span><div class="brand-copy"><div class="brand-line"><span class="title">Route Inspector</span><a class="author" href="${AUTHOR_LINK}" target="_blank" rel="noopener noreferrer">${AUTHOR_TEXT}</a></div></div></div><span class="status">${escapeHtml(copy.label)}</span></header>
      <div class="body"><div class="modes"><button id="mode-live" class="${mode === 'live' ? 'active' : ''}">${escapeHtml(t(language, 'mode.live'))}</button><button id="mode-reload" class="${mode === 'reload' ? 'active' : ''}">${escapeHtml(t(language, 'mode.reload'))}</button></div><p class="hint">${escapeHtml(hint)}</p><div class="route"><div class="model"><small>${escapeHtml(t(language, 'field.requested'))}</small><b>${escapeHtml(requestedModel)}</b></div><div class="arrow">→</div><div class="model"><small>${escapeHtml(t(language, 'field.responseRoute'))}</small><b>${escapeHtml(routeModel)}</b></div></div><div class="meta"><span>${escapeHtml(t(language, 'field.mode'))}</span><code>${escapeHtml(modeLabel(mode, language))}</code><span>${escapeHtml(t(language, 'field.route'))}</span><code>${escapeHtml(routeSource(turn, language))}</code><span>${escapeHtml(t(language, 'field.label'))}</span><code>${escapeHtml(labelValue(turn, language))}</code><span>${escapeHtml(t(language, 'field.labelSource'))}</span><code>${escapeHtml(labelSource(turn, language))}</code><span>${escapeHtml(t(language, 'field.adapter'))}</span><code>${escapeHtml(turn?.sources.join('+') ?? null)}</code></div><div class="actions"><button id="dashboard">${escapeHtml(t(language, 'button.dashboard'))}</button><button id="hide" class="hide">${escapeHtml(t(language, 'overlay.hide'))}</button></div></div>
    </section>`;
  root.getElementById('mode-live')?.addEventListener('click', () => void updateSettings({ captureMode: 'live' }));
  root.getElementById('mode-reload')?.addEventListener('click', () => void updateSettings({ captureMode: 'reload' }));
  root.getElementById('hide')?.addEventListener('click', () => void updateSettings({ overlayEnabled: false }));
  root.getElementById('dashboard')?.addEventListener('click', () => {
    void chrome.runtime.sendMessage<RuntimeRequest>({ type: 'route:open-dashboard' });
  });
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.source !== window || event.origin !== location.origin || !isPageBridgeEnvelope(event.data)) return;
  const envelope = event.data;
  void stateReady.then(async () => {
    if (state?.settings.autoCaptureEnabled === false || state?.settings.captureMode !== envelope.observation.captureMode) return;
    const response = await chrome.runtime.sendMessage<RuntimeRequest, RuntimeResponse>({
      type: 'route:observation',
      observation: envelope.observation
    });
    if (response.state) {
      state = response.state;
      render();
    }
  });
});

chrome.runtime.onMessage.addListener((message: unknown) => {
  if (!message || typeof message !== 'object') return;
  const record = message as Record<string, unknown>;
  if (record.type !== 'route:state-changed' || !record.state) return;
  const next = record.state as InspectorState;
  if (state?.settings.captureMode !== next.settings.captureMode) reloadScanEnabledForDocument = false;
  state = next;
  render();
  scheduleReloadDomScan();
});

const domObserver = new MutationObserver(scheduleReloadDomScan);
function observeDocument(): void {
  if (!document.documentElement) return;
  domObserver.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-message-model-slug']
  });
  scheduleReloadDomScan();
}

if (document.documentElement) observeDocument();
else document.addEventListener('DOMContentLoaded', observeDocument, { once: true });

void stateReady;
