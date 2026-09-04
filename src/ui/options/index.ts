import type { InspectorState } from '../../core/types';
import { getState, send, subscribe } from '../shared/client';

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
  document.documentElement.lang = 'zh-CN';
  if (!syncControls) return;
  input<HTMLInputElement>('#auto').checked = state.settings.autoCaptureEnabled;
  input<HTMLInputElement>('#overlay').checked = state.settings.overlayEnabled;
  input<HTMLInputElement>('#retention').value = String(state.settings.retentionLimit);
  input<HTMLSelectElement>('#ids').value = String(state.settings.includeRequestIdsInExport);
}

input<HTMLButtonElement>('#save').addEventListener('click', async () => {
  const retentionLimit = Math.max(10, Math.min(500, Number(input<HTMLInputElement>('#retention').value) || 100));
  const response = await send({
    type: 'route:update-settings',
    settings: {
      autoCaptureEnabled: input<HTMLInputElement>('#auto').checked,
      overlayEnabled: input<HTMLInputElement>('#overlay').checked,
      retentionLimit,
      includeRequestIdsInExport: input<HTMLSelectElement>('#ids').value === 'true'
    }
  });
  if (response.state) render(response.state, true);
  toast('设置已保存。');
});

input<HTMLButtonElement>('#dashboard').addEventListener('click', () => void send({ type: 'route:open-dashboard' }));

input<HTMLButtonElement>('#clear').addEventListener('click', async () => {
  if (!confirm('清空全部本地路由记录？此操作无法撤销。')) return;
  const response = await send({ type: 'route:clear' });
  if (response.state) render(response.state, true);
  toast('本地记录已清空。');
});

void getState().then((initial) => {
  render(initial, true);
  subscribe((next) => render(next));
});
