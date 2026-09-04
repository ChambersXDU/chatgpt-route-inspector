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
    expect(source).toContain('// @version      1.0.13');
    expect(source).toContain('// @match        https://chatgpt.com/*');
    expect(source).toContain('// @match        https://chat.openai.com/*');
    expect(source).toContain('// @run-at       document-start');
    expect(source).toContain('// @sandbox      raw');
    expect(source).toContain('// @grant        none');
    expect(source).toContain('raw.githubusercontent.com/ChambersXDU/chatgpt-route-inspector/main/userscript/chatgpt-route-inspector.user.js');
  });

  it('keeps automatic capture and restores only a matching live result on reload', async () => {
    const source = await userscript();
    expect(source).toContain("update(baseFields, '新消息', 'requested')");
    expect(source).toContain("update(fields, '新消息', 'responding')");
    expect(source).toContain('restoreCapturedReading(merged, conversationId)');
    expect(source).toContain("CAPTURE_STORAGE_PREFIX = 'chatgpt-route-inspector:capture:v1:'");
    expect(source).toContain('sessionStorage.setItem');
    expect(source).toContain('currentMessageId === storedMessageId');
    expect(source).not.toContain('mode-live');
    expect(source).not.toContain('mode-reload');
  });

  it('trusts server STE first and does not treat reload resolved_model_slug as actual routing', async () => {
    const source = await userscript();
    expect(source).toContain("['server_ste_metadata.model_slug']");
    expect(source).toContain("const resolvedFallback = trigger === '新消息' ? resolvedModel : null");
    expect(source).toContain('const routeModel = serverModel ?? resolvedFallback');
    expect(source).toContain('const modelTag = normalized(fields.responseModelSlug)');
    expect(source).toContain('resolved_model_slug and assistant model_slug from a reload record do not overwrite it');
    expect(source).toContain('请求模型与服务器路由不一致');
    expect(source).not.toContain("return '未验证'");
  });

  it('stays invisible until a route is captured and sits farther right', async () => {
    const source = await userscript();
    expect(source).toContain('<button id="pill" type="button" hidden></button>');
    expect(source).toContain('if (!currentReading?.routeModel) return null;');
    expect(source).toContain('pill.hidden = !label;');
    expect(source).toContain("pill.textContent = label ?? '';");
    expect(source).not.toContain('尚未捕获');
    expect(source).not.toContain('正在获取…');
    expect(source).not.toContain('路由模型 ·');
    expect(source).toContain('当前实际路由');
    expect(source).toContain('请求模型');
    expect(source).toContain('模型标签');
    expect(source).toContain('right:56px;top:56px;');
    expect(source).toContain('font-family:inherit;font-size:11px;font-weight:500;line-height:1.25');
    expect(source).toContain('border:0;background:transparent');
    expect(source).toContain('box-shadow:none');
    expect(source).toContain('right:0;top:24px;');
    expect(source).not.toContain('用作显式路由证据');
    expect(source).not.toContain('.foot{');
    expect(source).not.toContain('Language');
  });
});
