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

  it('reports conflict instead of choosing between disagreeing response fields', () => {
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

  it('does not pretend default_model_slug was the requested model', () => {
    const result = assessRoute({
      ...EMPTY_ROUTE_FIELDS,
      defaultModelSlug: 'gpt-5-6-pro',
      resolvedModelSlug: 'gpt-5-5-mini'
    });
    expect(result).toMatchObject({ verdict: 'unknown', routeModel: 'gpt-5-5-mini' });
    expect(result.reasons.join(' ')).toContain('不参与路由判断');
  });

  it('keeps assistant.metadata.model_slug as a label instead of a route field', () => {
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

  it('does not promote a reload assistant label into a response route', () => {
    const result = assessRoute({ ...EMPTY_ROUTE_FIELDS, responseModelSlug: 'gpt-5-5-mini' });
    expect(result).toMatchObject({
      verdict: 'unknown',
      routeModel: null,
      routeModelSources: [],
      modelLabel: 'gpt-5-5-mini',
      modelLabelSources: ['assistant.metadata.model_slug']
    });
  });

  it('keeps the rendered assistant model as a label after reload', () => {
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

  it('uses actual route fields when a Pro label accompanies an Instant route', () => {
    const result = assessRoute({
      ...EMPTY_ROUTE_FIELDS,
      requestedModel: 'gpt-5-6-pro',
      responseModelSlug: 'gpt-5-6-pro',
      resolvedModelSlug: 'gpt-5-5-instant',
      serverModelSlug: 'gpt-5-5-instant'
    });
    expect(result).toMatchObject({
      verdict: 'mismatch',
      routeModel: 'gpt-5-5-instant',
      routeModelSources: ['resolved_model_slug', 'server_ste_metadata.model_slug'],
      modelLabel: 'gpt-5-6-pro',
      modelLabelConflict: false
    });
  });

  it('stays unknown when no response route model exists', () => {
    expect(assessRoute({ ...EMPTY_ROUTE_FIELDS, requestedModel: 'gpt-5-6-pro' })).toMatchObject({
      verdict: 'unknown', routeModel: null, routeModelSources: []
    });
  });
});
