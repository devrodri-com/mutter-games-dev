// Reuses the scoped-editor Vite/Playwright boundary harness. All images, SDK
// reads, admission and publication requests below are synthetic local fixtures.
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('..', import.meta.url));
const evidence = path.resolve(root, `../evidence/browser-${new Date().toISOString().replace(/[:.]/g, '-')}`);
await mkdir(evidence, { recursive: true });
for (const name of ['FIREBASE_PRIVATE_KEY', 'FIREBASE_CLIENT_EMAIL', 'GOOGLE_APPLICATION_CREDENTIALS', 'VERCEL_TOKEN']) {
  if (process.env[name]) throw new Error('Credential environment forbidden');
}
const fakeFirebase = '\0publication-fixture-firebase', fakeAuth = '\0publication-fixture-auth';
const fakeContext = '\0publication-fixture-context', fakeFirestore = '\0publication-fixture-firestore';
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><rect width="320" height="320" rx="30" fill="#f3f4f6"/><rect x="65" y="105" width="190" height="100" rx="25" fill="#374151"/><circle cx="110" cy="155" r="23" fill="#e5e7eb"/><circle cx="211" cy="146" r="9" fill="#ff2d55"/><circle cx="229" cy="166" r="9" fill="#ff2d55"/><text x="160" y="258" text-anchor="middle" font-size="18" font-family="sans-serif" fill="#6b7280">Imagen de prueba</text></svg>';
const initial = (index = 0) => ({ active: index !== 0, title: { es: ['Nintendo Game Boy Color — edición clásica', 'PlayStation 2 Slim con accesorios', 'Super Mario World — Super Nintendo', 'Control inalámbrico para Nintendo Switch'][index], en: 'Hidden saved title', pt: 'Legado conservado' },
  description: { es: '<p style="color:#333">Consola original, revisada y en buen estado.</p><p>Incluye <strong>cable y accesorios</strong>.</p>', en: '<p>Hidden saved description.</p>', pt: '<p>Legado conservado.</p>' },
  category: { id: 'cat', name: 'Consolas' }, subcategory: { id: 'sub', name: 'Retro', categoryId: 'cat' }, tipo: 'Consola',
  images: ['https://images.example.invalid/catalog.svg', 'https://images.example.invalid/second.svg'], priceUSD: 120 + index * 25,
  stockTotal: 4, sku: `MUT-${index + 1}`, variants: [{ label: { es: 'Modelo', en: 'Model', pt: 'Modelo' }, legacy: true,
    options: [{ value: 'Original', priceUSD: 120 + index * 25, stock: 4, variantId: `identity-${index}`, preserved: true }] }], preserved: { document: 'synthetic' } });
