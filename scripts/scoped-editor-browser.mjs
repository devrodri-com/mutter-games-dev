// Local visual/keyboard fixture: real editor and persistence client. Only the
// identity and HTTP provider boundaries are synthetic; no end-user claim.
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('..', import.meta.url));
const evidence = path.resolve(root, '../../evidence/frontend-edit/browser');
await mkdir(evidence, { recursive: true });
for (const name of ['FIREBASE_PRIVATE_KEY', 'FIREBASE_CLIENT_EMAIL', 'GOOGLE_APPLICATION_CREDENTIALS', 'VERCEL_TOKEN']) {
  if (process.env[name]) throw new Error('Credential environment forbidden');
}
const virtualFirebase = '\0scoped-editor-synthetic-firebase';
const virtualAuth = '\0scoped-editor-synthetic-auth';
const initial = () => ({ active: false, title: { es: 'Publicación existente', pt: 'Legado conservado' },
  description: '<p>Descripción original con <strong>formato básico</strong>.</p>', category: { id: 'cat', name: 'Juegos' },
  subcategory: { id: 'sub', name: 'Consolas', categoryId: 'cat' }, images: ['/synthetic-image.svg'],
  priceUSD: 100, stockTotal: 2, variants: [{ legacy: true }], preserved: { document: 'synthetic' } });
let product = initial(), version = '100:1', patchCount = 0, policy;
const server = await createServer({ root, configFile: false, envDir: false,
  cacheDir: path.join(evidence, 'vite-cache'), esbuild: { jsx: 'automatic' },
  optimizeDeps: { entries: ['tests/catalog/scoped-editor-browser.tsx'], include: ['react/jsx-dev-runtime'] },
  resolve: { alias: { '@': path.join(root, 'src') } },
  server: { host: '127.0.0.1', port: 5287, strictPort: true },
  plugins: [{ name: 'scoped-editor-synthetic-boundaries', enforce: 'pre',
    resolveId(source, importer) {
      if (source === 'firebase/auth') return virtualAuth;
      if (importer && source.startsWith('.') && path.resolve(path.dirname(importer), source).replace(/\.ts$/, '') === path.join(root, 'src/firebase')) return virtualFirebase;
    },
    load(id) {
      if (id === virtualFirebase) return `export const auth={currentUser:{uid:'visual-synthetic',getIdToken:async()=>'synthetic-token'}};export const db={};`;
      if (id === virtualAuth) return `export const beforeAuthStateChanged=()=>()=>{};export const signInWithCustomToken=()=>{throw Error('Unexpected exchange')};`;
    },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://127.0.0.1:5287');
        const send = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
        try {
          if (url.pathname === '/scoped-editor-test.html') {
            res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml(url.pathname,
              '<html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/catalog/scoped-editor-browser.tsx"></script></body></html>')); return;
          }
          if (url.pathname === '/synthetic-image.svg') { res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><rect width="120" height="120" fill="#ddd"/><text x="8" y="60">Imagen existente</text></svg>'); return; }
          if (url.pathname === '/api/access/session') { send({ status: 'ACTIVE', uid: 'visual-synthetic', admin: true, superadmin: false, scope: 'JOHN_ADMIN_CLOSED_V1', expiresAtMs: Date.now() + 60000 }); return; }
          if (url.pathname !== '/api/catalog-edit') { next(); return; }
          assert.equal(url.searchParams.get('id'), 'publication');
          if (req.method === 'GET') { send({ id: 'publication', version, product, capabilities: { editExisting: true } }); return; }
          assert.equal(req.method, 'PATCH'); const chunks = []; for await (const chunk of req) chunks.push(chunk);
          const edit = policy.parseEditRequest(Buffer.concat(chunks).toString()); assert.equal(edit.version, version);
          assert.deepEqual(edit.changes, { title: { es: 'Título comprobado' } }); patchCount++;
          product = { ...product, title: { ...product.title, es: 'Título comprobado' } }; version = '101:1';
          send({ status: 'CONFIRMED', id: 'publication', operationId: edit.operationId, version,
            baseVersion: edit.version, changes: edit.changes, requestHash: policy.requestHash('publication', edit) });
        } catch (error) { res.statusCode = 500; send({ error: String(error) }); }
      });
    },
  }],
});
let browser;
const result = { synthetic: true, productionCalls: 0, inspections: [] };
try {
  policy = await server.ssrLoadModule('/api/_lib/catalog-edit-policy.ts'); await server.listen();
  browser = await chromium.launch({ headless: true });
  for (const [name, width, height] of [['desktop', 1440, 1000], ['mobile', 390, 844]]) {
    product = initial(); version = '100:1'; patchCount = 0;
    const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
    const external = [], errors = []; const page = await context.newPage();
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname === '127.0.0.1') return route.continue();
      external.push(url.origin); return route.abort();
    });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:5287/scoped-editor-test.html');
    await page.getByRole('button', { name: 'Editar', exact: true }).click();
    // Headless UI's relative dialog root contains fixed positioned visible
    // children, so visibility is checked on its actual heading and controls.
    const dialog = page.getByRole('dialog'); await dialog.waitFor({ state: 'attached' });
    await page.getByRole('heading', { name: 'Editar publicación' }).waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement));
    assert.equal(await page.locator('input[type="color"]').count(), 0);
    const focusSequence = [];
    for (let index = 0; index < 24; index++) {
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement)), true);
      focusSequence.push(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.trim().slice(0, 60) || document.activeElement?.tagName));
    }
    await page.getByLabel('Título', { exact: true }).fill('Título comprobado');
    await page.screenshot({ path: path.join(evidence, `${name}.png`), fullPage: true });
    if (name === 'mobile') {
      await page.getByRole('button', { name: 'Guardar Cambios' }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(evidence, 'mobile-actions.png') });
    }
    await writeFile(path.join(evidence, `${name}.aria.txt`), await dialog.ariaSnapshot());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('button', { name: 'Editar', exact: true }).evaluate(element => element === document.activeElement), true);
    await page.getByRole('button', { name: 'Editar', exact: true }).click();
    await page.getByLabel('Título', { exact: true }).fill('Título comprobado');
    await page.getByRole('button', { name: 'Guardar Cambios', exact: true }).click();
    await page.getByText('Guardado y comprobado', { exact: true }).waitFor();
    assert.equal(patchCount, 1); assert.equal(product.active, false); assert.equal(product.title.pt, 'Legado conservado');
    assert.equal(product.description, initial().description);
    // Existing site CSS references Google Fonts. The route aborts it before
    // transmission; the visual check uses the local fallback font.
    assert.equal(external.every(origin => origin === 'https://fonts.googleapis.com'), true); assert.deepEqual(errors, []);
    result.inspections.push({ name, viewport: { width, height }, focusSequence, keyboardTrap: true, escapeRestoresFocus: true,
      noHorizontalOverflow: true, patches: patchCount, preservedState: true, blockedExternalRequests: external, pageErrors: errors });
    await context.close();
  }
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser?.close(); await server.close(); }
