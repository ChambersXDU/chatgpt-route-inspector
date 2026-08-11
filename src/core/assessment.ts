import type { ModelLabelSource, RouteAssessment, RouteFields, RouteModelSource } from './types';

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
  const routeModelSources = presentRoutes.map((candidate) => candidate.source);
  const modelLabelSources = presentLabels.map((candidate) => candidate.source);
  const routeModels = [...new Set(presentRoutes.map((candidate) => candidate.model))];
  const modelLabels = [...new Set(presentLabels.map((candidate) => candidate.model))];
  const modelLabelConflict = modelLabels.length > 1;
  const modelLabel = modelLabelConflict ? null : modelLabels[0] ?? null;
  const reasons: string[] = [];

  if (requested) reasons.push(`请求模型：${requested}`);
  if (fields.defaultModelSlug) reasons.push(`默认模型字段：${fields.defaultModelSlug}（不参与路由判断）`);
  for (const candidate of presentRoutes) reasons.push(`${candidate.source}：${candidate.model}（实际路由字段）`);
  for (const candidate of presentLabels) reasons.push(`${candidate.source}：${candidate.model}（模型标签，不参与路由判断）`);
  if (modelLabelConflict) reasons.push('模型标签字段互相不同，但这不等同于实际路由字段冲突');

  if (routeModels.length > 1) {
    return {
      verdict: 'conflict',
      routeModel: null,
      routeModelSources,
      modelLabel,
      modelLabelSources,
      modelLabelConflict,
      reasons: [...reasons, '响应中的实际路由字段互相冲突']
    };
  }

  const routeModel = routeModels[0] ?? null;
  if (routeModel && modelLabel && routeModel !== modelLabel) {
    reasons.push(`模型标签 ${modelLabel} 与实际响应路由 ${routeModel} 不同；路由结论以实际路由字段为准`);
  }
  if (!routeModel) {
    reasons.push(modelLabel
      ? '只取得模型标签，没有取得实际响应路由字段'
      : '响应中没有可用的实际路由字段');
    return {
      verdict: 'unknown',
      routeModel: null,
      routeModelSources: [],
      modelLabel,
      modelLabelSources,
      modelLabelConflict,
      reasons
    };
  }

  if (!requested) {
    reasons.push('已取得响应路由模型，但当前记录没有对应的请求模型');
    return { verdict: 'unknown', routeModel, routeModelSources, modelLabel, modelLabelSources, modelLabelConflict, reasons };
  }

  const verdict = requested === routeModel ? 'normal' : 'mismatch';
  reasons.push(verdict === 'normal' ? '请求模型与响应路由模型一致' : '请求模型与响应路由模型不一致');
  return { verdict, routeModel, routeModelSources, modelLabel, modelLabelSources, modelLabelConflict, reasons };
}
