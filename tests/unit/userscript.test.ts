import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const userscriptPath = path.join(root, 'userscript', 'chatgpt-route-inspector.user.js');

async function userscript(): Promise<string> {
  return readFile(userscriptPath, 'utf8');
}

describe('Tampermonkey installer', () => {
  it('has installable metadata for ChatGPT and page-context interception', async () => {
    const source = await userscript();
    expect(source.startsWith('// ==UserScript==')).toBe(true);
    expect(source).toContain('// @match        https://chatgpt.com/*');
    expect(source).toContain('// @match        https://chat.openai.com/*');
    expect(source).toContain('// @run-at       document-start');
    expect(source).toContain('// @sandbox      raw');
    expect(source).toContain('// @grant        none');
    expect(source).toContain('raw.githubusercontent.com/ChambersXDU/chatgpt-route-inspector/main/userscript/chatgpt-route-inspector.user.js');
  });

  it('keeps the same automatic reload/new-message product contract', async () => {
    const source = await userscript();
    expect(source).toContain("update(mergeFields(fields, { conversationId: conversationId ?? fields.conversationId }), '重新加载', 'completed')");
    expect(source).toContain("update(baseFields, '新消息', 'requested')");
    expect(source).toContain("update(fields, '新消息', 'responding')");
    expect(source).not.toContain('mode-live');
    expect(source).not.toContain('mode-reload');
  });

  it('prioritizes explicit route fields and keeps label fallback visible', async () => {
    const source = await userscript();
    expect(source).toContain('fields.resolvedModelSlug');
    expect(source).toContain('fields.serverModelSlug');
    expect(source).toContain('fields.responseModelSlug');
    expect(source).toContain('路由字段冲突');
    expect(source).toContain('resolved_model_slug');
    expect(source).toContain('server_ste_metadata.model_slug');
  });

  it('stays visually small and Chinese-first', async () => {
    const source = await userscript();
    expect(source).toContain('路由模型 · 尚未捕获');
    expect(source).toContain('当前路由模型');
    expect(source).toContain('只读取 ChatGPT 页面中已有的路由字段');
    expect(source).not.toContain('Language');
  });
});
