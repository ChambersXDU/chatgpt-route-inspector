import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test, type BrowserContext, type Page, type Worker } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const extensionPath = path.join(root, 'dist', 'e2e');
const storageKey = 'chatgptRouteInspectorStateV1';
let context: BrowserContext;
let worker: Worker;
let extensionId: string;
let profileDir: string;
let server: Server;
let webSocketFrame: string;

async function expectPopupFits(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const selectors = [
      '.masthead .brand',
      '.brand-mark',
      '.brand-copy',
      '.masthead-controls',
      '.popup-control-grid',
      '.popup-result-grid',
      '.button-stack',
      '.privacy-note',
      '.footer-link'
    ];
    const clipped = selectors.filter((selector) => {
      const element = document.querySelector<HTMLElement>(selector);
      if (!element) return true;
      const box = element.getBoundingClientRect();
      return box.left < 0 || box.right > window.innerWidth || box.top < 0 || box.bottom > window.innerHeight;
    });
    const brand = document.querySelector<HTMLElement>('.masthead .brand')?.getBoundingClientRect();
    const controls = document.querySelector<HTMLElement>('.masthead-controls')?.getBoundingClientRect();
    return {
      bodyWidth: Math.round(body.getBoundingClientRect().width),
      clipped,
      headerOverlap: Boolean(brand && controls && brand.right > controls.left),
      horizontalOverflow: Math.max(root.scrollWidth, body.scrollWidth) > window.innerWidth,
      scrollX: window.scrollX,
      verticalOverflow: Math.max(root.scrollHeight, body.scrollHeight) > window.innerHeight
    };
  })).toEqual({
    bodyWidth: 640,
    clipped: [],
    headerOverlap: false,
    horizontalOverflow: false,
    scrollX: 0,
    verticalOverflow: false
  });
}

