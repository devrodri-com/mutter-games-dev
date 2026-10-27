import { test, expect, type Page, type Locator } from '@playwright/test';
import { collectBrowserDiagnostics } from './browser-diagnostics';
import { readFile } from 'node:fs/promises';

const fixture = '/tests/e2e/fixtures/dependency-consumers.html';
const diagnostics = new WeakMap<Page, Awaited<ReturnType<typeof collectBrowserDiagnostics>>>();
test.beforeEach(async ({ page }) => {
  // Block all external traffic; local emulators remain the only service targets.
  await page.route(url => !['127.0.0.1', 'localhost'].includes(url.hostname), route => route.abort());
  diagnostics.set(page, await collectBrowserDiagnostics(page));
});

test.afterEach(async ({ page }, testInfo) => {
  const verify = diagnostics.get(page);
  if (!verify) throw new Error('Browser diagnostics were not installed');
  await verify(testInfo);
});

async function settledCarousel(carousel: Locator) {
  await expect.poll(() => carousel.evaluate(element => {
    if (!('swiper' in element) || !element.swiper || typeof element.swiper !== 'object' || !('animating' in element.swiper)) {
      throw new Error('Actual Swiper instance unavailable');
    }
    return element.swiper.animating;
  })).toBe(false);
}

test('actual order label downloads a landscape PDF with accented text, local logo and QR', async ({ page }, testInfo) => {
  const businessWrites: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && !request.url().includes('vite')) businessWrites.push(request.url());
  });
  // The repository has no /logo-etiqueta.png asset; supply a clearly synthetic local image.
  const logo = await readFile(new URL('./fixtures/synthetic-label-logo.png', import.meta.url));
  await page.route('**/logo-etiqueta.png', route => route.fulfill({ status: 200, contentType: 'image/png', body: logo }));
  await page.goto(`${fixture}?mode=label`);
  await expect(page.getByText('Reservada', { exact: true })).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Imprimir etiqueta', exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('Etiqueta-DEPENDENCY-SYNTHETIC-1.pdf');
  const path = await download.path();
  if (!path) throw new Error('Real PDF download missing');
  const bytes = await readFile(path);
  await download.saveAs(testInfo.outputPath('real-order-label.pdf'));
  const pdf = bytes.toString('latin1');
  expect(pdf.startsWith('%PDF-')).toBe(true);
  expect(pdf).toMatch(/\/MediaBox\s*\[\s*0\s+0\s+432(?:\.0*)?\s+288(?:\.0*)?\s*\]/);
  for (const value of ['Etiqueta de Envío', 'DEPENDENCY-SYNTHETIC-1', 'José Pérez', 'Ñandú', 'Montevideo', '11000']) expect(pdf).toContain(value);
  expect(pdf.match(/\/Subtype\s*\/Image/g)?.length).toBeGreaterThanOrEqual(2);
  // The two actual image placements are emitted by the production logo/QRCode path.
  expect(pdf).toContain('/I0 Do'); expect(pdf).toContain('/I1 Do');
  await expect(page.getByRole('button', { name: 'Imprimir etiqueta', exact: true })).toBeEnabled();
  await expect(page.getByText('Reservada', { exact: true })).toBeVisible();
  expect(businessWrites).toEqual([]);
  await testInfo.attach('real-order-label.pdf', { body: bytes, contentType: 'application/pdf' });
  await page.route('**/logo-etiqueta.png', route => route.fulfill({ status: 503, body: 'Synthetic local logo failure' }));
  await page.getByRole('button', { name: 'Imprimir etiqueta', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('No pudimos cargar el logo de la etiqueta.');
  await expect(page.getByRole('button', { name: 'Imprimir etiqueta', exact: true })).toBeEnabled();
  await expect(page.getByText('Reservada', { exact: true })).toBeVisible();
  expect(businessWrites).toEqual([]);
});

