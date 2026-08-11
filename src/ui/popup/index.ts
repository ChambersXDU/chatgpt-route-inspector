import { buildMarkdownReport } from '../../core/privacy';
import type { CaptureMode, InspectorState, UiLanguage } from '../../core/types';
import {
  captureModeLabel,
  escapeHtml,
  formatDuration,
  formatTime,
  getState,
  latestForTab,
  modelLabelSourcesLabel,
  modelLabel,
  recordedModelLabel,
  requestedModelLabel,
  routeSourcesLabel,
  send,
  subscribe,
  turnResultLabel,
  verdictTone
} from '../shared/client';
import { applyStaticTranslations, bindLanguageSwitch, t } from '../shared/i18n';

const hero = document.querySelector<HTMLElement>('#hero');
const metrics = document.querySelector<HTMLElement>('#metrics');
const captureStatus = document.querySelector<HTMLElement>('#capture-status');
const recordCount = document.querySelector<HTMLElement>('#record-count');
const modeHint = document.querySelector<HTMLElement>('#mode-hint');
const overlayState = document.querySelector<HTMLElement>('#overlay-state');
let activeTabId: number | undefined;
let state: InspectorState;

function toast(message: string): void {
  const element = document.querySelector<HTMLElement>('#toast');
  if (!element) return;
  element.textContent = message;
  element.classList.add('show');
  window.setTimeout(() => element.classList.remove('show'), 1800);
}

function render(next: InspectorState): void {
  state = next;
  const language = state.settings.uiLanguage;
  const mode = state.settings.captureMode;
  const turn = latestForTab(state, activeTabId, mode);
  applyStaticTranslations(language);
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === mode);
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-overlay]').forEach((button) => {
    const active = (button.dataset.overlay === 'show') === state.settings.overlayEnabled;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (overlayState) overlayState.textContent = t(language, state.settings.overlayEnabled ? 'overlay.visible' : 'overlay.hidden');
  if (modeHint) modeHint.textContent = t(language, mode === 'live' ? 'mode.liveHint' : 'mode.reloadHint');
  if (recordCount) recordCount.textContent = t(language, 'footer.records', { count: state.turns.length });
  if (captureStatus) {
    captureStatus.textContent = !state.settings.autoCaptureEnabled
      ? t(language, 'status.paused')
      : t(language, mode === 'live' ? 'status.liveListening' : turn ? 'status.reloadCaptured' : 'status.waitingReload');
    captureStatus.className = `signal-pill ${state.settings.autoCaptureEnabled ? 'live' : ''}`;
  }
  if (hero) {
    const tone = verdictTone(turn?.verdict ?? 'unknown');
    const rightModel = turn?.verdict === 'conflict'
      ? t(language, 'result.routeConflict')
      : turn?.routeModel ? modelLabel(turn.routeModel, language) : turn ? t(language, 'value.unavailable') : t(language, 'result.waiting');
    hero.innerHTML = `<div class="eyebrow">${escapeHtml(captureModeLabel(mode, language))} / ${turn ? escapeHtml(formatTime(turn.observedAt, language)) : escapeHtml(t(language, 'value.waiting'))}</div><div class="route-lockup"><div class="route-model"><small>${escapeHtml(t(language, 'field.requested'))}</small><strong>${escapeHtml(requestedModelLabel(turn, language))}</strong></div><div class="route-arrow">→</div><div class="route-model"><small>${escapeHtml(t(language, 'field.responseRoute'))}</small><strong>${escapeHtml(rightModel)}</strong></div></div><div class="verdict-line"><b class="${tone}-text">${escapeHtml(turnResultLabel(turn, language))}</b><span class="tag ${tone}">${escapeHtml(captureModeLabel(mode, language))}</span></div><div class="route-source-line"><span>${escapeHtml(t(language, 'field.route'))}</span><code>${escapeHtml(routeSourcesLabel(turn, language))}</code></div><div class="route-source-line"><span>${escapeHtml(t(language, 'field.label'))}</span><code>${escapeHtml(recordedModelLabel(turn, language))} · ${escapeHtml(modelLabelSourcesLabel(turn, language))}</code></div>`;
  }
  if (metrics) metrics.innerHTML = `<div class="metric"><span class="metric-label">${escapeHtml(t(language, 'field.mode'))}</span><span class="metric-value">${escapeHtml(captureModeLabel(mode, language))}</span></div><div class="metric"><span class="metric-label">${escapeHtml(t(language, 'field.duration'))}</span><span class="metric-value">${escapeHtml(formatDuration(turn?.durationMs ?? null))}</span></div><div class="metric"><span class="metric-label">${escapeHtml(t(language, 'field.adapter'))}</span><span class="metric-value">${escapeHtml(turn?.sources.join('+') ?? '—')}</span></div>`;
}

async function setLanguage(uiLanguage: UiLanguage): Promise<void> {
  if (state?.settings.uiLanguage === uiLanguage) return;
  const response = await send({ type: 'route:update-settings', settings: { uiLanguage } });
  if (response.state) render(response.state);
}

async function setMode(mode: CaptureMode): Promise<void> {
  const response = await send({ type: 'route:update-settings', settings: { captureMode: mode } });
  if (response.state) render(response.state);
  const language = response.state?.settings.uiLanguage ?? state.settings.uiLanguage;
  toast(t(language, mode === 'live' ? 'toast.modeLive' : 'toast.modeReload'));
}

async function setOverlayEnabled(overlayEnabled: boolean): Promise<void> {
  const response = await send({ type: 'route:update-settings', settings: { overlayEnabled } });
  if (response.state) render(response.state);
  const language = response.state?.settings.uiLanguage ?? state.settings.uiLanguage;
  toast(t(language, overlayEnabled ? 'toast.overlayShown' : 'toast.overlayHidden'));
}

bindLanguageSwitch(setLanguage);
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => button.addEventListener('click', () => {
  const mode = button.dataset.mode;
  if (mode === 'live' || mode === 'reload') void setMode(mode);
}));
document.querySelectorAll<HTMLButtonElement>('[data-overlay]').forEach((button) => button.addEventListener('click', () => {
  void setOverlayEnabled(button.dataset.overlay === 'show');
}));
document.querySelector('#dashboard')?.addEventListener('click', () => void send({ type: 'route:open-dashboard' }));
document.querySelector('#options')?.addEventListener('click', () => void chrome.runtime.openOptionsPage());
document.querySelector('#copy')?.addEventListener('click', async () => {
  const turn = latestForTab(state, activeTabId, state.settings.captureMode);
  if (!turn) return toast(t(state.settings.uiLanguage, 'toast.noRecord'));
  await navigator.clipboard.writeText(buildMarkdownReport({ ...state, turns: [turn] }, state.settings.uiLanguage));
  toast(t(state.settings.uiLanguage, 'toast.summaryCopied'));
});

void (async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tabs[0]?.id;
  render(await getState());
  subscribe(render);
})();
