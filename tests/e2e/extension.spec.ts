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
      '.pow-readout',
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
    if (request.method === 'POST' && request.url === '/backend-api/sentinel/chat-requirements/prepare') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify({
        prepare_token: 'PRIVATE_PREPARE_TOKEN',
        proofofwork: { required: true, seed: 'PRIVATE_POW_SEED', difficulty: '063556' },
        turnstile: { dx: 'PRIVATE_TURNSTILE_PAYLOAD' }
      }));
      return;
    }
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
  const popupFontSizes = await languageSetup.locator('body').evaluate((body) => Array.from(body.querySelectorAll<HTMLElement>('*'))
    .filter((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
    })
    .map((element) => getComputedStyle(element).fontSize)
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort((left, right) => Number.parseFloat(left) - Number.parseFloat(right)));
  expect(popupFontSizes).toEqual(['10px', '12px', '14px', '16px', '18px']);
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
  await page.evaluate(async () => {
    await window.fetch('/backend-api/sentinel/chat-requirements/prepare', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ p: 'PRIVATE_POW_FINGERPRINT' })
    });
  });
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

  await expect.poll(async () => worker.evaluate(async (key) => {
    const state = (await chrome.storage.local.get(key))[key] as {
      powReadings?: Array<{ rawHex?: string; decimal?: string; tabId?: number | null }>;
    } | undefined;
    const reading = state?.powReadings?.[0];
    return reading ? `${reading.rawHex}:${reading.decimal}:${typeof reading.tabId}` : 'missing';
  }, storageKey)).toBe('063556:406870:number');

  let stored = await worker.evaluate(async (key) => JSON.stringify((await chrome.storage.local.get(key))[key]), storageKey);
  expect(stored).toContain('gpt-5-6-pro');
  expect(stored).toContain('gpt-5-5-mini');
  expect(stored).not.toMatch(/SECRET_PROMPT|SECRET_ANSWER|HANDOFF_SECRET|PRIVATE_POW_SEED|PRIVATE_POW_FINGERPRINT|PRIVATE_PREPARE_TOKEN|PRIVATE_TURNSTILE_PAYLOAD|private\.pdf|confidence|effectiveModel/i);

  let overlayText = await overlay.evaluate((element) => element.shadowRoot?.textContent ?? '');
  expect(overlayText).toContain('检测到路由错配');
  expect(overlayText).toContain('resolved_model_slug');
  expect(overlayText).toContain('PoW 难度');
  expect(overlayText).toContain('063556（406870）');
  const fullOverlayFontSizes = await overlay.evaluate((element) => Array.from(element.shadowRoot?.querySelectorAll<HTMLElement>('*') ?? [])
    .filter((child) => {
      const style = getComputedStyle(child);
      const box = child.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
    })
    .map((child) => getComputedStyle(child).fontSize)
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort((left, right) => Number.parseFloat(left) - Number.parseFloat(right)));
  expect(fullOverlayFontSizes).toEqual(['10px', '12px', '14px', '16px']);
  const chineseStatusLayout = await overlay.evaluate((element, labels) => {
    const status = element.shadowRoot?.querySelector<HTMLElement>('.status');
    const title = element.shadowRoot?.querySelector<HTMLElement>('.title');
    const author = element.shadowRoot?.querySelector<HTMLElement>('.author');
    const compact = element.shadowRoot?.querySelector<HTMLElement>('#compact');
    const probe = element.shadowRoot?.querySelector<HTMLElement>('.probe');
    if (!status || !title || !author || !compact || !probe) return null;
    const original = status.textContent;
    const cases = labels.map((label) => {
      status.textContent = label;
      const statusBox = status.getBoundingClientRect();
      const compactBox = compact.getBoundingClientRect();
      const contentRight = Math.max(title.getBoundingClientRect().right, author.getBoundingClientRect().right);
      const probeBox = probe.getBoundingClientRect();
      return {
        contained: statusBox.left >= probeBox.left && statusBox.right <= probeBox.right,
        label,
        noBrandOverlap: contentRight <= statusBox.left,
        rightGap: Math.round(compactBox.left - statusBox.right)
      };
    });
    status.textContent = original;
    const style = getComputedStyle(status);
    return { cases, fontSize: style.fontSize, lang: probe.lang, textAlign: style.textAlign };
  }, [
    '等待下一次回答',
    '等待刷新会话',
    '路由正常',
    '检测到路由错配',
    '实际路由字段冲突',
    '已读取响应路由',
    '仅取得模型标签',
    '未取得实际路由',
    '正在捕获'
  ]);
  expect(chineseStatusLayout).not.toBeNull();
  expect(chineseStatusLayout?.fontSize).toBe('12px');
  expect(chineseStatusLayout?.lang).toBe('zh-CN');
  expect(chineseStatusLayout?.textAlign).toBe('right');
  expect(chineseStatusLayout?.cases.every((entry) => entry.contained && entry.noBrandOverlap && entry.rightGap === 12)).toBe(true);

  await expect(overlay.locator('#compact')).toHaveAttribute('data-tooltip', '极简模式');
  await expect(overlay.locator('#mini')).toHaveAttribute('data-tooltip', '迷你模式');
  await expect(overlay.locator('#compact')).not.toHaveAttribute('title', /.+/);
  await expect(overlay.locator('#mini')).not.toHaveAttribute('title', /.+/);
  await expect.poll(() => overlay.evaluate((element) => [...(element.shadowRoot?.querySelectorAll<HTMLButtonElement>('.head-tools button') ?? [])]
    .map((button) => button.id)))
    .toEqual(['compact', 'mini']);
  await expect.poll(() => overlay.locator('.mode-icon').evaluateAll((icons) => icons.map((icon) => {
    const rect = icon.getBoundingClientRect();
    const style = getComputedStyle(icon);
    return `${icon.className}:${rect.width}x${rect.height}:${style.borderRadius}`;
  }))).toEqual(['mode-icon compact-icon:8x3:0px', 'mode-icon mini-icon:6x6:1px']);
  const compactButton = overlay.locator('#compact');
  await compactButton.hover();
  await expect.poll(() => compactButton.evaluate((button) => getComputedStyle(button, '::after').transitionDelay)).toBe('0.42s');
  await page.waitForTimeout(300);
  await expect.poll(() => compactButton.evaluate((button) => getComputedStyle(button, '::after').opacity)).toBe('0');
  await page.waitForTimeout(200);
  await expect.poll(() => compactButton.evaluate((button) => {
    const style = getComputedStyle(button, '::after');
    const rect = button.getBoundingClientRect();
    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
      content: style.content,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      opacity: style.opacity,
      padding: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft],
      staysInViewport: rect.right <= window.innerWidth,
      visibility: style.visibility
    };
  })).toEqual({
    backgroundColor: 'rgba(255, 255, 255, 0.937)',
    color: 'rgba(0, 0, 0, 0.847)',
    content: '"极简模式"',
    fontSize: '11px',
    lineHeight: '14px',
    opacity: '1',
    padding: ['2px', '6px', '2px', '6px'],
    staysInViewport: true,
    visibility: 'visible'
  });
  await page.screenshot({ path: path.join(root, 'output', 'playwright', 'overlay-tooltip-e2e.png'), fullPage: true });
  await page.mouse.move(0, 0);
  await expect.poll(() => compactButton.evaluate((button) => getComputedStyle(button, '::after').opacity)).toBe('0');
  const miniButton = overlay.locator('#mini');
  await miniButton.hover();
  await expect.poll(() => miniButton.evaluate((button) => getComputedStyle(button, '::after').transitionDelay)).toBe('0.42s');
  await page.waitForTimeout(300);
  await expect.poll(() => miniButton.evaluate((button) => getComputedStyle(button, '::after').opacity)).toBe('0');
  await page.waitForTimeout(200);
  await expect.poll(() => miniButton.evaluate((button) => getComputedStyle(button, '::after').opacity)).toBe('1');
  await page.mouse.move(0, 0);
  await compactButton.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => compactButton.evaluate((button) => getComputedStyle(button, '::after').opacity)).toBe('1');
  await compactButton.evaluate((button) => button.blur());
  await overlay.locator('#compact').click();
  await expect.poll(async () => worker.evaluate(async (key) => {
    const current = (await chrome.storage.local.get(key))[key] as {
      settings?: { overlayMode?: string; overlayMinimized?: boolean; captureMode?: string };
    } | undefined;
    return `${current?.settings?.overlayMode}:${current?.settings?.overlayMinimized}:${current?.settings?.captureMode}`;
  }, storageKey)).toBe('compact:true:live');
  overlayText = await overlay.evaluate((element) => element.shadowRoot?.textContent ?? '');
  expect(overlayText).toContain('gpt-5-6-pro');
  expect(overlayText).toContain('gpt-5-5-mini');
  expect(overlayText).toContain('063556');
  expect(overlayText).toContain('|');
  expect(overlayText).toContain('406870');
  expect(overlayText).not.toContain('诊断台');
  expect(overlayText).not.toContain('隐藏浮窗');
  const compactOverlayFontSizes = await overlay.evaluate((element) => Array.from(element.shadowRoot?.querySelectorAll<HTMLElement>('*') ?? [])
    .filter((child) => {
      const style = getComputedStyle(child);
      const box = child.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0;
    })
    .map((child) => getComputedStyle(child).fontSize)
    .filter((value, index, values) => values.indexOf(value) === index)
    .sort((left, right) => Number.parseFloat(left) - Number.parseFloat(right)));
  expect(compactOverlayFontSizes).toEqual(['10px', '12px', '14px', '16px']);
  await expect(overlay.locator('#mini-dock')).toHaveCount(0);
  await expect(overlay.locator('#expand')).not.toHaveAttribute('title', /.+/);
  await expect(overlay.locator('#expand')).toHaveAttribute('aria-label', '展开浮窗');
  const compactTop = await overlay.locator('.compact').evaluate((element) => element.getBoundingClientRect().top);
  await page.screenshot({ path: path.join(root, 'output', 'playwright', 'overlay-compact-e2e.png'), fullPage: true });
  await overlay.locator('#expand').click();
  await expect.poll(async () => worker.evaluate(async (key) => {
    const current = (await chrome.storage.local.get(key))[key] as {
      settings?: { overlayMode?: string; overlayMinimized?: boolean };
    } | undefined;
    return `${current?.settings?.overlayMode}:${current?.settings?.overlayMinimized}`;
  }, storageKey)).toBe('full:false');

  await overlay.locator('#mini').click();
  await expect.poll(async () => worker.evaluate(async (key) => {
    const current = (await chrome.storage.local.get(key))[key] as {
      settings?: { overlayMode?: string; overlayMinimized?: boolean; captureMode?: string };
    } | undefined;
    return `${current?.settings?.overlayMode}:${current?.settings?.overlayMinimized}:${current?.settings?.captureMode}`;
  }, storageKey)).toBe('mini:true:live');
  const miniText = await overlay.locator('.mini-hit').textContent();
  expect(miniText).toContain('gpt-5-5-mini');
  expect(miniText).toContain('406870');
  expect(miniText).not.toContain('请求模型');
  expect(miniText).not.toContain('响应路由');
  expect(miniText).not.toContain('PoW 难度');
  expect(miniText).not.toContain('063556');
  await expect(overlay.locator('.mini-divider')).toHaveCount(1);
  await expect(overlay.locator('#mini-dock')).not.toHaveAttribute('title', /.+/);
  await expect(overlay.locator('#mini-dock')).not.toHaveAttribute('data-tooltip', /.+/);
  await expect(overlay.locator('#mini-dock')).toHaveAttribute('aria-label', '停靠到边缘');
  await expect(overlay.locator('#expand')).not.toHaveAttribute('title', /.+/);
  await expect(overlay.locator('#expand')).toHaveAttribute('aria-label', '展开浮窗');
  await expect.poll(() => overlay.locator('.mini').evaluate((element, expectedTop) => {
    const rect = element.getBoundingClientRect();
    return {
      alignedTop: Math.abs(rect.top - expectedTop) <= 1,
      dockedRight: Math.abs(window.innerWidth - rect.right) <= 1,
      narrow: rect.width <= 160
    };
  }, compactTop)).toEqual({ alignedTop: true, dockedRight: true, narrow: true });
  const miniGeometry = await overlay.evaluate((element) => {
    const mini = element.shadowRoot?.querySelector<HTMLElement>('.mini');
    const divider = element.shadowRoot?.querySelector<HTMLElement>('.mini-divider');
    const dock = element.shadowRoot?.querySelector<HTMLElement>('.mini-dock-hit');
    if (!mini || !divider || !dock) return null;
    const miniBox = mini.getBoundingClientRect();
    const dividerBox = divider.getBoundingClientRect();
    const dockBox = dock.getBoundingClientRect();
    return {
      accentWidth: Math.round(miniBox.left - dockBox.left),
      dockBoundaryMatchesDivider: Math.abs(dockBox.right - dividerBox.left) <= 1,
      dockHeightCoversMini: dockBox.top <= miniBox.top && dockBox.bottom >= miniBox.bottom,
      height: miniBox.height,
      top: miniBox.top
    };
  });
  expect(miniGeometry).not.toBeNull();
  expect(miniGeometry?.accentWidth).toBe(5);
  expect(miniGeometry?.dockBoundaryMatchesDivider).toBe(true);
  expect(miniGeometry?.dockHeightCoversMini).toBe(true);
  await expect.poll(() => overlay.locator('.mini').evaluate((element) => {
    const original = element.className;
    const read = () => getComputedStyle(element).getPropertyValue('--mini-accent').trim();
    element.setAttribute('class', 'probe mini normal');
    const normal = read();
    element.setAttribute('class', 'probe mini danger');
    const danger = read();
    element.setAttribute('class', 'probe mini warn');
    const warn = read();
    element.setAttribute('class', original);
    return { danger, normal, warn };
  })).toEqual({ danger: '#f07868', normal: '#a9f04d', warn: '#efb55d' });
  await page.screenshot({ path: path.join(root, 'output', 'playwright', 'overlay-mini-e2e.png'), fullPage: true });
  await overlay.locator('#mini-dock').click();
  await expect.poll(async () => worker.evaluate(async (key) => {
    const current = (await chrome.storage.local.get(key))[key] as {
      settings?: { overlayMode?: string; overlayMinimized?: boolean };
    } | undefined;
    return `${current?.settings?.overlayMode}:${current?.settings?.overlayMinimized}`;
  }, storageKey)).toBe('docked:true');
  await expect(overlay.locator('.mini-docked')).toHaveCount(1);
  await expect(overlay.locator('.mini-docked')).toHaveText('');
  await expect(overlay.locator('#mini-undock')).not.toHaveAttribute('title', /.+/);
  await expect(overlay.locator('#mini-undock')).not.toHaveAttribute('data-tooltip', /.+/);
  await expect(overlay.locator('#mini-undock')).toHaveAttribute('aria-label', '恢复迷你浮窗');
  await expect.poll(() => overlay.locator('.mini-docked').evaluate((element, expected) => {
    const rect = element.getBoundingClientRect();
    const hit = element.querySelector<HTMLElement>('.mini-undock-hit')?.getBoundingClientRect();
    return {
      accentWidth: hit ? Math.round(rect.left - hit.left) : 0,
      alignedTop: Math.abs(rect.top - expected.top) <= 1,
      blackWidth: Math.round(rect.width),
      dockedRight: Math.abs(window.innerWidth - rect.right) <= 1,
      fullHandleWidth: hit ? Math.round(hit.right - hit.left) : 0,
      sameHeight: Math.abs(rect.height - expected.height) <= 1
    };
  }, miniGeometry!)).toEqual({ accentWidth: 5, alignedTop: true, blackWidth: 11, dockedRight: true, fullHandleWidth: 16, sameHeight: true });
  await page.screenshot({ path: path.join(root, 'output', 'playwright', 'overlay-mini-docked-e2e.png'), fullPage: true });
  await page.reload();
  await expect(overlay).toHaveCount(1);
  await expect(overlay.locator('.mini-docked')).toHaveCount(1);
  await expect.poll(async () => worker.evaluate(async (key) => {
    const current = (await chrome.storage.local.get(key))[key] as {
      settings?: { overlayMode?: string; overlayMinimized?: boolean };
    } | undefined;
    return `${current?.settings?.overlayMode}:${current?.settings?.overlayMinimized}`;
  }, storageKey)).toBe('docked:true');
  await overlay.locator('#mini-undock').click();
  await expect.poll(async () => worker.evaluate(async (key) => {
    const current = (await chrome.storage.local.get(key))[key] as {
      settings?: { overlayMode?: string; overlayMinimized?: boolean };
    } | undefined;
    return `${current?.settings?.overlayMode}:${current?.settings?.overlayMinimized}`;
  }, storageKey)).toBe('mini:true');
  await expect(overlay.locator('.mini')).toHaveCount(1);
  const regularViewport = page.viewportSize();
  await page.setViewportSize({ width: 360, height: 640 });
  await expect.poll(() => overlay.locator('.mini').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      contained: rect.left >= 0 && rect.right <= window.innerWidth,
      dockedRight: Math.abs(window.innerWidth - rect.right) <= 1,
      noHorizontalOverflow: element.scrollWidth <= element.clientWidth
    };
  })).toEqual({ contained: true, dockedRight: true, noHorizontalOverflow: true });
  await overlay.locator('#expand').click();
  await expect.poll(async () => worker.evaluate(async (key) => {
    const current = (await chrome.storage.local.get(key))[key] as {
      settings?: { overlayMode?: string; overlayMinimized?: boolean };
    } | undefined;
    return `${current?.settings?.overlayMode}:${current?.settings?.overlayMinimized}`;
  }, storageKey)).toBe('full:false');
  await expect.poll(() => overlay.locator('.probe').evaluate((element) => {
    const status = element.querySelector<HTMLElement>('.status');
    const title = element.querySelector<HTMLElement>('.title');
    const author = element.querySelector<HTMLElement>('.author');
    if (!status || !title || !author) return null;
    const original = status.textContent;
    status.textContent = '实际路由字段冲突';
    const statusBox = status.getBoundingClientRect();
    const contentRight = Math.max(title.getBoundingClientRect().right, author.getBoundingClientRect().right);
    const probeBox = element.getBoundingClientRect();
    const statusFullyVisible = status.scrollWidth <= status.clientWidth;
    status.textContent = original;
    return {
      contained: probeBox.left >= 0 && probeBox.right <= window.innerWidth,
      noBrandOverlap: contentRight <= statusBox.left,
      noHorizontalOverflow: element.scrollWidth <= element.clientWidth,
      statusFullyVisible
    };
  })).toEqual({ contained: true, noBrandOverlap: true, noHorizontalOverflow: true, statusFullyVisible: true });
  if (regularViewport) await page.setViewportSize(regularViewport);

  const untouchedTab = await context.newPage();
  await untouchedTab.goto('http://127.0.0.1:43996/');
  const untouchedOverlayHost = untouchedTab.locator('#chatgpt-route-inspector-root');
  const untouchedOverlay = await untouchedOverlayHost.evaluate((element) => element.shadowRoot?.textContent ?? '');
  expect(untouchedOverlay).toContain('等待下一次回答');
  expect(untouchedOverlay).not.toContain('检测到路由错配');
  await expect.poll(() => untouchedOverlayHost.evaluate((element) => {
    const status = element.shadowRoot?.querySelector<HTMLElement>('.status');
    if (!status) return null;
    const style = getComputedStyle(status);
    return {
      fits: status.scrollWidth <= status.clientWidth,
      singleLine: status.getBoundingClientRect().height <= Number.parseFloat(style.lineHeight) * 1.1,
      textAlign: style.textAlign,
      whiteSpace: style.whiteSpace
    };
  })).toEqual({ fits: true, singleLine: true, textAlign: 'right', whiteSpace: 'nowrap' });

  await overlay.locator('#mode-reload').click();
  await expect.poll(async () => worker.evaluate(async (key) => {
    const state = (await chrome.storage.local.get(key))[key] as { settings?: { captureMode?: string } } | undefined;
    return state?.settings?.captureMode ?? 'missing';
  }, storageKey)).toBe('reload');
  await expect.poll(async () => overlay.evaluate((element) => element.shadowRoot?.textContent ?? ''))
    .toContain('等待刷新会话');
  await expect.poll(() => overlay.evaluate((element) => {
    const hint = element.shadowRoot?.querySelector<HTMLElement>('.hint');
    if (!hint) return null;
    const style = getComputedStyle(hint);
    return {
      fits: hint.scrollWidth <= hint.clientWidth,
      singleLine: hint.getBoundingClientRect().height <= Number.parseFloat(style.lineHeight) * 1.1,
      text: hint.textContent,
      whiteSpace: style.whiteSpace
    };
  })).toEqual({ fits: true, singleLine: true, text: '刷新当前会话，读取响应路由。', whiteSpace: 'nowrap' });

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

  const projectReloadTab = await context.newPage();
  await projectReloadTab.goto('http://127.0.0.1:43996/g/g-p-e2e-project/c/e2e-conversation');
  await projectReloadTab.evaluate(() => localStorage.setItem('route-fixture-reload', '1'));
  await projectReloadTab.reload();
  const projectOverlay = projectReloadTab.locator('#chatgpt-route-inspector-root');
  await expect(projectOverlay).toHaveCount(1);
  await expect.poll(() => projectOverlay.evaluate((element) => element.shadowRoot?.textContent ?? ''))
    .toContain('gpt-5-5-mini');
  await expect.poll(() => projectOverlay.evaluate((element) => element.shadowRoot?.textContent ?? ''))
    .toContain('resolved_model_slug');
  await projectReloadTab.close();

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
  await dashboard.setViewportSize({ width: 2048, height: 1200 });
  await dashboard.goto(`chrome-extension://${extensionId}/ui/dashboard/index.html`);
  await expect(dashboard.getByText('路由诊断台')).toBeVisible();
  await expect(dashboard.getByText('实时请求').first()).toBeVisible();
  await expect(dashboard.getByText('会话重载').first()).toBeVisible();
  await expect(dashboard.getByText('GPT 5.6 Pro').first()).toBeVisible();
  await expect.poll(() => dashboard.evaluate(() => {
    const left = document.querySelector<HTMLElement>('.dashboard-grid > .column');
    const right = document.querySelector<HTMLElement>('.dashboard-grid > aside');
    const scroller = document.querySelector<HTMLElement>('.table-scroll');
    if (!left || !right || !scroller) return null;
    const leftBox = left.getBoundingClientRect();
    const rightBox = right.getBoundingClientRect();
    const scrollerBox = scroller.getBoundingClientRect();
    const shellBox = document.querySelector<HTMLElement>('.dashboard-shell')?.getBoundingClientRect();
    return {
      columnsSeparated: leftBox.right <= rightBox.left,
      scrollerContained: scrollerBox.right <= rightBox.left,
      overflowX: getComputedStyle(scroller).overflowX,
      pageOverflow: document.documentElement.scrollWidth > window.innerWidth,
      shellWidth: Math.round(shellBox?.width ?? 0)
    };
  })).toEqual({ columnsSeparated: true, scrollerContained: true, overflowX: 'auto', pageOverflow: false, shellWidth: 1600 });
  await expect(dashboard.locator('#detail .notice')).toHaveCount(0);
  await expect(dashboard.getByText('工具名称', { exact: true })).toHaveCount(0);
  await dashboard.screenshot({ path: path.join(root, 'output', 'playwright', 'dashboard-e2e.png'), fullPage: true });

  const popup = await context.newPage();
  await popup.setViewportSize({ width: 640, height: 600 });
  await popup.goto(`chrome-extension://${extensionId}/ui/popup/index.html`);
  await expect(popup.locator('.route-model strong')).toHaveText(['—', '—']);
  await expect(popup.locator('#pow-hex')).toHaveText('未捕获');
  await expect(popup.getByText('GPT 5.6 Pro')).toHaveCount(0);

  // A real action popup reads the underlying active tab. This test page is an ordinary
  // extension tab, so bring the ChatGPT fixture back to the foreground before reloading it.
  await page.bringToFront();
  await popup.reload();
  await expect(popup.getByText('已读取响应路由')).toBeVisible();
  await expect(popup.getByText('重载不提供')).toBeVisible();
  await expect(popup.getByText('会话重载').first()).toBeVisible();
  await expect(popup.locator('#pow-hex')).toHaveText('063556');
  await expect(popup.locator('#pow-decimal')).toHaveText('406870');
  await expect(popup.locator('#footer-machine')).toBeVisible();
  await expect(popup.locator('.toast')).toHaveCount(0);
  await expect(popup.locator('#mode-hint')).toHaveText('刷新当前会话，读取响应路由。');
  await expect.poll(() => popup.locator('#mode-hint').evaluate((hint) => {
    const style = getComputedStyle(hint);
    return {
      fits: hint.scrollWidth <= hint.clientWidth,
      singleLine: hint.getBoundingClientRect().height <= Number.parseFloat(style.lineHeight) * 1.1,
      whiteSpace: style.whiteSpace
    };
  })).toEqual({ fits: true, singleLine: true, whiteSpace: 'nowrap' });
  const secondaryButtonStyles = await popup.evaluate(() => {
    const copy = getComputedStyle(document.querySelector<HTMLElement>('#copy')!);
    const options = getComputedStyle(document.querySelector<HTMLElement>('#options')!);
    return {
      copy: [copy.backgroundColor, copy.borderColor, copy.color],
      options: [options.backgroundColor, options.borderColor, options.color]
    };
  });
  expect(secondaryButtonStyles.options).toEqual(secondaryButtonStyles.copy);
  await expect(popup.getByText('本地 / 自动')).toHaveCount(0);
  await expect.poll(() => popup.evaluate(() => {
    const buttons = document.querySelector<HTMLElement>('.button-stack')!.getBoundingClientRect();
    const pow = document.querySelector<HTMLElement>('.pow-readout')!.getBoundingClientRect();
    const footer = document.querySelector<HTMLElement>('.footer-link')!.getBoundingClientRect();
    const status = document.querySelector<HTMLElement>('#footer-machine')!.getBoundingClientRect();
    const records = document.querySelector<HTMLElement>('#record-count')!.getBoundingClientRect();
    return {
      footerAtBottom: Math.abs(window.innerHeight - footer.bottom) <= 1,
      powCenteredInGap: Math.abs((pow.top - buttons.bottom) - (footer.top - pow.bottom)) <= 1,
      recordsAtRight: Math.abs(records.right - (window.innerWidth - 17)) <= 1,
      statusAtLeft: Math.abs(status.left - 17) <= 1
    };
  })).toEqual({ footerAtBottom: true, powCenteredInGap: true, recordsAtRight: true, statusAtLeft: true });
  await expectPopupFits(popup);
  await overlay.locator('#hide').click();
  await expect(overlay).toHaveCount(0);
  await expect(popup.locator('#overlay-hide')).toHaveClass(/active/);
  await popup.locator('#overlay-show').click();
  await expect(overlay).toHaveCount(1);
  await expect(popup.locator('#overlay-show')).toHaveClass(/active/);
  await expect.poll(async () => worker.evaluate(async (key) => {
    const current = (await chrome.storage.local.get(key))[key] as {
      settings?: { overlayEnabled?: boolean; overlayMinimized?: boolean };
    } | undefined;
    return `${current?.settings?.overlayEnabled}:${current?.settings?.overlayMinimized}`;
  }, storageKey)).toBe('true:false');
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

  const reloadOverlayRouteGeometry = await overlay.evaluate((element) => {
    const route = element.shadowRoot?.querySelector<HTMLElement>('.route');
    const values = [...(element.shadowRoot?.querySelectorAll<HTMLElement>('.model b') ?? [])];
    return {
      routeHeight: route?.getBoundingClientRect().height ?? 0,
      valueHeights: values.map((value) => value.getBoundingClientRect().height)
    };
  });
  const reloadPopupGeometry = await popup.evaluate(() => ({
    resultHeight: document.querySelector<HTMLElement>('.popup-result-grid')?.getBoundingClientRect().height ?? 0,
    heroHeight: document.querySelector<HTMLElement>('.hero-readout')?.getBoundingClientRect().height ?? 0,
    lockupHeight: document.querySelector<HTMLElement>('.route-lockup')?.getBoundingClientRect().height ?? 0,
    valueHeights: [...document.querySelectorAll<HTMLElement>('.route-model strong')].map((value) => value.getBoundingClientRect().height)
  }));
  await popup.locator('#mode-live').click();
  await expect(popup.locator('#mode-live')).toHaveClass(/active/);
  const liveOverlayRouteGeometry = await overlay.evaluate((element) => {
    const route = element.shadowRoot?.querySelector<HTMLElement>('.route');
    const values = [...(element.shadowRoot?.querySelectorAll<HTMLElement>('.model b') ?? [])];
    return {
      routeHeight: route?.getBoundingClientRect().height ?? 0,
      valueHeights: values.map((value) => value.getBoundingClientRect().height)
    };
  });
  const livePopupGeometry = await popup.evaluate(() => ({
    resultHeight: document.querySelector<HTMLElement>('.popup-result-grid')?.getBoundingClientRect().height ?? 0,
    heroHeight: document.querySelector<HTMLElement>('.hero-readout')?.getBoundingClientRect().height ?? 0,
    lockupHeight: document.querySelector<HTMLElement>('.route-lockup')?.getBoundingClientRect().height ?? 0,
    valueHeights: [...document.querySelectorAll<HTMLElement>('.route-model strong')].map((value) => value.getBoundingClientRect().height)
  }));
  expect(liveOverlayRouteGeometry).toEqual(reloadOverlayRouteGeometry);
  expect(reloadOverlayRouteGeometry).toEqual({ routeHeight: 64, valueHeights: [18, 18] });
  expect(livePopupGeometry).toEqual(reloadPopupGeometry);
  expect(reloadPopupGeometry.resultHeight).toBe(156);
  expect(Math.abs(reloadPopupGeometry.heroHeight - 156)).toBeLessThan(1);
  expect(reloadPopupGeometry.lockupHeight).toBe(37);
  expect(reloadPopupGeometry.valueHeights).toEqual([21, 21]);
  await popup.locator('#mode-reload').click();
  await expect(popup.locator('#mode-reload')).toHaveClass(/active/);

  await popup.locator('[data-language="en"]').click();
  await expect(popup.locator('html')).toHaveAttribute('lang', 'en');
  await expect(popup.getByText('Label only')).toBeVisible();
  await expect(dashboard.getByText('Route diagnostics')).toBeVisible();
  await expect.poll(async () => overlay.evaluate((element) => element.shadowRoot?.textContent ?? ''))
    .toContain('Label only');
  await expect.poll(async () => untouchedOverlayHost.evaluate((element) => element.shadowRoot?.textContent ?? ''))
    .toContain('Awaiting reload');
  const englishRegularViewport = page.viewportSize();
  await page.setViewportSize({ width: 360, height: 640 });
  const englishOverlayLayout = await overlay.evaluate((element, labels) => {
    const status = element.shadowRoot?.querySelector<HTMLElement>('.status');
    const title = element.shadowRoot?.querySelector<HTMLElement>('.title');
    const author = element.shadowRoot?.querySelector<HTMLElement>('.author');
    const compact = element.shadowRoot?.querySelector<HTMLElement>('#compact');
    const probe = element.shadowRoot?.querySelector<HTMLElement>('.probe');
    const hint = element.shadowRoot?.querySelector<HTMLElement>('.hint');
    if (!status || !title || !author || !compact || !probe || !hint) return null;
    const original = status.textContent;
    const cases = labels.map((label) => {
      status.textContent = label;
      const statusBox = status.getBoundingClientRect();
      const statusStyle = getComputedStyle(status);
      const contentRight = Math.max(title.getBoundingClientRect().right, author.getBoundingClientRect().right);
      return {
        fullyVisible: status.scrollWidth <= status.clientWidth,
        label,
        lines: Math.round(statusBox.height / Number.parseFloat(statusStyle.lineHeight)),
        noBrandOverlap: contentRight <= statusBox.left,
        noButtonOverlap: statusBox.right <= compact.getBoundingClientRect().left
      };
    });
    status.textContent = original;
    const hintBox = hint.getBoundingClientRect();
    const probeBox = probe.getBoundingClientRect();
    return {
      cases,
      hintContained: hintBox.left >= probeBox.left && hintBox.right <= probeBox.right && hint.scrollWidth <= hint.clientWidth,
      lang: probe.lang,
      noHorizontalOverflow: probe.scrollWidth <= probe.clientWidth,
      textAlign: getComputedStyle(status).textAlign,
      whiteSpace: getComputedStyle(status).whiteSpace
    };
  }, [
    'Awaiting answer',
    'Awaiting reload',
    'Route normal',
    'Route mismatch',
    'Route conflict',
    'Route captured',
    'Label only',
    'Route missing',
    'Capturing'
  ]);
  expect(englishOverlayLayout).not.toBeNull();
  expect(englishOverlayLayout?.lang).toBe('en');
  expect(englishOverlayLayout?.textAlign).toBe('right');
  expect(englishOverlayLayout?.whiteSpace).toBe('nowrap');
  expect(englishOverlayLayout?.hintContained).toBe(true);
  expect(englishOverlayLayout?.noHorizontalOverflow).toBe(true);
  expect(englishOverlayLayout?.cases.filter((entry) =>
    !entry.fullyVisible || entry.lines !== 1 || !entry.noBrandOverlap || !entry.noButtonOverlap
  )).toEqual([]);
  await expect(overlay.locator('.full-pow > span')).toHaveText('POW');
  await expect.poll(() => overlay.locator('.full-pow > span').evaluate((label) => {
    const range = document.createRange();
    range.selectNodeContents(label);
    return { lines: range.getClientRects().length, whiteSpace: getComputedStyle(label).whiteSpace };
  })).toEqual({ lines: 1, whiteSpace: 'nowrap' });
  await page.screenshot({ path: path.join(root, 'output', 'playwright', 'overlay-english-narrow-e2e.png'), fullPage: true });
  if (englishRegularViewport) await page.setViewportSize(englishRegularViewport);
  await page.screenshot({ path: path.join(root, 'output', 'playwright', 'overlay-english-e2e.png'), fullPage: true });
  await untouchedTab.screenshot({ path: path.join(root, 'output', 'playwright', 'overlay-english-awaiting-reload-e2e.png'), fullPage: true });
  await expectPopupFits(popup);

  await popup.locator('#mode-live').click();
  await expect(popup.locator('#footer-status')).toHaveText('Switched: Live request');
  await expect(popup.getByText('Route mismatch')).toBeVisible();
  const adapterValue = popup.getByText('page_fetch+page_websocket');
  await expect(adapterValue).toBeVisible();
  await expect.poll(() => adapterValue.evaluate((element) => ({
    singleLine: element.getBoundingClientRect().height <= Number.parseFloat(getComputedStyle(element).lineHeight) * 1.1,
    fullyVisible: element.scrollWidth <= element.clientWidth
  }))).toEqual({ singleLine: true, fullyVisible: true });
  await expectPopupFits(popup);

  const options = await context.newPage();
  await options.setViewportSize({ width: 1600, height: 900 });
  await options.goto(`chrome-extension://${extensionId}/ui/options/index.html`);
  await expect(options.getByText('Settings & privacy').first()).toBeVisible();
  await expect(options.getByText('Configuration', { exact: true })).toHaveCount(0);
  await expect(options.locator('#mode')).toHaveCount(0);
  await expect(options.getByText('Automatic capture', { exact: true })).toBeVisible();
  await expect(options.getByText('Route records stay on this device. Request IDs are redacted by default when exported.', { exact: true })).toBeVisible();
  await expect(options.locator('.author-link')).toHaveAttribute('href', 'https://blog.liu-qi.cn/tools/');
  await expect.poll(() => options.evaluate(() => ({
    shellWidth: Math.round(document.querySelector<HTMLElement>('.options-shell')?.getBoundingClientRect().width ?? 0),
    pageOverflow: document.documentElement.scrollWidth > window.innerWidth
  }))).toEqual({ shellWidth: 1040, pageOverflow: false });
  await options.locator('[data-language="zh"]').click();
  await expect(options.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(options.getByText('设置与隐私', { exact: true })).toBeVisible();
  await expect(options.getByText('配置', { exact: true })).toHaveCount(0);
  await expect(options.locator('#mode')).toHaveCount(0);
  await options.locator('[data-language="en"]').click();
  await expect(options.locator('html')).toHaveAttribute('lang', 'en');

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