async function findExtensionCapableChromium(): Promise<string> {
  const configured = process.env.ROUTE_INSPECTOR_CHROMIUM;
  const playwrightDefault = chromium.executablePath();
  const candidates = [configured, playwrightDefault].filter((value): value is string => Boolean(value));
  const cacheRoot = path.join(homedir(), 'AppData', 'Local', 'ms-playwright');
  try {
    const installations = (await readdir(cacheRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && /^chromium-\d+$/.test(entry.name))
      .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
    for (const installation of installations) {
      candidates.push(path.join(cacheRoot, installation.name, 'chrome-win64', 'chrome.exe'));
      candidates.push(path.join(cacheRoot, installation.name, 'chrome-win', 'chrome.exe'));
    }
  } catch {
    // The standard Playwright cache does not exist on this machine.
  }
  const match = candidates.find((candidate) => existsSync(candidate));
  if (!match) throw new Error('No extension-capable Chromium found. Run: npx playwright install chromium');
  return match;
}

test.beforeAll(async () => {
  const [requestBody, responseBody, conversationRecord, frame] = await Promise.all([
    readFile(path.join(root, 'tests', 'fixtures', 'conversation-request.json'), 'utf8'),
    readFile(path.join(root, 'tests', 'fixtures', 'handoff-response.sse'), 'utf8'),
    readFile(path.join(root, 'tests', 'fixtures', 'conversation-record.json'), 'utf8'),
    readFile(path.join(root, 'tests', 'fixtures', 'websocket-route-frame.json'), 'utf8')
  ]);
  webSocketFrame = frame;
  server = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/backend-api/f/conversation') {
      response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' });
      response.end(responseBody);
      return;
    }
    if (request.method === 'GET' && request.url === '/backend-api/conversation/e2e-conversation') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(conversationRecord);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(`<!doctype html><html><body><h1>Route fixture</h1><button id="ask">Run live fixture</button><pre id="done"></pre><script>const capturedFetch1=window.fetch;window.fetch=async function o1(...args){window.__routeReceiverOne=this===window;const response=await capturedFetch1.apply(this,args);const url=String(args[0] instanceof Request?args[0].url:args[0]);if(url.includes('/backend-api/f/conversation'))return new Response('data: [DONE]',{status:response.status,headers:{'content-type':'text/event-stream'}});return response};const capturedFetch2=window.fetch;window.fetch=async function o2(...args){window.__routeReceiverTwo=this===window;return capturedFetch2.apply(this,args)};const capturedWebSocket1=window.WebSocket;function ws1(...args){window.__routeWebSocketOne=true;return Reflect.construct(capturedWebSocket1,args,capturedWebSocket1)}ws1.prototype=capturedWebSocket1.prototype;for(const key of ['CONNECTING','OPEN','CLOSING','CLOSED'])Object.defineProperty(ws1,key,{value:capturedWebSocket1[key]});window.WebSocket=ws1;const capturedWebSocket2=window.WebSocket;function ws2(...args){window.__routeWebSocketTwo=true;return Reflect.construct(capturedWebSocket2,args,capturedWebSocket2)}ws2.prototype=capturedWebSocket2.prototype;for(const key of ['CONNECTING','OPEN','CLOSING','CLOSED'])Object.defineProperty(ws2,key,{value:capturedWebSocket2[key]});window.WebSocket=ws2;window.__routeSocketMessages=[];const openSocket=()=>new Promise((resolve,reject)=>{const socket=new window.WebSocket('ws://127.0.0.1:43996/backend-api/ws');window.__routeSocket=socket;socket.addEventListener('message',(event)=>window.__routeSocketMessages.push(event.data));socket.addEventListener('open',()=>resolve(socket),{once:true});socket.addEventListener('error',reject,{once:true})});const body=${JSON.stringify(requestBody)};document.querySelector('#ask').onclick=async()=>{const socket=await openSocket();const response=await window.fetch('/backend-api/f/conversation',{method:'POST',headers:{'content-type':'application/json'},body});document.querySelector('#done').textContent=await response.text();socket.send('emit-route')};const appendAssistant=(id)=>{const assistant=document.createElement('div');assistant.dataset.messageAuthorRole='assistant';assistant.dataset.messageId=id;assistant.dataset.messageModelSlug='gpt-5-6-pro';assistant.textContent='PRIVATE_ASSISTANT_TEXT';document.body.append(assistant)};if(localStorage.getItem('route-fixture-dom-only')==='1'){localStorage.removeItem('route-fixture-dom-only');appendAssistant('fixture-dom-only-message')}if(localStorage.getItem('route-fixture-reload')==='1'){localStorage.removeItem('route-fixture-reload');appendAssistant('fixture-assistant-message');void window.fetch('/backend-api/conversation/e2e-conversation').then((response)=>response.json());}</script></body></html>`);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(43996, '127.0.0.1', resolve);
  });

  profileDir = await mkdtemp(path.join(tmpdir(), 'route-inspector-e2e-'));
  const chromePath = await findExtensionCapableChromium();
  context = await chromium.launchPersistentContext(profileDir, {
    executablePath: chromePath,
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`
    ]
  });
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  extensionId = new URL(worker.url()).host;
});

test.afterAll(async () => {
  await context?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
  const resolvedProfile = path.resolve(profileDir);
  const resolvedTemp = path.resolve(tmpdir());
  if (resolvedProfile.startsWith(`${resolvedTemp}${path.sep}`)) {
    await rm(resolvedProfile, { recursive: true, force: true });
  }
});

test('keeps live and reload captures distinct and stores no chat text', async () => {
  const languageSetup = await context.newPage();
  await languageSetup.goto(`chrome-extension://${extensionId}/ui/popup/index.html`);
  await languageSetup.locator('[data-language="zh"]').click();
  await expect(languageSetup.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(languageSetup.locator('.author-link')).toHaveAttribute('href', 'https://blog.liu-qi.cn/tools/');
  await languageSetup.close();

  const page = await context.newPage();
  await page.routeWebSocket('ws://127.0.0.1:43996/backend-api/ws', (socket) => {
    socket.onMessage((message) => {
      if (message === 'emit-route') socket.send(webSocketFrame);
    });
  });
  await page.goto('http://127.0.0.1:43996/c/e2e-conversation');
  const overlay = page.locator('#chatgpt-route-inspector-root');
  await expect(overlay).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.fetch.name)).toBe('routeInspectorFetch');
  await page.locator('#ask').click();
  await expect.poll(() => page.evaluate(() => [
    (window as Window & { __routeReceiverOne?: boolean }).__routeReceiverOne,
    (window as Window & { __routeReceiverTwo?: boolean }).__routeReceiverTwo
  ])).toEqual([true, true]);
  await expect(page.locator('#done')).toHaveText('data: [DONE]');
  await expect.poll(() => page.evaluate(() => {
    const scope = window as Window & {
      __routeSocket?: WebSocket;
      __routeSocketMessages?: unknown[];
      __routeWebSocketOne?: boolean;
      __routeWebSocketTwo?: boolean;
    };
    const socket = scope.__routeSocket;
    let noNewThrows = false;
    try {
      Reflect.apply(window.WebSocket as unknown as (...args: unknown[]) => unknown, window, ['ws://127.0.0.1:43996/backend-api/ws']);
    } catch {
      noNewThrows = true;
    }
    return [
      scope.__routeWebSocketOne,
      scope.__routeWebSocketTwo,
      Boolean(socket && socket instanceof window.WebSocket),
      Boolean(socket && Object.getPrototypeOf(socket) === window.WebSocket.prototype),
      window.WebSocket.OPEN,
      scope.__routeSocketMessages?.length ?? 0,
      noNewThrows
    ];
  })).toEqual([true, true, true, true, 1, 1, true]);

  await expect.poll(async () => worker.evaluate(async (key) => {
    const result = await chrome.storage.local.get(key);
    const state = result[key] as {
      turns?: Array<{ verdict?: string; captureMode?: string; routeModel?: string | null; modelLabel?: string | null; sources?: string[] }>;
    } | undefined;
    const live = state?.turns?.find((turn) => turn.captureMode === 'live');
    return live ? `${live.verdict}:${live.routeModel}:${live.modelLabel}:${live.sources?.join('+')}` : 'missing';
  }, storageKey)).toBe('mismatch:gpt-5-5-mini:gpt-5-6-pro:page_fetch+page_websocket');

  let stored = await worker.evaluate(async (key) => JSON.stringify((await chrome.storage.local.get(key))[key]), storageKey);
  expect(stored).toContain('gpt-5-6-pro');
  expect(stored).toContain('gpt-5-5-mini');
  expect(stored).not.toMatch(/SECRET_PROMPT|SECRET_ANSWER|HANDOFF_SECRET|private\.pdf|confidence|effectiveModel/i);

  let overlayText = await overlay.evaluate((element) => element.shadowRoot?.textContent ?? '');
  expect(overlayText).toContain('检测到路由错配');
  expect(overlayText).toContain('resolved_model_slug');

  const untouchedTab = await context.newPage();
  await untouchedTab.goto('http://127.0.0.1:43996/');
  const untouchedOverlay = await untouchedTab.locator('#chatgpt-route-inspector-root').evaluate((element) => element.shadowRoot?.textContent ?? '');
  expect(untouchedOverlay).toContain('等待下一次回答');
  expect(untouchedOverlay).not.toContain('检测到路由错配');

  await overlay.locator('#mode-reload').click();
  await expect.poll(async () => worker.evaluate(async (key) => {
    const state = (await chrome.storage.local.get(key))[key] as { settings?: { captureMode?: string } } | undefined;
    return state?.settings?.captureMode ?? 'missing';
  }, storageKey)).toBe('reload');
  await expect.poll(async () => overlay.evaluate((element) => element.shadowRoot?.textContent ?? ''))
    .toContain('等待刷新会话');

  const domFallbackTab = await context.newPage();
  await domFallbackTab.goto('http://127.0.0.1:43996/c/dom-only-conversation');
  await domFallbackTab.evaluate(() => localStorage.setItem('route-fixture-dom-only', '1'));
  await domFallbackTab.reload();
  await expect.poll(async () => worker.evaluate(async (key) => {
    const state = (await chrome.storage.local.get(key))[key] as {
      turns?: Array<{ captureMode?: string; routeModel?: string | null; modelLabel?: string | null; sources?: string[] }>;
    } | undefined;
    const fallback = state?.turns?.find((turn) => turn.captureMode === 'reload' && turn.sources?.includes('assistant_dom'));
    return fallback ? `${fallback.routeModel}:${fallback.modelLabel}` : 'missing';
  }, storageKey)).toBe('null:gpt-5-6-pro');
  await domFallbackTab.close();

  await page.evaluate(() => localStorage.setItem('route-fixture-reload', '1'));
  await page.reload();
  await expect(overlay).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => window.fetch.name)).toBe('routeInspectorFetch');
  await expect.poll(async () => worker.evaluate(async (key) => {
    const state = (await chrome.storage.local.get(key))[key] as {
      turns?: Array<{ captureMode?: string; routeModel?: string | null; modelLabel?: string | null; verdict?: string; sources?: string[] }>;
    } | undefined;
    const reload = state?.turns?.find((turn) => turn.captureMode === 'reload');
    return reload ? `${reload.routeModel}:${reload.modelLabel}:${reload.verdict}:${reload.sources?.join('+')}` : 'missing';
  }, storageKey)).toBe('gpt-5-5-mini:gpt-5-6-pro:unknown:conversation_record');
  await page.waitForTimeout(1400);
  expect(await worker.evaluate(async (key) => {
    const state = (await chrome.storage.local.get(key))[key] as {
      turns?: Array<{ captureMode?: string; sources?: string[] }>;
    } | undefined;
    const reload = state?.turns?.filter((turn) => turn.captureMode === 'reload') ?? [];
    return {
      latest: reload[0]?.sources?.join('+') ?? null,
      domFallbackCount: reload.filter((turn) => turn.sources?.includes('assistant_dom')).length
    };
  }, storageKey)).toEqual({ latest: 'conversation_record', domFallbackCount: 1 });

  overlayText = await overlay.evaluate((element) => element.shadowRoot?.textContent ?? '');
  expect(overlayText).toContain('已读取响应路由');
  expect(overlayText).toContain('重载不提供');
  expect(overlayText).toContain('resolved_model_slug');
  expect(overlayText).toContain('gpt-5-5-mini');
  expect(overlayText).toContain('gpt-5-6-pro');

  stored = await worker.evaluate(async (key) => JSON.stringify((await chrome.storage.local.get(key))[key]), storageKey);
  expect(stored).not.toMatch(/PRIVATE_USER_TEXT|PRIVATE_ASSISTANT_TEXT|confidence|effectiveModel/i);
  const counts = await worker.evaluate(async (key) => {
    const state = (await chrome.storage.local.get(key))[key] as { turns?: Array<{ captureMode?: string }> } | undefined;
    return {
      live: state?.turns?.filter((turn) => turn.captureMode === 'live').length ?? 0,
      reload: state?.turns?.filter((turn) => turn.captureMode === 'reload').length ?? 0
    };
  }, storageKey);
  expect(counts.live).toBe(1);
  expect(counts.reload).toBeGreaterThan(0);

  const dashboard = await context.newPage();
  await dashboard.goto(`chrome-extension://${extensionId}/ui/dashboard/index.html`);
  await expect(dashboard.getByText('路由诊断台')).toBeVisible();
  await expect(dashboard.getByText('实时请求').first()).toBeVisible();
  await expect(dashboard.getByText('会话重载').first()).toBeVisible();
  await expect(dashboard.getByText('GPT 5.6 Pro').first()).toBeVisible();
  await dashboard.screenshot({ path: path.join(root, 'output', 'playwright', 'dashboard-e2e.png'), fullPage: true });

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 640, height: 600 });
  await popup.goto(`chrome-extension://${extensionId}/ui/popup/index.html`);
  await expect(popup.getByText('已读取响应路由')).toBeVisible();
  await expect(popup.getByText('重载不提供')).toBeVisible();
  await expect(popup.getByText('会话重载').first()).toBeVisible();
  await expectPopupFits(popup);
  await overlay.locator('#hide').click();
  await expect(overlay).toHaveCount(0);
  await expect(popup.locator('#overlay-hide')).toHaveClass(/active/);
  await popup.locator('#overlay-show').click();
  await expect(overlay).toHaveCount(1);
  await expect(popup.locator('#overlay-show')).toHaveClass(/active/);
  await popup.screenshot({ path: path.join(root, 'output', 'playwright', 'popup-e2e.png'), fullPage: true });

  await page.evaluate(() => {
    history.pushState({}, '', '/c/spa-conversation-b');
    const assistant = document.createElement('div');
    assistant.dataset.messageAuthorRole = 'assistant';
    assistant.dataset.messageId = 'spa-conversation-b-message';
    assistant.dataset.messageModelSlug = 'gpt-5-5-instant';
    assistant.textContent = 'PRIVATE_SPA_ASSISTANT_TEXT';
    document.body.append(assistant);
  });
  await expect.poll(async () => worker.evaluate(async (key) => {
    const state = (await chrome.storage.local.get(key))[key] as {
      turns?: Array<{
        captureMode?: string;
        conversationId?: string | null;
        routeModel?: string | null;
        modelLabel?: string | null;
        sources?: string[];
      }>;
    } | undefined;
    const spaTurn = state?.turns?.find((turn) =>
      turn.captureMode === 'reload' && turn.conversationId === 'spa-conversation-b'
    );
    return spaTurn
      ? `${spaTurn.routeModel}:${spaTurn.modelLabel}:${spaTurn.sources?.join('+')}`
      : 'missing';
  }, storageKey)).toBe('null:gpt-5-5-instant:assistant_dom');
  overlayText = await overlay.evaluate((element) => element.shadowRoot?.textContent ?? '');
  expect(overlayText).toContain('仅取得模型标签');
  expect(overlayText).toContain('gpt-5-5-instant');
  expect(overlayText).not.toContain('gpt-5-5-mini');

  stored = await worker.evaluate(async (key) => JSON.stringify((await chrome.storage.local.get(key))[key]), storageKey);
  expect(stored).not.toContain('PRIVATE_SPA_ASSISTANT_TEXT');

  await popup.locator('[data-language="en"]').click();
  await expect(popup.locator('html')).toHaveAttribute('lang', 'en');
  await expect(popup.getByText('Model label only')).toBeVisible();
  await expect(dashboard.getByText('Route diagnostics')).toBeVisible();
  await expect.poll(async () => overlay.evaluate((element) => element.shadowRoot?.textContent ?? ''))
    .toContain('Model label only');
  await expectPopupFits(popup);

  await popup.locator('#mode-live').click();
  await expect(popup.getByText('Route mismatch')).toBeVisible();
  await expect(popup.getByText('page_fetch+page_websocket')).toBeVisible();
  await expectPopupFits(popup);

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/ui/options/index.html`);
  await expect(options.getByText('Settings & privacy').first()).toBeVisible();
  await expect(options.locator('.author-link')).toHaveAttribute('href', 'https://blog.liu-qi.cn/tools/');

  const onboarding = await context.newPage();
  await onboarding.goto(`chrome-extension://${extensionId}/ui/onboarding/index.html`);
  await expect(onboarding.getByText('See the route reported by the response.')).toBeVisible();
  await expect(onboarding.locator('.author-link')).toHaveText('Created by @liuqi');
  await popup.screenshot({ path: path.join(root, 'output', 'playwright', 'popup-en-e2e.png'), fullPage: true });
  await dashboard.screenshot({ path: path.join(root, 'output', 'playwright', 'dashboard-en-e2e.png'), fullPage: true });
  await options.screenshot({ path: path.join(root, 'output', 'playwright', 'options-en-e2e.png'), fullPage: true });
  await onboarding.screenshot({ path: path.join(root, 'output', 'playwright', 'onboarding-en-e2e.png'), fullPage: true });
  await page.screenshot({ path: path.join(root, 'output', 'playwright', 'overlay-en-e2e.png'), fullPage: true });

  const language = await worker.evaluate(async (key) => {
    const current = (await chrome.storage.local.get(key))[key] as { settings?: { uiLanguage?: string } } | undefined;
    return current?.settings?.uiLanguage ?? 'missing';
  }, storageKey);
  expect(language).toBe('en');
});
