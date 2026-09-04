import { latestTurnForTab } from '../../core/current-route';
import type { InspectorState } from '../../core/types';
import {
  escapeHtml,
  formatDuration,
  formatTime,
  getState,
  modelLabel,
  modelLabelSourcesLabel,
  recordedModelLabel,
  routeSourcesLabel,
  subscribe
} from '../shared/client';

const currentModel = document.querySelector<HTMLElement>('#current-model');
const currentMeta = document.querySelector<HTMLElement>('#current-meta');
const advancedContent = document.querySelector<HTMLElement>('#advanced-content');
const captureStatus = document.querySelector<HTMLElement>('#capture-status');
let activeTabId: number | undefined;
let state: InspectorState;

function routedModel() {
  const turn = latestTurnForTab(state, activeTabId);
  if (!turn) return '尚未捕获';
  if ((turn.phase === 'requested' || turn.phase === 'responding') && !turn.routeModel && !turn.modelLabel) {
    return '正在获取…';
  }
  if (turn.verdict === 'conflict') return '路由字段冲突';
  if (turn.routeModel) return modelLabel(turn.routeModel, 'zh');
  if (turn.modelLabel || turn.modelLabelConflict) return recordedModelLabel(turn, 'zh');
  return '暂未读取到模型';
}

function triggerLabel(captureMode: 'live' | 'reload'): string {
  return captureMode === 'live' ? '新消息' : '重新加载';
}

function row(label: string, value: string): string {
  return `<div class="advanced-row"><span>${escapeHtml(label)}</span><code>${escapeHtml(value)}</code></div>`;
}

function render(next: InspectorState): void {
  state = next;
  const turn = latestTurnForTab(state, activeTabId);

  if (currentModel) currentModel.textContent = routedModel();
  if (currentMeta) {
    currentMeta.textContent = turn
      ? `${triggerLabel(turn.captureMode)} · ${formatTime(turn.observedAt, 'zh')}`
      : '重新加载当前对话，或发送一条新消息后自动显示';
  }

  if (captureStatus) {
    const pending = Boolean(turn && (turn.phase === 'requested' || turn.phase === 'responding') && !turn.routeModel && !turn.modelLabel);
    captureStatus.textContent = !state.settings.autoCaptureEnabled
      ? '已暂停'
      : pending
        ? '正在识别'
        : turn
          ? '已更新'
          : '等待捕获';
    captureStatus.className = `signal-pill ${state.settings.autoCaptureEnabled ? 'live' : ''}`;
  }

  if (advancedContent) {
    if (!turn) {
      advancedContent.innerHTML = '<div class="current-meta">暂无高级信息。</div>';
    } else {
      const routeSource = routeSourcesLabel(turn, 'zh');
      const label = recordedModelLabel(turn, 'zh');
      const labelSource = modelLabelSourcesLabel(turn, 'zh');
      advancedContent.innerHTML = [
        row('触发方式', triggerLabel(turn.captureMode)),
        row('路由来源', routeSource),
        row('模型标签', label),
        row('标签来源', labelSource),
        row('耗时', formatDuration(turn.durationMs)),
        row('采集来源', turn.sources.join(' + '))
      ].join('');
    }
  }
}

document.querySelector('#options')?.addEventListener('click', () => void chrome.runtime.openOptionsPage());

void (async () => {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTabId = tabs[0]?.id;
  render(await getState());
  subscribe(render);
})();