for (const styled of [false, true]) {
  test(`actual editor preserves supported HTML through edit and serialization (styled=${styled})`, async ({ page }) => {
    await page.goto(`${fixture}?mode=editor&styled=${styled}`);
    const editor = page.locator('.tiptap[contenteditable="true"]');
    await expect(editor).toBeVisible();
    if (styled) await expect(editor).toHaveClass(/prose/);
    else await expect(editor).not.toHaveClass(/prose/);
    async function supportedContent() {
      await expect(editor.locator('h2')).toHaveText('Edición sintética ñ');
      await expect(editor.locator('strong')).toHaveText('Consola');
      await expect(editor.locator('em')).toHaveText('clásica');
      await expect(editor.locator('u')).toHaveText('garantía');
      await expect(editor.locator('span[style*="color"]')).toHaveText('Rojo');
      await expect(editor.locator('span[style*="color"]')).toHaveCSS('color', 'rgb(255, 0, 0)');
      await expect(editor.locator('ul li')).toHaveText('Accesorio');
      await expect(editor.locator('ol li')).toHaveText('Manual');
      await expect(editor.locator('blockquote')).toHaveText('Cita');
      await expect(editor.locator('pre code')).toHaveText('const x = 1');
      await expect(editor.locator('p > code')).toHaveText('código');
      await expect(editor.locator('s')).toHaveText('Tachado');
      await expect(editor.locator('hr')).toHaveCount(1);
      await expect(editor.locator('br')).toHaveCount(1);
    }
    await supportedContent();
    await editor.locator('strong').evaluate(element => {
      element.closest<HTMLElement>('[contenteditable]')?.focus();
      const selection = window.getSelection(), range = document.createRange();
      range.selectNodeContents(element);
      selection?.removeAllRanges(); selection?.addRange(range);
    });
    await expect(page.getByRole('button', { name: 'Bold', exact: true })).toHaveClass(/bg-black/);
    await editor.locator('h2').click();
    await editor.locator('h2').evaluate(element => {
      element.closest<HTMLElement>('[contenteditable]')?.focus();
      const selection = window.getSelection(), range = document.createRange();
      range.selectNodeContents(element); range.collapse(false);
      selection?.removeAllRanges(); selection?.addRange(range);
    });
    // Actual keyboard movement commits the DOM selection before toolbar/edit assertions.
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('button', { name: 'H2', exact: true })).toHaveClass(/bg-black/);
    await expect(page.getByRole('button', { name: 'Bold', exact: true })).not.toHaveClass(/bg-black/);
    await page.keyboard.insertText(' revisada');
    await expect(page.getByTestId('editor-output')).toContainText('Edición sintética ñ revisada');
    await page.keyboard.press('ControlOrMeta+z');
    await expect(editor.locator('h2')).toHaveText('Edición sintética ñ');
    await page.getByRole('button', { name: 'Reload serialized content', exact: true }).click();
    await supportedContent();
    const serialized = await page.getByTestId('editor-output').textContent();
    expect(serialized).toContain('<u>garantía</u>');
    expect(serialized).toContain('<blockquote>');

  });
}

test('real home carousel keeps pagination, loop, autoplay and shop navigation', async ({ page }, testInfo) => {
  await page.goto('/');
  const carousel = page.locator('.swiper').first();
  const bullets = carousel.locator('.swiper-pagination-bullet');
  await expect(bullets).toHaveCount(3);
  await bullets.nth(1).click();
  await expect(carousel.locator('.swiper-slide-active')).toContainText('Coleccionables originales');
  await settledCarousel(carousel);
  await bullets.nth(2).click();
  await expect(carousel.locator('.swiper-slide-active')).toContainText('Envíos rápidos y seguros');
  await settledCarousel(carousel);
  // Actual 7s autoplay must wrap the final slide back to the first.
  await expect(carousel.locator('.swiper-slide-active')).toContainText('Todo para tu consola', { timeout: 11000 });
  await page.screenshot({ path: testInfo.outputPath('hero-after-loop.png') });
  await carousel.locator('.swiper-slide-active').getByText('Ver tienda', { exact: true }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/shop(?:\?|$)/);
  await expect(page.getByRole('heading', { name: 'Productos disponibles', exact: true }).filter({ visible: true })).toBeVisible();

});

test('retained PromoSlider uses actual controls and keeps its local shop link', async ({ page }) => {
  await page.goto(`${fixture}?mode=promo`);
  const carousel = page.locator('.swiper');
  const bullets = carousel.locator('.swiper-pagination-bullet');
  await expect(bullets).toHaveCount(9);
  await bullets.nth(1).click();
  await expect(bullets.nth(1)).toHaveClass(/swiper-pagination-bullet-active/);
  await settledCarousel(carousel);
  if ((page.viewportSize()?.width ?? 0) >= 640) {
    await page.getByRole('button', { name: 'Siguiente', exact: true }).click();
    await expect(bullets.nth(2)).toHaveClass(/swiper-pagination-bullet-active/);
    await settledCarousel(carousel);
    await page.getByRole('button', { name: 'Anterior', exact: true }).click();
    await expect(bullets.nth(1)).toHaveClass(/swiper-pagination-bullet-active/);
    await settledCarousel(carousel);
  }
  await carousel.locator('.swiper-slide-active a').click();
  await expect(page).toHaveURL(/\/shop$/);

});

test('real SPA routes preserve direct paths, category navigation and back history', async ({ page }) => {
  await page.goto('/explore');
  await page.getByRole('button').filter({ has: page.getByRole('img', { name: 'PlayStation', exact: true }) }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Productos disponibles', exact: true }).filter({ visible: true })).toBeVisible();
  // Wait for the real catalog effect to finish URL normalization before navigating back.
  const isIOS = await page.evaluate(() => /iPad|iPhone|iPod/.test(navigator.userAgent));
  await expect(page).toHaveURL(isIOS ? /\/shop\?category=PlayStation$/ : /\/shop\?sort=az$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/explore$/);
  await page.goto('/this-route-does-not-exist');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator('.swiper')).toBeVisible();

});
