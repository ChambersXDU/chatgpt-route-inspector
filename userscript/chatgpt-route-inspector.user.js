// ==UserScript==
// @name         ChatGPT Route Inspector（油猴版）
// @namespace    https://github.com/ChambersXDU/chatgpt-route-inspector
// @version      1.0.7
// @description  自动显示当前 ChatGPT 实际路由模型；刷新已有对话或发送新消息后自动更新。
// @author       ChambersXDU
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// @sandbox      raw
// @grant        none
// @noframes
// @homepageURL  https://github.com/ChambersXDU/chatgpt-route-inspector
// @supportURL   https://github.com/ChambersXDU/chatgpt-route-inspector/issues
// @updateURL    https://raw.githubusercontent.com/ChambersXDU/chatgpt-route-inspector/main/userscript/chatgpt-route-inspector.user.js
// @downloadURL  https://raw.githubusercontent.com/ChambersXDU/chatgpt-route-inspector/main/userscript/chatgpt-route-inspector.user.js
// ==/UserScript==

(() => {
  'use strict';

  const nativeFetch = window.fetch;
  const MAX_RECORD_BYTES = 8 * 1024 * 1024;
  const MAX_STREAM_EVENT_BYTES = 1024 * 1024;
  const ROUTE_HOSTS = new Set(['chatgpt.com', 'chat.openai.com']);

  const emptyFields = () => ({
    requestedModel: null,
    responseModelSlug: null,
    defaultModelSlug: null,
    resolvedModelSlug: null,
    serverModelSlug: null,
    requestId: null,
    conversationId: null
  });

  function asRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
  }

  function stringValue(value) {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  function normalized(value) {
    return stringValue(value)?.trim().toLowerCase() || null;
  }

  function identifier(value) {
    return stringValue(value) ?? stringValue(asRecord(value)?.id);
  }

  function mergeFields(...items) {
    const result = emptyFields();
    for (const item of items) {
      if (!item) continue;
      for (const [key, value] of Object.entries(item)) {
        if (value !== null && value !== undefined) result[key] = value;
      }
    }
    return result;
  }

  function extractMetadata(metadata, modelKind = 'none') {
    const model = stringValue(metadata?.model_slug);
    return {
      responseModelSlug: modelKind === 'assistant' ? model : null,
      serverModelSlug: modelKind === 'server' ? model : null,
      defaultModelSlug: stringValue(metadata?.default_model_slug),
      resolvedModelSlug: stringValue(metadata?.resolved_model_slug),
      requestId: stringValue(metadata?.request_id),
      conversationId: stringValue(metadata?.conversation_id)
    };
  }

  function walkForFields(value, accumulator = emptyFields(), depth = 0, budget = { count: 0 }) {
    if (depth > 10 || budget.count > 3000) return accumulator;
    budget.count += 1;
    if (Array.isArray(value)) {
      return value.reduce((result, item) => walkForFields(item, result, depth + 1, budget), accumulator);
    }
    const record = asRecord(value);
    if (!record) return accumulator;

    let result = accumulator;
    const metadata = asRecord(record.metadata);
    if (record.type === 'server_ste_metadata' && metadata) {
      result = mergeFields(result, extractMetadata(metadata, 'server'));
    } else {
      result = mergeFields(result, extractMetadata(record));
      if (metadata) {
        const author = asRecord(record.author);
        result = mergeFields(result, extractMetadata(metadata, author?.role === 'assistant' ? 'assistant' : 'none'));
      }
    }
    if (typeof record.conversation_id === 'string') {
      result = mergeFields(result, { conversationId: record.conversation_id });
    }
    for (const [key, nested] of Object.entries(record)) {
      if (record.type === 'server_ste_metadata' && key === 'metadata') continue;
      if (nested && typeof nested === 'object') result = walkForFields(nested, result, depth + 1, budget);
    }
    return result;
  }

  function parseSseResponse(raw) {
    let fields = emptyFields();
    for (const line of raw.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      try {
        fields = walkForFields(JSON.parse(payload), fields);
      } catch {
        // Ignore incomplete streaming fragments until a complete event arrives.
      }
    }
    return fields;
  }

  function messageFields(message) {
    const author = asRecord(message?.author);
    const metadata = asRecord(message?.metadata);
    if (!metadata) return emptyFields();
    let fields = mergeFields(emptyFields(), extractMetadata(metadata, author?.role === 'assistant' ? 'assistant' : 'none'));
    const nested = asRecord(metadata.server_ste_metadata);
    if (nested) fields = mergeFields(fields, extractMetadata(nested, 'server'));
    return fields;
  }

  function hasModelEvidence(fields) {
    return Boolean(fields.responseModelSlug || fields.resolvedModelSlug || fields.serverModelSlug);
  }

  function parseConversationRecord(value) {
    const root = asRecord(value);
    const mapping = asRecord(root?.mapping);
    const messages = Array.isArray(root?.messages) ? root.messages : null;
    if (!mapping && !messages) return [];

    const nodes = [];
    const nodesById = new Map();
    const rawNodes = mapping ? Object.entries(mapping) : messages.map((message, index) => [String(index), message]);
    for (const [key, rawNode] of rawNodes) {
      const node = asRecord(rawNode);
      const nestedMessage = asRecord(node?.message);
      const message = nestedMessage ?? node;
      const author = asRecord(message?.author);
      const parsed = {
        key,
        messageId: stringValue(message?.id) ?? key,
        parentId: identifier(node?.parent) ?? identifier(message?.parent_id),
        role: stringValue(author?.role),
        fields: message ? messageFields(message) : emptyFields()
      };
      nodes.push(parsed);
      nodesById.set(key, parsed);
      nodesById.set(parsed.messageId, parsed);
    }

    const fieldsForAssistant = (node) => {
      let fields = node.fields;
      let parentId = node.parentId;
      const visited = new Set([node.key, node.messageId]);
      for (let depth = 0; parentId && depth < 64; depth += 1) {
        if (visited.has(parentId)) break;
        visited.add(parentId);
        const parent = nodesById.get(parentId);
        if (!parent) break;
        fields = mergeFields(parent.fields, fields);
        if (parent.role === 'user') break;
        parentId = parent.parentId;
      }
      return fields;
    };

    const currentNodeId = identifier(root?.current_node);
    if (currentNodeId) {
      let node = nodesById.get(currentNodeId) ?? null;
      const visited = new Set();
      for (let depth = 0; node && depth < 64; depth += 1) {
        if (visited.has(node.key)) break;
        visited.add(node.key);
        if (node.role === 'assistant') {
          const fields = fieldsForAssistant(node);
          return hasModelEvidence(fields) ? [fields] : [];
        }
        node = node.parentId ? nodesById.get(node.parentId) ?? null : null;
      }
      if (messages) return [];
    }

    return nodes
      .filter((node) => node.role === 'assistant')
      .map(fieldsForAssistant)
      .filter(hasModelEvidence);
  }

  function parseResponseText(raw) {
    if (/^\s*data:/m.test(raw)) return [parseSseResponse(raw)];
    try {
      const parsed = JSON.parse(raw);
      const conversation = parseConversationRecord(parsed);
      return conversation.length > 0 ? conversation : [walkForFields(parsed)];
    } catch {
      return [];
    }
  }

  function parseRequestBody(raw) {
    if (!raw) return emptyFields();
    try {
      const parsed = JSON.parse(raw);
      const message = Array.isArray(parsed?.messages) ? parsed.messages.at(-1) : null;
      return mergeFields(emptyFields(), {
        requestedModel: stringValue(parsed?.model) ?? stringValue(parsed?.model_slug) ?? stringValue(message?.metadata?.model_slug),
        conversationId: stringValue(parsed?.conversation_id)
      });
    } catch {
      return emptyFields();
    }
  }

  function classifyEndpoint(input) {
    let url;
    try {
      url = new URL(input, location.href);
    } catch {
      return { kind: 'other', conversationId: null };
    }
    if (!ROUTE_HOSTS.has(url.hostname)) return { kind: 'other', conversationId: null };
    if (/^\/backend-api\/f\/conversations?$/.test(url.pathname)) {
      return { kind: 'conversation_stream', conversationId: null };
    }
    const record = /^\/backend-api\/conversations?\/([^/]+)$/.exec(url.pathname);
    if (record?.[1]) return { kind: 'conversation_record', conversationId: decodeURIComponent(record[1]) };
    return { kind: 'other', conversationId: null };
  }

  function requestUrl(input) {
    return input instanceof Request ? input.url : String(input);
  }

  async function requestBody(input, init) {
    if (typeof init?.body === 'string') return init.body;
    if (input instanceof Request) {
      try {
        return await input.clone().text();
      } catch {
        return null;
      }
    }
    return null;
  }

  function modelLabel(model) {
    if (!model) return '—';
    return model
      .replace(/^gpt-/, 'GPT ')
      .replace(/-(\d)/g, '.$1')
      .replace(/-pro$/i, ' Pro')
      .replace(/-thinking$/i, ' Thinking')
      .replace(/-mini$/i, ' mini')
      .replace(/-instant$/i, ' Instant')
      .replace(/-sol$/i, ' Sol');
  }

  function routeReading(fields, trigger, phase) {
    const explicit = [
      fields.resolvedModelSlug ? { source: 'resolved_model_slug', model: normalized(fields.resolvedModelSlug) } : null,
      fields.serverModelSlug ? { source: 'server_ste_metadata.model_slug', model: normalized(fields.serverModelSlug) } : null
    ].filter(Boolean);
    const explicitModels = [...new Set(explicit.map((item) => item.model).filter(Boolean))];
    const conflict = explicitModels.length > 1;
    const routeModel = conflict ? null : explicitModels[0] ?? null;
    const requestedModel = normalized(fields.requestedModel);
    const modelTag = normalized(fields.responseModelSlug);
    return {
      routeModel,
      conflict,
      mismatch: Boolean(routeModel && requestedModel && routeModel !== requestedModel),
      requestedModel,
      modelTag,
      routeSources: explicit.map((item) => item.source),
      trigger,
      phase,
      observedAt: new Date().toISOString()
    };
  }

  let currentReading = null;
  let rootHost = null;
  let pill = null;
  let panel = null;
  let modelValue = null;
  let metaValue = null;
  let alertValue = null;
  let sourceValue = null;
  let requestValue = null;
  let labelValue = null;

  function visibleRouteLabel() {
    if (!currentReading) return '尚未捕获';
    if (currentReading.conflict) return '路由字段冲突';
    const pending = ['requested', 'responding'].includes(currentReading.phase) && !currentReading.routeModel;
    if (pending) return '正在获取…';
    if (currentReading.routeModel) return modelLabel(currentReading.routeModel);
    if (currentReading.modelTag) return '未验证';
    return '尚未捕获';
  }

  function render() {
    if (!pill) return;
    const label = visibleRouteLabel();
    pill.textContent = `路由模型 · ${label}`;
    if (modelValue) modelValue.textContent = label;
    if (metaValue) {
      metaValue.textContent = currentReading
        ? `${currentReading.trigger} · ${new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(currentReading.observedAt))}`
        : '刷新当前对话，或发送一条新消息后自动显示';
    }
    if (alertValue) {
      alertValue.textContent = currentReading?.mismatch ? '请求模型与服务器路由不一致' : '';
      alertValue.hidden = !currentReading?.mismatch;
    }
    if (sourceValue) sourceValue.textContent = currentReading?.routeSources.join(' + ') || '—';
    if (requestValue) requestValue.textContent = modelLabel(currentReading?.requestedModel ?? null);
    if (labelValue) labelValue.textContent = modelLabel(currentReading?.modelTag ?? null);
  }

  function mountUi() {
    if (rootHost?.isConnected) return;
    if (!document.documentElement) {
      document.addEventListener('readystatechange', mountUi, { once: true });
      return;
    }
    rootHost = document.createElement('div');
    rootHost.dataset.routeInspectorRoot = 'userscript';
    rootHost.style.cssText = 'all:initial;position:fixed;right:18px;bottom:18px;z-index:2147483647;';
    const shadow = rootHost.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host{all:initial}.wrap{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:#202123}
        button{font:500 12px/1.2 inherit;border:1px solid #dedede;background:#fff;color:#202123;border-radius:999px;padding:9px 12px;box-shadow:0 4px 18px rgba(0,0,0,.08);cursor:pointer}
        button:hover{background:#f7f7f8}.panel{display:none;position:absolute;right:0;bottom:42px;width:310px;background:#fff;border:1px solid #e5e5e5;border-radius:14px;box-shadow:0 12px 36px rgba(0,0,0,.12);padding:14px}
        .panel.open{display:block}.label{font-size:11px;color:#777}.model{margin-top:6px;font-size:22px;font-weight:650;letter-spacing:-.02em;overflow-wrap:anywhere}.meta{margin-top:7px;font-size:11px;color:#777;line-height:1.45}
        .alert{margin-top:10px;padding:8px 10px;border-radius:9px;background:#f5f5f5;font-size:11px;font-weight:600}.rows{margin-top:12px;border-top:1px solid #eee}.row{display:grid;grid-template-columns:76px 1fr;gap:8px;padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:11px}.row span{color:#888}.row code{font:500 11px/1.4 inherit;overflow-wrap:anywhere}
        .foot{margin-top:10px;color:#999;font-size:10px;line-height:1.45}
      </style>
      <div class="wrap">
        <div class="panel" id="panel">
          <div class="label">当前实际路由</div>
          <div class="model" id="model">尚未捕获</div>
          <div class="meta" id="meta">刷新当前对话，或发送一条新消息后自动显示</div>
          <div class="alert" id="alert" hidden></div>
          <div class="rows">
            <div class="row"><span>请求模型</span><code id="request">—</code></div>
            <div class="row"><span>模型标签</span><code id="label-value">—</code></div>
            <div class="row"><span>路由来源</span><code id="source">—</code></div>
          </div>
          <div class="foot">server_ste_metadata / resolved_model_slug 用作显式路由证据；assistant model_slug 仅作为模型标签，不再参与路由冲突判定。</div>
        </div>
        <button id="pill" type="button">路由模型 · 尚未捕获</button>
      </div>`;
    pill = shadow.querySelector('#pill');
    panel = shadow.querySelector('#panel');
    modelValue = shadow.querySelector('#model');
    metaValue = shadow.querySelector('#meta');
    alertValue = shadow.querySelector('#alert');
    sourceValue = shadow.querySelector('#source');
    requestValue = shadow.querySelector('#request');
    labelValue = shadow.querySelector('#label-value');
    pill.addEventListener('click', () => panel.classList.toggle('open'));
    document.documentElement.append(rootHost);
    render();
  }

  function update(fields, trigger, phase) {
    currentReading = routeReading(fields, trigger, phase);
    mountUi();
    render();
  }

  async function parseLiveStream(response, baseFields) {
    if (!response.body) {
      const raw = await response.text();
      const parsed = parseResponseText(raw)[0];
      update(mergeFields(baseFields, parsed), '新消息', 'completed');
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fields = baseFields;
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > MAX_STREAM_EVENT_BYTES && !buffer.includes('\n')) {
        await reader.cancel('route event too large');
        return;
      }
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const parsed = parseSseResponse(line);
        fields = mergeFields(fields, parsed);
        if (hasModelEvidence(fields)) update(fields, '新消息', 'responding');
      }
      if (done) break;
    }
    if (buffer.startsWith('data:')) fields = mergeFields(fields, parseSseResponse(buffer));
    update(fields, '新消息', 'completed');
  }

  async function parseConversationResponse(response, conversationId) {
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > MAX_RECORD_BYTES) return;
    const raw = await response.text();
    if (raw.length > MAX_RECORD_BYTES) return;
    const parsed = parseResponseText(raw).filter(hasModelEvidence);
    const fields = parsed.at(-1);
    if (!fields) return;
    update(mergeFields(fields, { conversationId: conversationId ?? fields.conversationId }), '重新加载', 'completed');
  }

  async function inspectFetch(downstream, receiver, input, init) {
    const url = requestUrl(input);
    const endpoint = classifyEndpoint(url);
    if (endpoint.kind === 'other') return downstream.call(receiver ?? window, input, init);

    let baseFields = emptyFields();
    if (endpoint.kind === 'conversation_stream') {
      baseFields = parseRequestBody(await requestBody(input, init));
      update(baseFields, '新消息', 'requested');
    }

    const response = await downstream.call(receiver ?? window, input, init);
    const clone = response.clone();
    if (endpoint.kind === 'conversation_stream') {
      void parseLiveStream(clone, baseFields).catch(() => undefined);
    } else if (endpoint.kind === 'conversation_record') {
      void parseConversationResponse(clone, endpoint.conversationId).catch(() => undefined);
    }
    return response;
  }

  function createFetchGeneration(downstream, capturesRawResponse) {
    const generation = {
      capturesRawResponse,
      downstream,
      wrapper: nativeFetch
    };
    generation.wrapper = async function routeInspectorFetch(input, init) {
      const receiver = this ?? window;
      if (generation.capturesRawResponse) {
        return inspectFetch(generation.downstream, receiver, input, init);
      }
      return generation.downstream.call(receiver, input, init);
    };
    return generation;
  }

  let currentFetchGeneration = createFetchGeneration(nativeFetch, true);

  function adoptDownstreamFetch(candidate) {
    if (typeof candidate !== 'function' || candidate === currentFetchGeneration.wrapper) return;
    currentFetchGeneration = createFetchGeneration(candidate, candidate === nativeFetch);
  }

  function routeFetchGetter() {
    return currentFetchGeneration.wrapper;
  }

  function routeFetchSetter(candidate) {
    adoptDownstreamFetch(candidate);
  }

  function installFetchHook() {
    try {
      const descriptor = Object.getOwnPropertyDescriptor(window, 'fetch');
      if (descriptor?.get === routeFetchGetter && descriptor.set === routeFetchSetter) return;
      adoptDownstreamFetch(window.fetch);
      try {
        Object.defineProperty(window, 'fetch', {
          configurable: true,
          enumerable: descriptor?.enumerable ?? true,
          get: routeFetchGetter,
          set: routeFetchSetter
        });
      } catch {
        window.fetch = currentFetchGeneration.wrapper;
      }
    } catch {
      // A frozen or hostile fetch property should not break ChatGPT itself.
    }
  }

  installFetchHook();
  mountUi();
  window.setInterval(() => {
    installFetchHook();
    if (!rootHost?.isConnected) mountUi();
  }, 2000);
})();