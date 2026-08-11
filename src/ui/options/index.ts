import type { InspectorState } from '../../core/types';
import { getState, send, subscribe } from '../shared/client';
import { applyStaticTranslations, bindLanguageSwitch, t } from '../shared/i18n';

let state: InspectorState;

function input<T extends HTMLElement>(selector: string): T {
  return document.querySelector<T>(selector)!;
}

function toast(message: string): void {
  const element = input<HTMLElement>('#toast');
  element.textContent = message;
  element.classList.add('show');
  window.setTimeout(() => element.classList.remove('show'), 1800);
}

function render(next: InspectorState, syncControls = false): void {
  state = next;
  applyStaticTranslations(state.settings.uiLanguage);
  if (!syncControls) return;
  input<HTMLInputElement>('#auto').checked = state.settings.autoCaptureEnabled;
  input<HTMLSelectElement>('#mode').value = state.settings.captureMode;
  input<HTMLInputElement>('#retention').value = String(state.settings.retentionLimit);
  input<HTMLSelectElement>('#ids').value = String(state.settings.includeRequestIdsInExport);
}

bindLanguageSwitch(async (uiLanguage) => {
  if (state?.settings.uiLanguage === uiLanguage) return;
  const response = await send({ type: 'route:update-settings', settings: { uiLanguage } });
  if (response.state) render(response.state);
});

input<HTMLButtonElement>('#save').addEventListener('click', async () => {
  const retentionLimit = Math.max(10, Math.min(500, Number(input<HTMLInputElement>('#retention').value) || 100));
  const captureMode = input<HTMLSelectElement>('#mode').value === 'reload' ? 'reload' : 'live';
  const response = await send({
    type: 'route:update-settings',
    settings: {
      autoCaptureEnabled: input<HTMLInputElement>('#auto').checked,
      captureMode,
      retentionLimit,
      includeRequestIdsInExport: input<HTMLSelectElement>('#ids').value === 'true'
    }
  });
  if (response.state) render(response.state, true);
  toast(t(state.settings.uiLanguage, 'toast.settingsSaved'));
});

input<HTMLButtonElement>('#clear').addEventListener('click', async () => {
  if (!confirm(t(state.settings.uiLanguage, 'confirm.clearAll'))) return;
  const response = await send({ type: 'route:clear' });
  if (response.state) render(response.state, true);
  toast(t(state.settings.uiLanguage, 'toast.cleared'));
});

void getState().then((initial) => {
  render(initial, true);
  subscribe((next) => render(next));
});
