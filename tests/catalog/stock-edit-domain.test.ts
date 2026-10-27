import { expect, test } from 'vitest';
import { applyCatalogChanges, changedFields, type JsonObject, type JsonValue } from '../../src/domain/catalogEdit';

const options = (stock: JsonValue): JsonValue[] => [{ label: { es: 'Modelo', en: 'Model', pt: 'Legado' }, unknown: true,
  options: [{ value: 'Única', priceUSD: 125, stock, variantId: 'stable', unknown: null }] }];
const raw = (): JsonObject => ({ active: false, title: { es: 'Original', pt: 'Legado' }, priceUSD: 125,
  stockTotal: 9, variants: options(5), images: ['https://example.invalid/image'], webCatalogVersion: 'legacy-marker',
  webReservations: { synthetic_reservation_01: { expiresAt: 1, lines: [{ slot: '0:0', identity: '["Modelo","Model","Única","stable"]', quantity: 3 }] } },
  unknown: { preserved: null } });

test('option stock changes derive only the delta and preserve historical offset, metadata, holds and state', () => {
  const product = raw(), changes = { variants: options(4) };
  expect(changedFields(product, changes)).toEqual(changes);
  expect(applyCatalogChanges(product, changes)).toEqual({ ...raw(), variants: options(4), stockTotal: 8 });
  expect(product).toEqual(raw());
  expect(changedFields(product, { variants: options(5) })).toEqual({});
});

test('base stock is an explicit quantity, zero is valid without holds, and missing aggregate stays missing', () => {
  const base: JsonObject = { active: true, stockTotal: 5, unknown: 'keep' };
  expect(applyCatalogChanges(base, { stockTotal: 0 })).toEqual({ active: true, stockTotal: 0, unknown: 'keep' });
  const missing = raw(); delete missing.stockTotal;
  expect(applyCatalogChanges(missing, { variants: options(4) })).toEqual({ ...missing, variants: options(4) });
});

test('combined base and variant updates are rejected before deriving a conflicting expected readback', () => {
  const base: JsonObject = { stockTotal: 5 };
  const newOptions = [{ label: { es: 'Modelo' }, options: [{ value: 'Única', priceUSD: 125, stock: 2 }] }];
  expect(changedFields(base, { stockTotal: 6 })).toEqual({ stockTotal: 6 });
  expect(changedFields(base, { variants: newOptions })).toEqual({ variants: newOptions });
  expect(() => changedFields(base, { stockTotal: 6, variants: newOptions })).toThrow('Editá el stock de cada opción');
  expect(() => applyCatalogChanges(raw(), { stockTotal: 5, variants: options(4) })).toThrow('Editá el stock de cada opción');
});

test('reserved units remain a floor even after expiry and malformed quantities never become zero', () => {
  expect(() => changedFields(raw(), { variants: options(2) })).toThrow('unidades reservadas');
  for (const stock of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '', '3']) {
    expect(() => changedFields({ stockTotal: 5 }, { stockTotal: stock })).toThrow('entero');
    expect(() => changedFields(raw(), { variants: options(stock) })).toThrow();
  }
});

test('descriptive changes preserve untouched invalid legacy stock and reservation bytes', () => {
  const legacy: JsonObject = { ...raw(), stockTotal: 'legacy', variants: options(-1), webReservations: { legacy: true } };
  expect(applyCatalogChanges(legacy, { title: { es: 'Edited' } })).toEqual({ ...legacy, title: { es: 'Edited', pt: 'Legado' } });
  expect(changedFields(legacy, { variants: options(-1), title: { es: 'Edited' } })).toEqual({ title: { es: 'Edited' } });
});
