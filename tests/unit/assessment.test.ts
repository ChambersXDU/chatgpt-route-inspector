import { describe, expect, it } from 'vitest';
import { assessRoute } from '../../src/core/assessment';
import { EMPTY_ROUTE_FIELDS } from '../../src/core/types';

describe('assessRoute', () => {
  it('reports a mismatch when every explicit response route field resolves to mini', () => {
    const result = assessRoute({
      ...EMPTY_ROUTE_FIELDS,
      requestedModel: 'gpt-5-6-pro',
      resolvedModelSlug: 'gpt-5-5-mini',
      serverModelSlug: 'gpt-5-5-mini'
    });
    expect(result).toMatchObject({
      verdict: 'mismatch',
      routeModel: 'gpt-5-5-mini',
      routeModelSources: ['resolved_model_slug', 'server_ste_metadata.model_slug']
    });
  });

  it('reports normal when requested and response route models agree', () => {
    const result = assessRoute({
      ...EMPTY_ROUTE_FIELDS,
      requestedModel: 'GPT-5-6-PRO ',
      resolvedModelSlug: 'gpt-5-6-pro'
    });
    expect(result).toMatchObject({
      verdict: 'normal',
      routeModel: 'gpt-5-6-pro',
      routeModelSources: ['resolved_model_slug']
    });
  });

  it('reports conflict only when explicit response route fields disagree', () => {
    const result = assessRoute({
      ...EMPTY_ROUTE_FIELDS,
      requestedModel: 'gpt-5-6-pro',
      resolvedModelSlug: 'gpt-5-6-pro',
      serverModelSlug: 'gpt-5-5-mini'
    });
    expect(result).toMatchObject({
      verdict: 'conflict',
      routeModel: null,
      routeModelSources: ['resolved_model_slug', 'server_ste_metadata.model_slug']
    });
  });

  it('ignores default_model_slug completely', () => {
    const result = assessRoute({
      ...EMPTY_ROUTE_FIELDS,
      defaultModelSlug: 'gpt-5-6-pro',
      resolvedModelSlug: 'gpt-5-5-mini'
    });
    expect(result).toMatchObject({ verdict: 'unknown', routeModel: 'gpt-5-5-mini' });
    expect(result.reasons.join(' ')).not.toContain('default');
    expect(result.reasons.join(' ')).not.toContain('默认模型');
  });

  it('keeps assistant.metadata.model_slug as a label instead of an actual route fallback', () => {
    const result = assessRoute({
      ...EMPTY_ROUTE_FIELDS,
      requestedModel: 'gpt-5-6-pro',
      responseModelSlug: 'gpt-5-6-pro'
    });
    expect(result).toMatchObject({
      verdict: 'unknown',
      routeModel: null,
      routeModelSources: [],
      modelLabel: 'gpt-5-6-pro',
      modelLabelSources: ['assistant.metadata.model_slug']
    });
  });

  it('does not call a label-only difference a route mismatch', () => {
    const result = assessRoute({
      ...EMPTY_ROUTE_FIELDS,
      requestedModel: 'gpt-5-6-pro',
      responseModelSlug: 'gpt-5-5-mini'
    });
    expect(result).toMatchObject({
      verdict: 'unknown',
      routeModel: null,
      routeModelSources: [],
      modelLabel: 'gpt-5-5-mini'
    });
  });

  it('keeps a reload assistant label visible but unverified', () => {
    const result = assessRoute({ ...EMPTY_ROUTE_FIELDS, responseModelSlug: 'gpt-5-5-mini' });
    expect(result).toMatchObject({
      verdict: 'unknown',
      routeModel: null,
      routeModelSources: [],
      modelLabel: 'gpt-5-5-mini',
      modelLabelSources: ['assistant.metadata.model_slug']
    });
  });

  it('keeps the rendered assistant model visible but unverified after reload', () => {
    const result = assessRoute({ ...EMPTY_ROUTE_FIELDS, domModelSlug: 'gpt-5-6-pro' });
    expect(result).toMatchObject({
      verdict: 'unknown',
      routeModel: null,
      routeModelSources: [],
      modelLabel: 'gpt-5-6-pro',
      modelLabelSources: ['assistant[data-message-model-slug]']
    });
  });

  it('reports a label inconsistency without calling it a route conflict', () => {
    const result = assessRoute({
      ...EMPTY_ROUTE_FIELDS,
      responseModelSlug: 'gpt-5-6-pro',
      domModelSlug: 'gpt-5-5-mini'
    });
    expect(result).toMatchObject({
      verdict: 'unknown',
      routeModel: null,
      routeModelSources: [],
      modelLabel: null,
      modelLabelConflict: true,
      modelLabelSources: ['assistant.metadata.model_slug', 'assistant[data-message-model-slug]']
    });
  });

  it('uses explicit routing when the model label still names the requested model', () => {
    const result = assessRoute({
      ...EMPTY_ROUTE_FIELDS,
      requestedModel: 'gpt-5-6-thinking',
      responseModelSlug: 'gpt-5-6-thinking',
      serverModelSlug: 'gpt-5-5-mini'
    });
    expect(result).toMatchObject({
      verdict: 'mismatch',
      routeModel: 'gpt-5-5-mini',
      routeModelSources: ['server_ste_metadata.model_slug'],
      modelLabel: 'gpt-5-6-thinking',
      modelLabelConflict: false
    });
    expect(result.reasons.join(' ')).toContain('以显式路由为准');
  });

  it('does not let a stale label override a matching explicit route', () => {
    const result = assessRoute({
      ...EMPTY_ROUTE_FIELDS,
      requestedModel: 'gpt-5-5-mini',
      responseModelSlug: 'gpt-5-6-pro',
      resolvedModelSlug: 'gpt-5-5-mini'
    });
    expect(result).toMatchObject({
      verdict: 'normal',
      routeModel: 'gpt-5-5-mini',
      routeModelSources: ['resolved_model_slug'],
      modelLabel: 'gpt-5-6-pro'
    });
  });

  it('stays unknown when no explicit response route model exists', () => {
    expect(assessRoute({ ...EMPTY_ROUTE_FIELDS, requestedModel: 'gpt-5-6-pro' })).toMatchObject({
      verdict: 'unknown', routeModel: null, routeModelSources: []
    });
  });
});
