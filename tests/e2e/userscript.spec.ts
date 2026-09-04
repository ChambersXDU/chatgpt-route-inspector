import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const userscriptPath = path.join(root, 'userscript', 'chatgpt-route-inspector.user.js');

async function pillText(page: import('@playwright/test').Page): Promise<string | null> {
  return page.locator('[data-route-inspector-root="userscript"]').evaluate((host) =>
    host.shadowRoot?.querySelector('#pill')?.textContent ?? null
  );
}

test('Tampermonkey version follows reload and then the newest live message automatically', async ({ page }) => {
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
      'data: {"message":{"author":{"role":"assistant"},"metadata":{"resolved_model_slug":"gpt-5-6-pro"}}}',
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

  await page.evaluate(() => window.fetch('https://chatgpt.com/backend-api/conversation/e2e-userscript'));
  await expect.poll(() => pillText(page)).toBe('路由模型 · GPT 5.5');

  const live = page.evaluate(() => window.fetch('https://chatgpt.com/backend-api/f/conversation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-5-6-pro', messages: [] })
  }));
  await expect.poll(() => pillText(page)).toMatch(/正在获取|GPT 5\.6 Pro/);
  await live;
  await expect.poll(() => pillText(page)).toBe('路由模型 · GPT 5.6 Pro');
});