const editedTitle = 'Nintendo Game Boy Color — edición comprobada', editedDescription = '<p>Descripción comprobada en español.</p>';
const edited = () => ({ ...initial(), sku: 'LOCAL-VERIFIED', title: { ...initial().title, es: editedTitle }, description: { ...initial().description, es: editedDescription } });
let products, versions, receipts, media, counts, policy, fields, createPolicy;
function reset() { products = new Map([0, 1, 2, 3].map(index => [`publication-${index}`, initial(index)])); versions = new Map([...products.keys()].map(id => [id, '100:1'])); receipts = new Map(); media = new Map(); counts = { patch: 0, create: 0, upload: 0 }; }
reset();
const server = await createServer({ root, configFile: false, envDir: false, cacheDir: path.join(evidence, 'vite-cache'),
  esbuild: { jsx: 'automatic' }, optimizeDeps: { entries: ['tests/catalog/publication-management-browser.tsx'], include: ['react/jsx-dev-runtime'] },
  resolve: { preserveSymlinks: true, alias: { '@': path.join(root, 'src') } }, server: { host: '127.0.0.1', port: 0, strictPort: true },
  plugins: [{ name: 'publication-synthetic-boundaries', enforce: 'pre',
    resolveId(source, importer) {
      if ([fakeFirebase, fakeAuth, fakeContext, fakeFirestore].includes(source)) return source;
      if (source === 'firebase/auth') return fakeAuth;
      if (source === 'firebase/firestore') return fakeFirestore;
      if (importer && source.startsWith('.')) {
        const resolved = path.resolve(path.dirname(importer), source).replace(/\.tsx?$/, '');
        if ([path.join(root, 'src/firebase'), path.join(root, 'src/firebaseUtils')].includes(resolved)) return fakeFirebase;
        if (resolved === path.join(root, 'src/context/AuthContext')) return fakeContext;
      }
    },
    load(id) {
      if (id === fakeFirebase) return `export const auth={currentUser:{uid:new URL(location.href).searchParams.get('actor')||'john',getIdToken:async()=>'synthetic-token'}};export const db={};`;
      if (id === fakeContext) return `import{auth}from${JSON.stringify(fakeFirebase)};export const useAuth=()=>({user:{uid:auth.currentUser.uid,email:auth.currentUser.uid+'@example.invalid'},credentialScope:'JOHN_ADMIN_CLOSED_V1',logout:()=>{throw Error('No logout in fixture')}});`;
      if (id === fakeAuth) return 'export const beforeAuthStateChanged=()=>()=>{};export const signInWithCustomToken=()=>{throw Error("Unexpected exchange")};';
      if (id === fakeFirestore) return `export const collection=(_db,...parts)=>parts.join('/');export const doc=()=>{throw Error('Unexpected doc read')};export const addDoc=()=>{throw Error('Unexpected direct write')};export const deleteDoc=()=>{throw Error('Unexpected delete')};export const getDocs=async(path)=>({docs:[{id:path==='categories'?'cat':'sub',data:()=>({name:path==='categories'?'Consolas':'Retro'})}]});export const getDocsFromServer=async()=>({docs:(await(await fetch('/__fixture/catalog')).json()).map(item=>({id:item.id,data:()=>item.product}))});`;
    },
    configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, 'http://127.0.0.1:5288');
      const send = (value, status = 200) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
      try {
        if (url.pathname === '/publication-test.html') { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml(url.pathname,
          '<html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/tests/catalog/publication-management-browser.tsx"></script></body></html>')); return; }
        if (url.pathname === '/__fixture/catalog') { send([...products].map(([id, product]) => ({ id, product }))); return; }
        if (url.pathname === '/api/access/session') {
          const origin = req.headers.referer ? new URL(req.headers.referer) : null;
          send({ status: 'ACTIVE', uid: origin?.searchParams.get('actor') || 'john', admin: true, superadmin: false, scope: 'JOHN_ADMIN_CLOSED_V1', expiresAtMs: Date.now() + 60000 }); return;
        }
        if (!['/api/catalog-edit', '/api/catalog-media'].includes(url.pathname)) { next(); return; }
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
        if (url.pathname === '/api/catalog-media') {
          if (req.method === 'POST' && body.intent === 'prepare') { media.set(body.operationId, body); send({ status: 'ISSUED', imageOperationId: body.operationId, productId: body.productId, token: 'synthetic-token', expire: Math.floor(Date.now() / 1000) + 60,
            fields: { fileName: 'synthetic.png', useUniqueFileName: 'false', overwriteFile: 'false' } }); return; }
          if (req.method === 'POST' && body.intent === 'confirm') { const issued = media.get(body.operationId); assert.equal(issued.productId, body.productId); send({ status: 'CONFIRMED', imageOperationId: body.operationId, productId: body.productId, url: `https://images.example.invalid/${body.operationId}.png` }); return; }
          throw Error('Unexpected media request');
        }
        const id = url.searchParams.get('id'), operation = url.searchParams.get('operationId');
        if (req.method === 'GET') { send(operation ? receipts.get(operation) : { id, version: versions.get(id), product: products.get(id), capabilities: { editExisting: true } }); return; }
        if (req.method === 'PATCH') {
          const edit = policy.parseEditRequest(body); assert.equal(edit.version, versions.get(id));
          if (counts.patch === 0) assert.deepEqual(edit.changes, { title: { es: editedTitle }, description: { es: editedDescription }, sku: 'LOCAL-VERIFIED' });
          else { assert.equal(counts.patch, 1); assert.deepEqual(Object.keys(edit.changes), ['variants']); assert.equal(edit.changes.variants[0].options[0].stock, 3); }
          const [seconds, nanoseconds] = versions.get(id).split(':').map(Number);
          const update = policy.editUpdate({ exists: true, updateTime: { seconds, nanoseconds }, data: () => products.get(id) }, edit);
          counts.patch++; products.set(id, { ...products.get(id), ...update }); versions.set(id, `${100 + counts.patch}:1`);
          const receipt = { status: 'CONFIRMED', id, operationId: edit.operationId, version: versions.get(id), baseVersion: edit.version, changes: edit.changes, requestHash: policy.requestHash(id, edit) };
          receipts.set(edit.operationId, receipt); send(receipt); return;
        }
        assert.equal(req.method, 'POST'); assert.equal(body.intent, 'create'); assert.equal(id, `admin-${body.operationId}`); counts.create++;
        const product = createPolicy.normalizeCatalogCreate(body.product, body.operationId); products.set(id, product); versions.set(id, '102:1');
        const requestHash = createHash('sha256').update(fields.canonicalJson(fields.catalogCreateHashPayload(id, body))).digest('hex');
        const receipt = { status: 'CONFIRMED', intent: 'create', id, operationId: body.operationId, version: '102:1', requestHash, product };
        receipts.set(body.operationId, receipt); send(receipt, 201);
      } catch (error) { send({ error: String(error), applied: false }, 500); }
    }); },
  }],
});
async function choose(page, label, option) {
  await page.getByRole('button', { name: new RegExp('^' + label + '(?: |$)') }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
let browser, activePage;
const result = { synthetic: true, productionCalls: 0, evidence, inspections: [] };
try {
  [policy, fields, createPolicy] = await Promise.all([server.ssrLoadModule('/api/_lib/catalog-edit-policy.ts'), server.ssrLoadModule('/api/_lib/catalog-edit-fields.ts'), server.ssrLoadModule('/api/_lib/catalog-edit-create.ts')]);
  await server.listen(); const address = server.httpServer.address(); assert(address && typeof address === 'object'); const browserOrigin = `http://127.0.0.1:${address.port}`; browser = await chromium.launch({ headless: true });
  for (const [name, width, height, actor] of [['desktop', 1440, 1000, 'john'], ['mobile', 390, 844, 'rodrigo']]) {
    reset(); const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' }), page = await context.newPage();
    activePage = page;
    const blocked = [], errors = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname === '127.0.0.1') return route.continue();
      if (url.hostname === 'images.example.invalid') return route.fulfill({ contentType: 'image/svg+xml', body: svg });
      if (url.hostname === 'upload.imagekit.io') { counts.upload++; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ fileId: 'synthetic-file' }) }); }
      blocked.push(url.origin); return route.abort();
    });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${browserOrigin}/publication-test.html?actor=${actor}`);
    await page.getByRole('button', { name: initial().title.es, exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(evidence, `${name}-list.png`), fullPage: true });
    const categoryFilter = page.getByRole('button', { name: /^Filtrar por categoría(?: |$)/ });
    await categoryFilter.focus(); await page.keyboard.press('ArrowDown');
    await page.getByRole('listbox').waitFor();
    await page.screenshot({ path: path.join(evidence, `${name}-filter-menu.png`) });
    await page.keyboard.press('End'); await page.keyboard.press('Enter');
    assert.equal(await categoryFilter.innerText(), 'Consolas');
    await choose(page, 'Filtrar por categoría', 'Todas las categorías');

    await page.getByRole('button', { name: initial().title.es, exact: true }).click();
    const dialog = page.getByRole('dialog'); await dialog.waitFor({ state: 'attached' });
    await page.getByLabel('SKU', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.getByLabel(/en inglés/i).count(), 0);
    assert.equal(await page.getByLabel('Título', { exact: true }).inputValue(), initial().title.es);
    assert.equal(await page.getByLabel('Nombre de variante', { exact: true }).inputValue(), 'Modelo');
    assert.equal(await page.getByRole('region', { name: 'Descripción guardada' }).innerText(), 'Consola original, revisada y en buen estado.\nIncluye cable y accesorios.');
    assert.equal(await page.locator('textarea[aria-label="Descripción"]').count(), 0);
    await page.screenshot({ path: path.join(evidence, `${name}-editor.png`) });
    const categoryField = page.getByRole('button', { name: /^Categoría(?: |$)/ });
    await categoryField.click(); await page.getByRole('listbox').waitFor();
    await page.screenshot({ path: path.join(evidence, `${name}-editor-menu.png`) });
    const menuBox = await page.getByRole('listbox').boundingBox();
    assert(menuBox && menuBox.x >= 0 && menuBox.x + menuBox.width <= width + 1);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('listbox').count(), 0);
    assert.equal(await page.getByRole('dialog').count(), 1);
    assert.equal(await categoryField.evaluate(element => element === document.activeElement), true);

    await page.getByRole('region', { name: 'Descripción guardada' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(evidence, `${name}-description.png`) });
    await page.getByRole('button', { name: 'Editar descripción', exact: true }).click();
    const description = page.getByRole('textbox', { name: 'Descripción', exact: true }); await description.waitFor();
    for (const caption of ['Negrita', 'Cursiva', 'Subrayado']) assert.equal(await page.getByRole('button', { name: caption, exact: true }).count(), 1);
    await description.fill('Descripción comprobada en español.');
    await page.getByLabel('Título', { exact: true }).fill(editedTitle);
    await page.getByLabel('SKU', { exact: true }).fill('LOCAL-VERIFIED');
    const focusSequence = [];
    for (let index = 0; index < 10; index++) { await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement)), true); focusSequence.push(await page.evaluate(() => document.activeElement?.tagName)); }
    await page.getByRole('button', { name: 'Guardar cambios', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(evidence, `${name}-editor-actions.png`) });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
    await page.getByText('Cambios guardados y comprobados.', { exact: true }).waitFor();
    assert.equal(counts.patch, 1); assert.deepEqual(products.get('publication-0'), edited());
    await page.getByRole('button', { name: editedTitle, exact: true }).click();
    const stock = page.getByLabel('Stock variante 1 opción 1', { exact: true });
    await stock.waitFor({ state: 'visible' }); assert.equal(await stock.inputValue(), '4'); await stock.fill('3');
    assert.equal(await page.locator('output[aria-label="Stock total"]').innerText(), '3');
    await stock.scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(evidence, `${name}-stock-edit.png`) });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
    await page.getByText('Cambios guardados y comprobados.', { exact: true }).waitFor();
    await page.getByRole('button', { name: editedTitle, exact: true }).click();
    await page.getByLabel('Stock variante 1 opción 1', { exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.getByLabel('Stock variante 1 opción 1', { exact: true }).inputValue(), '3');
    assert.equal(await page.locator('output[aria-label="Stock total"]').innerText(), '3');
    assert.equal(counts.patch, 2); assert.equal(products.get('publication-0').stockTotal, 3);
    assert.equal(products.get('publication-0').active, false); assert.deepEqual(products.get('publication-0').preserved, initial().preserved);
    assert.deepEqual(products.get('publication-0').variants[0].options[0], { ...initial().variants[0].options[0], stock: 3 });
    await page.getByLabel('Stock variante 1 opción 1', { exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(evidence, `${name}-stock-reopened.png`) });
    await page.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await page.getByRole('button', { name: 'Crear publicación', exact: true }).click();
    assert.equal(await page.getByLabel(/en inglés/i).count(), 0);
    await page.getByLabel('Título', { exact: true }).fill('Publicación de prueba local');
    await choose(page, 'Categoría', 'Consolas'); await choose(page, 'Subcategoría', 'Retro');
    await choose(page, 'Tipo', 'Consolas');
    await page.getByLabel('Precio', { exact: true }).fill('75');
    await page.getByLabel('Stock variante 1 opción 1', { exact: true }).fill('3');
    await page.getByLabel('Agregar imagen', { exact: true }).setInputFiles({ name: 'synthetic.png', mimeType: 'image/png', buffer: Buffer.from('synthetic-image-bytes') });
    await page.getByRole('link', { name: 'Abrir imagen 1', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Crear publicación', exact: true }).last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(evidence, `${name}-create.png`) });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.getByRole('button', { name: 'Crear publicación', exact: true }).last().click();
    await page.getByText('Publicación creada y comprobada.', { exact: true }).waitFor();
    assert.equal(counts.create, 1); assert.equal(counts.upload, 1); assert.equal(products.size, 5);
    const created = [...products].find(([id]) => id.startsWith('admin-'))?.[1]; assert.equal(created.active, false); assert.equal(created.stockTotal, 3); assert.equal(created.priceUSD, 75);
    assert.deepEqual(products.get('publication-0').description, edited().description); assert.deepEqual(errors, []);
    assert.equal(blocked.every(origin => origin === 'https://fonts.googleapis.com'), true);
    await writeFile(path.join(evidence, `${name}.aria.txt`), await page.locator('body').ariaSnapshot());
    result.inspections.push({ name, actor, viewport: { width, height }, noHorizontalOverflow: true, keyboardTrap: true, focusSequence,
      patch: counts.patch, create: counts.create, uploads: counts.upload, stockSavedAndReopened: true, stockTotal: 3, stockUnknownAndStatePreserved: true, originalStateAndLanguagesPreserved: true, spanishOnlyControls: true, createdInactive: true, blockedExternalRequests: blocked, pageErrors: errors });
    await context.close();
  }
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true });
    await writeFile(path.join(evidence, 'failure.aria.txt'), await activePage.locator('body').ariaSnapshot());
  }
  await writeFile(path.join(evidence, 'failure.json'), JSON.stringify({ ...result, error: String(error) }, null, 2)); throw error;
}
finally { await browser?.close(); await server.close(); }
