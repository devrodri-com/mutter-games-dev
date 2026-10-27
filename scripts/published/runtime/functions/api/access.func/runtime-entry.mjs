import { runRuntime } from './runtime-loop.mjs';
import { invokeAccess } from './runtime-access.mjs';
try {
  await runRuntime(async () => {
    if (process.version !== 'v24.22.1' || process.versions.undici !== '7.30.1') throw new Error('PINNED_RUNTIME_VERSION_MISMATCH');
    const [{ default: access }, { default: catalogEdit }, { default: catalogMedia }, { default: checkout }, { default: reconcile }] = await Promise.all([
      import('./api/access.js'), import('./api/catalog-edit.js'), import('./api/catalog-media.js'),
      import('./api/create-mp-preference.js'), import('./api/internal/web-stock-reconcile.js'),
    ]);
    const handlers = new Map([
      ['/api/access/session', access], ['/api/access/recovery/request', access],
      ['/api/access/recovery/complete', access], ['/api/access/new-purchase-choice', access],
      ['/api/catalog-edit', catalogEdit], ['/api/catalog-media', catalogMedia],
      ['/api/create-mp-preference', checkout], ['/api/internal/web-stock-reconcile', reconcile],
    ]);
    if ([...handlers.values()].some(handler => typeof handler !== 'function')) throw new Error('REQUIRED_HANDLER_MISSING');
    return event => invokeAccess(event, (request, response) => {
      const handler = handlers.get(request.url.split('?')[0]);
      if (!handler) return response.status(404).json({ error: 'Not found' });
      return handler(request, response);
    });
  });
} catch {
  console.error('ACCESS_RUNTIME_STOPPED'); process.exitCode = 1;
}
