import type { ModelLabelSource, ResponseModelSource, RouteAssessment, RouteFields, RouteModelSource } from './types';

function normalized(value: string | null): string | null {
  return value?.trim().toLowerCase() || null;
}

export function assessRoute(fields: RouteFields): RouteAssessment {
  const requested = normalized(fields.requestedModel);
  const routeCandidates: Array<{ source: RouteModelSource; model: string | null }> = [
    { source: 'resolved_model_slug', model: normalized(fields.resolvedModelSlug) },
    { source: 'server_ste_metadata.model_slug', model: normalized(fields.serverModelSlug) }
  ];
  const labelCandidates: Array<{ source: ModelLabelSource; model: string | null }> = [
    { source: 'assistant.metadata.model_slug', model: normalized(fields.responseModelSlug) },
    { source: 'assistant[data-message-model-slug]', model: normalized(fields.domModelSlug) }
  ];
  const presentRoutes = routeCandidates.filter((candidate): candidate is { source: RouteModelSource; model: string } => candidate.model !== null);
  const presentLabels = labelCandidates.filter((candidate): candidate is { source: ModelLabelSource; model: string } => candidate.model !== null);
  const explicitRouteSources = presentRoutes.map((candidate) => candidate.source);
  const modelLabelSources = presentLabels.map((candidate) => candidate.source);
  const routeModels = [...new Set(presentRoutes.map((candidate) => candidate.model))];
  const modelLabels = [...new Set(presentLabels.map((candidate) => candidate.model))];
  const modelLabelConflict = modelLabels.length > 1;
  const modelLabel = modelLabelConflict ? null : modelLabels[0] ?? null;
  const reasons: string[] = [];

  if (requested) reasons.push(`请求模型：${requested}`);
  for (const candidate of presentRoutes) reasons.push(`${candidate.source}：${candidate.model}（显式响应路由字段）`);
  for (const candidate of presentLabels) reasons.push(`${candidate.source}：${candidate.model}（模型标签，仅作显示/旁证）`);
  if (modelLabelConflict) reasons.push('模型标签字段互相不同；不作为显式路由冲突');

  const explicitRouteConflict = routeModels.length > 1;
  if (explicitRouteConflict) {
    return {
      verdict: 'conflict',
      routeModel: null,
      routeModelSources: explicitRouteSources,
      modelLabel,
      modelLabelSources,
      modelLabelConflict,
      reasons: [...reasons, '显式响应路由字段之间存在不一致']
    };
  }

  const routeModel = routeModels[0] ?? null;
  const routeModelSources: ResponseModelSource[] = routeModel ? explicitRouteSources : [];
  if (!routeModel) {
    reasons.push(modelLabel
      ? `没有显式响应路由字段；模型标签 ${modelLabel} 不再当作实际路由`
      : '响应中没有可用的显式响应路由字段');
    return { verdict: 'unknown', routeModel: null, routeModelSources, modelLabel, modelLabelSources, modelLabelConflict, reasons };
  }

  if (modelLabel && modelLabel !== routeModel) {
    reasons.push(`模型标签 ${modelLabel} 与显式路由 ${routeModel} 不同；以显式路由为准`);
  }
  if (!requested) {
    reasons.push('已取得显式响应路由模型，但当前记录没有对应的请求模型');
    return { verdict: 'unknown', routeModel, routeModelSources, modelLabel, modelLabelSources, modelLabelConflict, reasons };
  }

  const verdict = requested === routeModel ? 'normal' : 'mismatch';
  reasons.push(verdict === 'normal' ? '请求模型与显式响应路由模型一致' : '请求模型与显式响应路由模型不一致');
  return { verdict, routeModel, routeModelSources, modelLabel, modelLabelSources, modelLabelConflict, reasons };
}
