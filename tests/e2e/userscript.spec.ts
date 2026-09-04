import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const userscriptPath = path.join(root, 'userscript', 'chatgpt-route-inspector.user.js');

async function shadowText(page: Page, selector: string): Promise<string | null> {
  return page.locator('[data-route-inspector-root="userscript"]').evaluate((host, target) =>
    host.shadowRoot?.querySelector(target)?.textContent ?? null,
  selector);
}

async function pillText(page: Page): Promise<string | null> {
  return shadowText(page, '#pill');
}

test('Tampermonkey version follows reload and then trusts terminal STE routing for the newest live message', async ({ page }) => {
  await page.setContent('<!doctype html><html><body><main>fixture</main></body></html>');
  await page.evaluate(() => {
    const reloadRecord = {
      current_node: 'assistant-1',
      mapping: {
        'user-1': {
          id: 'user-1',
          parent: null,
          message: { id: 'user-1', author: { role: 'user' }, metadata: {} }
        },
        'assistant-1': {
          id: 'assistant-1',
          parent: 'user-1',
          message: {
            id: 'assistant-1',
            author: { role: 'assistant' },
            metadata: { resolved_model_slug: 'gpt-5-5' }
          }
        }
      }
    };
    const liveBody = [
      'data: {"message":{"author":{"role":"assistant"},"metadata":{"model_slug":"gpt-5-6-thinking"}}}',
      'data: {"type":"server_ste_metadata","metadata":{"model_slug":"gpt-5-5-mini"}}',
      'data: [DONE]',
      ''
    ].join('\n');

    window.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url.includes('/backend-api/conversation/e2e-userscript')) {
        return new Response(JSON.stringify(reloadRecord), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
      if (url.includes('/backend-api/f/conversation')) {
        return new Response(liveBody, {
          status: 200,
          headers: { 'content-type': 'text/event-stream' }
        });
      }
      return new Response('ok', { status: 200 });
    }) as typeof window.fetch;
  });

  await page.addScriptTag({ content: await readFile(userscriptPath, 'utf8') });
  await expect.poll(() => pillText(page)).toBe('路由模型 · 尚未捕获');

  await page.evaluate(() => {
    const capturedFetch = window.fetch;
    window.fetch = async function chatgptFetchWrapper(input, init) {
      return capturedFetch.call(this, input, init);
    };
  });
  await expect(page.evaluate(async () => {
    const response = await window.fetch('https://chatgpt.com/backend-api/subscription');
    return response.text();
  })).resolves.toBe('ok');

  await page.evaluate(() => window.fetch('https://chatgpt.com/backend-api/conversation/e2e-userscript'));
  await expect.poll(() => pillText(page)).toBe('路由模型 · GPT 5.5');

  const live = page.evaluate(() => window.fetch('https://chatgpt.com/backend-api/f/conversation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-5-6-thinking', messages: [] })
  }));
  await expect.poll(() => pillText(page)).toMatch(/正在获取|GPT 5\.5 mini/);
  await live;
  await expect.poll(() => pillText(page)).toBe('路由模型 · GPT 5.5 mini');

  await page.locator('[data-route-inspector-root="userscript"]').evaluate((host) =>
    (host.shadowRoot?.querySelector('#pill') as HTMLButtonElement | null)?.click());
  await expect.poll(() => shadowText(page, '#alert')).toBe('请求模型与服务器路由不一致');
  await expect.poll(() => shadowText(page, '#request')).toBe('GPT 5.6 Thinking');
  await expect.poll(() => shadowText(page, '#label-value')).toBe('GPT 5.6 Thinking');
  await expect.poll(() => shadowText(page, '#source')).toBe('server_ste_metadata.model_slug');
});
