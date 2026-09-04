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
    expect(source).toContain('// @version      1.0.9');
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

  it('uses explicit route fields for routing and keeps assistant model_slug as a label only', async () => {
    const source = await userscript();
    expect(source).toContain("source: 'resolved_model_slug'");
    expect(source).toContain("source: 'server_ste_metadata.model_slug'");
    expect(source).toContain('const modelTag = normalized(fields.responseModelSlug)');
    expect(source).toContain('explicitModels.length > 1');
    expect(source).toContain('请求模型与服务器路由不一致');
  });

  it('stays visually small, quiet and away from the composer', async () => {
    const source = await userscript();
    expect(source).toContain('<button id="pill" type="button">尚未捕获</button>');
    expect(source).toContain('pill.textContent = label;');
    expect(source).not.toContain('路由模型 ·');
    expect(source).toContain('当前实际路由');
    expect(source).toContain('请求模型');
    expect(source).toContain('模型标签');
    expect(source).toContain('right:18px;top:32vh;');
    expect(source).toContain('right:0;top:42px;');
    expect(source).not.toContain('用作显式路由证据');
    expect(source).not.toContain('.foot{');
    expect(source).not.toContain('Language');
  });
});
