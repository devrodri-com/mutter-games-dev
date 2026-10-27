import { expect, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

export type Diagnostic = { at: number; kind: string; message?: string; url?: string; status?: number; headers?: Record<string, string> };
const localOrigin = 'http://127.0.0.1:5277';
const channelPath = '/google.firestore.v1.Firestore/Listen/channel';

function listenSession(raw: string | undefined) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.origin !== 'http://127.0.0.1:8188' || url.pathname !== channelPath ||
      url.searchParams.get('database') !== 'projects/demo-mutter-r1/databases/(default)') return null;
    return url.searchParams.get('SID');
  } catch { return null; }
}

export function isDocumentUnloadDiagnostic(event: Diagnostic, events: Diagnostic[], browserName: string | undefined) {
  const match = event.message?.match(/^\/127\.0\.0\.1:8188\/google\.firestore\.v1\.Firestore\/Listen\/channel\?(.+) due to access control checks\.$/);
  const session = match ? listenSession(`http://127.0.0.1:8188${channelPath}?${match[1]}`) : null;
  const cancelled = session && events.some(item => item.kind === 'request-failed' &&
    listenSession(item.url) === session && (item.message === 'cancelled' || item.message === 'Load request cancelled') && Math.abs(item.at - event.at) < 1000);
  const response = session && events.some(item => item.kind === 'listen-response' &&
    listenSession(item.url) === session && item.status === 200 && item.at <= event.at &&
    item.headers?.['access-control-allow-origin'] === localOrigin && item.headers?.['access-control-allow-credentials'] === 'true');
  const unloading = events.some(item => item.kind === 'pagehide' && item.url?.startsWith(`${localOrigin}/`) && Math.abs(item.at - event.at) < 1000);
  return browserName === 'webkit' && Boolean(session && cancelled && response && unloading);
}

export async function collectBrowserDiagnostics(page: Page) {
  const events: Diagnostic[] = [];
  await page.exposeFunction('__dependencyBrowserDiagnostic', (event: unknown) => {
    if (!event || typeof event !== 'object' || !('kind' in event) || typeof event.kind !== 'string') {
      throw new Error('Malformed browser diagnostic');
    }
    const message = 'message' in event && typeof event.message === 'string' ? event.message : undefined;
    const url = 'url' in event && typeof event.url === 'string' ? event.url : undefined;
    events.push({ at: Date.now(), kind: event.kind, message, url });
  });
  await page.addInitScript(() => {
    const report = (event: { kind: string; message?: string; url?: string }) => {
      const callback: unknown = Reflect.get(window, '__dependencyBrowserDiagnostic');
      if (typeof callback !== 'function') throw new Error('Browser diagnostic binding missing');
      void callback(event);
    };
    window.addEventListener('error', event => report({ kind: 'window-error', message: event.message }));
    window.addEventListener('unhandledrejection', event => report({ kind: 'unhandled-rejection', message: String(event.reason) }));
    window.addEventListener('pagehide', () => report({ kind: 'pagehide', url: location.href }));
  });
  page.on('pageerror', error => events.push({ at: Date.now(), kind: 'pageerror', message: error.message }));
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') {
      events.push({ at: Date.now(), kind: `console-${message.type()}`, message: message.text() });
    }
  });
  page.on('response', response => {
    if (listenSession(response.url())) events.push({ at: Date.now(), kind: 'listen-response', url: response.url(), status: response.status(), headers: response.headers() });
  });
  page.on('requestfailed', request => {
    events.push({ at: Date.now(), kind: 'request-failed', url: request.url(), message: request.failure()?.errorText });
  });

  return async (testInfo: TestInfo) => {
    const classified: Diagnostic[] = [];
    const unexpected: Diagnostic[] = [];
    for (const event of events.filter(item => item.kind === 'pageerror')) {
      // WebKit also emits console network diagnostics as pageerror. Only a proven
      // local Listen stream cancellation during document unload is classified here.
      // Errors/rejections from application JavaScript always fail independently.
      if (isDocumentUnloadDiagnostic(event, events, page.context().browser()?.browserType().name())) classified.push(event);
      else unexpected.push(event);
    }
    const nativeErrors = events.filter(item => item.kind === 'window-error' || item.kind === 'unhandled-rejection');
    const reactErrors = events.filter(item => /Duplicate extension names|Maximum update depth|Invalid hook call/.test(item.message ?? ''));
    const output = testInfo.outputPath('browser-diagnostics.json');
    await writeFile(output, JSON.stringify({ events, classifiedDocumentUnloads: classified, unexpected, nativeErrors, reactErrors }, null, 2));
    await testInfo.attach('browser-diagnostics.json', { path: output, contentType: 'application/json' });
    if (nativeErrors.length || reactErrors.length || unexpected.length) {
      // Failed CI jobs may retain logs without uploading the local Playwright attachment.
      console.error('SYNTHETIC_BROWSER_DIAGNOSTICS', JSON.stringify({ events, classifiedDocumentUnloads: classified, unexpected, nativeErrors, reactErrors }));
    }
    expect(nativeErrors, 'Application ErrorEvent/unhandledrejection').toEqual([]);
    expect(reactErrors, 'React/editor diagnostics').toEqual([]);
    expect(unexpected, 'Unclassified Playwright pageerrors').toEqual([]);
  };
}
