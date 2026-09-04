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

test('Tampermonkey keeps terminal STE routing when reload metadata only repeats the selected model', async ({ page }) => {
  await page.setContent('<!doctype html><html><body><main>fixture</main></body></html>');
  await page.evaluate(() => {
    const reloadRecord = {
      current_node: 'assistant-live-1',
      mapping: {
        'user-1': {
          id: 'user-1',
          parent: null,
          message: { id: 'user-1', author: { role: 'user' }, metadata: {} }
        },
        'assistant-live-1': {
          id: 'assistant-live-1',
          parent: 'user-1',
          message: {
            id: 'assistant-live-1',
            author: { role: 'assistant' },
            metadata: {
              model_slug: 'gpt-5-6-thinking',
              resolved_model_slug: 'gpt-5-6-thinking'
            }
          }
        }
      }
    };
    const liveBody = [
      'data: {"conversation_id":"e2e-userscript","message":{"id":"assistant-live-1","author":{"role":"assistant"},"metadata":{"model_slug":"gpt-5-6-thinking"}}}',
      'data: {"conversation_id":"e2e-userscript","type":"server_ste_metadata","metadata":{"model_slug":"gpt-5-5-mini"}}',
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
  await expect.poll(() => pillText(page)).toBe('尚未捕获');

  const indicatorStyle = await page.locator('[data-route-inspector-root="userscript"]').evaluate((host) => {
    const pill = host.shadowRoot?.querySelector('#pill') as HTMLButtonElement | null;
    if (!pill) return null;
    const style = getComputedStyle(pill);
    return {
      right: (host as HTMLElement).style.right,
      top: (host as HTMLElement).style.top,
      fontSize: style.fontSize,
      backgroundColor: style.backgroundColor,
      borderTopStyle: style.borderTopStyle,
      boxShadow: style.boxShadow
    };
  });
  expect(indicatorStyle).toEqual({
    right: '92px',
    top: '56px',
    fontSize: '11px',
    backgroundColor: 'rgba(0, 0, 0, 0)',
    borderTopStyle: 'none',
    boxShadow: 'none'
  });

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

  // A reload record that only repeats the selected model is not actual route evidence.
  await page.evaluate(() => window.fetch('https://chatgpt.com/backend-api/conversation/e2e-userscript'));
  await expect.poll(() => pillText(page)).toBe('尚未捕获');

  const live = page.evaluate(() => window.fetch('https://chatgpt.com/backend-api/f/conversation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-5-6-thinking',
      conversation_id: 'e2e-userscript',
      messages: []
    })
  }));
  await expect.poll(() => pillText(page)).toMatch(/正在获取|GPT 5\.5 mini/);
  await live;
  await expect.poll(() => pillText(page)).toBe('GPT 5.5 mini');

  await expect(page.evaluate(() => Object.keys(sessionStorage)
    .some((key) => key.startsWith('chatgpt-route-inspector:capture:')))).resolves.toBe(true);

  // Simulate the conversation fetch that happens after a page refresh. It must restore the
  // matching live capture instead of replacing it with resolved_model_slug = GPT 5.6 Thinking.
  await page.evaluate(() => window.fetch('https://chatgpt.com/backend-api/conversation/e2e-userscript'));
  await expect.poll(() => pillText(page)).toBe('GPT 5.5 mini');

  await page.locator('[data-route-inspector-root="userscript"]').evaluate((host) =>
    (host.shadowRoot?.querySelector('#pill') as HTMLButtonElement | null)?.click());
  await expect.poll(() => shadowText(page, '#alert')).toBe('请求模型与服务器路由不一致');
  await expect.poll(() => shadowText(page, '#request')).toBe('GPT 5.6 Thinking');
  await expect.poll(() => shadowText(page, '#label-value')).toBe('GPT 5.6 Thinking');
  await expect.poll(() => shadowText(page, '#source')).toBe('server_ste_metadata.model_slug');
});
