import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareCatalogStockUpdate } from '../../api/_lib/catalog-edit-stock.js';
import { mergeCatalogVariants, assertVariantReservationIdentity } from '../../api/_lib/catalog-edit-variants.js';
import { parseEditRequest } from '../../api/_lib/catalog-edit-policy.js';
import { identityForOption } from '../../src/domain/webInventory.js';

const options = (stock = 5) => [{ label: { es: 'Color', en: 'Colour' }, legacy: 'keep',
  options: [{ value: 'Azul', variantId: 'blue', stock, priceUSD: 100, original: { keep: true } }] }];
const hold = (slot = 'base', identity = 'base', quantity = 3) => ({
  reservation_original_001: { expiresAt: 1, lines: [{ slot, identity, quantity }] },
});
test('accepts only explicit integer stock and preserves business-field restrictions', () => {
  const base = { version: '1:2', intent: 'edit', operationId: '01234567-1234-4123-8123-123456789abc' };
  assert.deepEqual(parseEditRequest({ ...base, changes: { stockTotal: 0 } }).changes, { stockTotal: 0 });
  for (const stockTotal of [-1, 1.5, '2', null, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => parseEditRequest({ ...base, changes: { stockTotal } }));
  for (const changes of [{ active: true }, { webReservations: {} }, { updatedAt: 1 }])
    assert.throws(() => parseEditRequest({ ...base, changes }));
});
test('base stock respects all retained reservations, even past their stated deadline', () => {
  const current = { active: true, stockTotal: 5, webReservations: hold() };
  assert.deepEqual(prepareCatalogStockUpdate(current, { stockTotal: 3 }), {});
  assert.throws(() => prepareCatalogStockUpdate(current, { stockTotal: 2 }), /reservadas/);
  assert.deepEqual(current, { active: true, stockTotal: 5, webReservations: hold() });
});
test('variant stock delta preserves the historical aggregate difference and unknown fields', () => {
  const current = { stockTotal: 8, variants: options() };
  const variants = mergeCatalogVariants(current.variants, [{ options: [{ stock: 2 }] }]);
  assert.deepEqual(variants, options(2));
  assert.deepEqual(prepareCatalogStockUpdate(current, { variants }), { stockTotal: 5 });
  assert.throws(() => prepareCatalogStockUpdate(current, { variants, stockTotal: 2 }), /cada opción/);
  assert.deepEqual(prepareCatalogStockUpdate({ variants: options() }, { variants }), {});
});
test('existing reserved identities allow quantity edits without permitting identity changes', () => {
  const variants = options(), identity = identityForOption(variants[0].label, variants[0].options[0]);
  const current = { stockTotal: 5, variants, webReservations: hold('0:0', identity) };
  const next = mergeCatalogVariants(variants, [{ options: [{ stock: 3 }] }]);
  assert.doesNotThrow(() => assertVariantReservationIdentity(current, next));
  assert.deepEqual(prepareCatalogStockUpdate(current, { variants: next }), { stockTotal: 3 });
  assert.throws(() => prepareCatalogStockUpdate(current, { variants: options(2) }), /reservadas/);
  const renamed = mergeCatalogVariants(variants, [{ options: [{ value: 'Red' }] }]);
  assert.throws(() => assertVariantReservationIdentity(current, renamed), /reservas pendientes/);
});
test('malformed inventory is preserved on descriptive edits and blocks ambiguous stock changes', () => {
  const current = { stockTotal: 'legacy', variants: options(), webReservations: { broken: true } };
  assert.deepEqual(prepareCatalogStockUpdate(current, { title: 'A title' }), {});
  const priceOnly = mergeCatalogVariants(current.variants, [{ options: [{ priceUSD: 150 }] }]);
  assert.deepEqual(prepareCatalogStockUpdate(current, { variants: priceOnly }), {});
  assert.throws(() => prepareCatalogStockUpdate(current, { variants: options(4) }));
  assert.throws(() => prepareCatalogStockUpdate({ stockTotal: 5, webReservations: { broken: true } }, { stockTotal: 4 }));
});
test('aggregate and option limits reject overflow, fractions and negative stock', () => {
  for (const stock of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => mergeCatalogVariants(options(), [{ options: [{ stock }] }]));
  assert.throws(() => prepareCatalogStockUpdate({ stockTotal: Number.MAX_SAFE_INTEGER, variants: options() }, { variants: options(6) }));
  assert.throws(() => prepareCatalogStockUpdate({ stockTotal: 1, variants: options() }, { variants: options(0) }));
});
