import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Client } from '../../src/data/types';
import { mapClientDocument } from '../../src/domain/clientDocument';
import { parseCJProductResponse } from '../../src/domain/cjProduct';

type Reference = { collection: string; id?: string };
type Snapshot = { exists: () => boolean; data: () => Record<string, unknown> };
type Documents = { docs: { id: string; data: () => Record<string, unknown> }[] };
const sdk = vi.hoisted(() => ({
  app: { options: { projectId: 'demo-payload-contracts' } }, db: { kind: 'synthetic-db' }, auth: { currentUser: null },
  doc: vi.fn<(db: unknown, collection: string, id: string) => Reference>(),
  collection: vi.fn<(db: unknown, collection: string) => Reference>(),
  getDoc: vi.fn<(reference: Reference) => Promise<Snapshot>>(),
  getDocs: vi.fn<(query: unknown) => Promise<Documents>>(),
  query: vi.fn<(reference: unknown, ...constraints: unknown[]) => unknown>(),
  orderBy: vi.fn<(field: string, direction: string) => unknown>(),
  serverTimestamp: vi.fn<() => unknown>(),
  setDoc: vi.fn<(reference: Reference, data: Record<string, unknown>, options?: { merge: boolean }) => Promise<void>>(),
  addDoc: vi.fn<(reference: Reference, data: Record<string, unknown>) => Promise<{ id: string }>>(),
  updateDoc: vi.fn<(...args: unknown[]) => Promise<never>>(),
  deleteDoc: vi.fn<(...args: unknown[]) => Promise<never>>(),
  createUser: vi.fn<(...args: unknown[]) => Promise<never>>(),
  ensureAuthReady: vi.fn<() => Promise<never>>(),
  fetch: vi.fn<typeof fetch>(),
}));
vi.mock('../../src/firebase', () => ({ default: sdk.app, ensureAuthReady: sdk.ensureAuthReady }));
vi.mock('firebase/app', () => ({ getApp: () => sdk.app }));
vi.mock('firebase/auth', () => ({ getAuth: () => sdk.auth, createUserWithEmailAndPassword: sdk.createUser }));
vi.mock('firebase/firestore', () => ({ initializeFirestore: () => sdk.db, getFirestore: () => sdk.db,
  doc: sdk.doc, collection: sdk.collection, getDoc: sdk.getDoc, getDocs: sdk.getDocs, query: sdk.query,
  orderBy: sdk.orderBy, serverTimestamp: sdk.serverTimestamp, setDoc: sdk.setDoc, addDoc: sdk.addDoc,
  updateDoc: sdk.updateDoc, deleteDoc: sdk.deleteDoc }));

function snapshot(exists: boolean, data: Record<string, unknown> = {}): Snapshot {
  return { exists: () => exists, data: () => data };
}
function clientFixture(): Client {
  return { name: 'Example', email: 'NEW@EXAMPLE.TEST', phone: '5550100', address: 'Example street',
    city: 'Example city', state: 'Example state', zip: '10000', country: 'UY' };
}
function responseFor(value: unknown): Response {
  const response = new Response('{}');
  vi.spyOn(response, 'json').mockResolvedValue(value);
  return response;
}
function expectNoOtherMutations() {
  for (const operation of [sdk.updateDoc, sdk.deleteDoc, sdk.createUser, sdk.ensureAuthReady]) expect(operation).not.toHaveBeenCalled();
}
function expectNoWrites() {
  expect(sdk.setDoc).not.toHaveBeenCalled();
  expect(sdk.addDoc).not.toHaveBeenCalled();
  expectNoOtherMutations();
}
function savedClient(): Record<string, unknown> {
  const call = sdk.setDoc.mock.calls[0];
  if (!call) throw new Error('Missing synthetic client write');
  return call[1];
}
beforeEach(() => {
  vi.resetModules();
  sdk.doc.mockReset().mockImplementation((_db, collection, id) => ({ collection, id }));
  sdk.collection.mockReset().mockImplementation((_db, collection) => ({ collection }));
  sdk.getDoc.mockReset().mockResolvedValue(snapshot(false));
  sdk.getDocs.mockReset().mockResolvedValue({ docs: [] });
  sdk.query.mockReset().mockImplementation((reference, ...constraints) => ({ reference, constraints }));
  sdk.orderBy.mockReset().mockImplementation((field, direction) => ({ field, direction }));
  sdk.serverTimestamp.mockReset().mockReturnValue({ kind: 'synthetic-timestamp' });
  sdk.setDoc.mockReset().mockResolvedValue(undefined);
  sdk.addDoc.mockReset().mockResolvedValue({ id: 'synthetic-cj-product' });
  for (const operation of [sdk.updateDoc, sdk.deleteDoc, sdk.createUser, sdk.ensureAuthReady]) {
    operation.mockReset().mockRejectedValue(new Error('Unexpected synthetic operation'));
  }
  sdk.fetch.mockReset().mockRejectedValue(new Error('Unexpected network request'));
  vi.stubGlobal('fetch', sdk.fetch);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

test('client mapping preserves primary-field priority, lowercase without trimming and opaque timestamps', () => {
  const createdAt = { syntheticTimestamp: 1 }, updatedAt = ['opaque', 2];
  const actual = mapClientDocument('client-example', { name: 'Primary', fullName: { ignored: true }, email: ' ADMIN@EXAMPLE.TEST ',
    phone: 'phone', phoneNumber: 99, address: 'address', addressLine1: [], city: 'city', state: 'state', department: true,
    zip: 'zip', postalCode: {}, country: 'UY', createdAt, updatedAt });
  expect(actual).toStrictEqual({ id: 'client-example', name: 'Primary', email: ' admin@example.test ', phone: 'phone',
    address: 'address', city: 'city', state: 'state', zip: 'zip', country: 'UY', createdAt, updatedAt });
  expect(actual.createdAt).toBe(createdAt);
  expect(actual.updatedAt).toBe(updatedAt);
  expectNoWrites();
});

test('client mapping applies the original falsy fallbacks before validating selected values', () => {
  expect(mapClientDocument('fallback', { name: 0, fullName: 'Alias', email: false, phone: '', phoneNumber: 'alias phone',
    address: null, addressLine1: 'alias address', city: NaN, state: undefined, department: 'alias state', zip: false,
    postalCode: 'alias zip', country: 0 })).toStrictEqual({ id: 'fallback', name: 'Alias', email: '', phone: 'alias phone',
    address: 'alias address', city: '', state: 'alias state', zip: 'alias zip', country: '', createdAt: undefined, updatedAt: undefined });
  expect(mapClientDocument('empty', {})).toStrictEqual({ id: 'empty', name: '-', email: '', phone: '', address: '',
    city: '', state: '', zip: '', country: '', createdAt: undefined, updatedAt: undefined });
});

test.each([
  { field: 'name', data: { fullName: { personalMarker: 'must-not-leak' } } },
  { field: 'email', data: { email: { personalMarker: 'must-not-leak' } } },
  { field: 'phone', data: { phoneNumber: ['must-not-leak'] } },
])('client mapping rejects a selected invalid $field with a fixed message without its value', value => {
  expect(() => mapClientDocument('example', value.data)).toThrow(new Error('Campo de cliente inválido: ' + value.field));
  expectNoWrites();
});

test('CJ parser returns the same validated data object and keeps optional values and opaque description', () => {
  const description = { arbitrary: ['opaque', 1] };
  const data = { name: 'Example', productImageInfoList: [{ imageUrl: '/example.webp' }, { imageUrl: null }, {}],
    productInfo: { sellPrice: 12.5, description }, productVariantInfoList: [
      { variantSku: 7, variantKey: 'Blue', imageUrl: '/blue.webp', sellPrice: '3.5' },
      { variantSku: 'SKU', variantKey: null, imageUrl: null, sellPrice: null }, {},
    ] };
  const parsed = parseCJProductResponse({ data });
  expect(parsed).toBe(data);
  expect(parsed.productInfo?.description).toBe(description);
  for (const optional of [null, undefined]) {
    const value = { name: '', productImageInfoList: optional, productInfo: optional, productVariantInfoList: optional };
    const result = parseCJProductResponse({ data: value });
    expect(result).toBe(value);
    expect(result.productImageInfoList).toBe(optional);
    expect(result.productInfo).toBe(optional);
    expect(result.productVariantInfoList).toBe(optional);
  }
});

const malformedCJ = [
  { name: 'missing root', value: null, message: 'Producto no encontrado en CJ' },
  { name: 'missing data', value: {}, message: 'Producto no encontrado en CJ' },
  { name: 'invalid name', value: { data: { name: 42 } }, message: 'Respuesta de producto inválida de CJ' },
  { name: 'invalid image list', value: { data: { name: 'Example', productImageInfoList: {} } }, message: 'Respuesta de producto inválida de CJ' },
  { name: 'invalid image element', value: { data: { name: 'Example', productImageInfoList: [null] } }, message: 'Respuesta de producto inválida de CJ' },
  { name: 'invalid image field', value: { data: { name: 'Example', productImageInfoList: [{ imageUrl: 9 }] } }, message: 'Respuesta de producto inválida de CJ' },
  { name: 'invalid info price', value: { data: { name: 'Example', productInfo: { sellPrice: true } } }, message: 'Respuesta de producto inválida de CJ' },
  { name: 'invalid variant element', value: { data: { name: 'Example', productVariantInfoList: [null] } }, message: 'Respuesta de producto inválida de CJ' },
  { name: 'invalid variant price', value: { data: { name: 'Example', productVariantInfoList: [{ sellPrice: {} }] } }, message: 'Respuesta de producto inválida de CJ' },
];
test.each(malformedCJ)('CJ parser rejects $name without exposing payload content', value => {
  expect(() => parseCJProductResponse(value.value)).toThrow(new Error(value.message));
  expectNoWrites();
});

test('real CJ import maps validated primitive prices and IDs into the same synthetic product write', async () => {
  const actual = await import('../../src/firebaseUtils');
  const description = { text: 'Opaque description' };
  sdk.fetch.mockResolvedValue(responseFor({ data: { name: 'Demo  Product',
    productImageInfoList: [{ imageUrl: '/one.webp' }, { imageUrl: null }, {}], productInfo: { sellPrice: 12.5, description },
    productVariantInfoList: [{ variantSku: 101, variantKey: 'Blue', imageUrl: '/blue.webp', sellPrice: '7.5' },
      { variantSku: 'SKU-2', variantKey: null, imageUrl: null, sellPrice: 0 }, { variantSku: null, sellPrice: null }, {}] } }));
  expect(await actual.importProductFromCJ('CJ-EXAMPLE')).toBe('synthetic-cj-product');
  expect(sdk.fetch).toHaveBeenCalledTimes(1);
  expect(sdk.fetch).toHaveBeenCalledWith('https://developers.cjdropshipping.com/api2.0/v1/product/getProductInfo',
    expect.objectContaining({ method: 'POST', body: JSON.stringify({ productSkuId: 'CJ-EXAMPLE' }) }));
  expect(sdk.addDoc).toHaveBeenCalledTimes(1);
  expect(sdk.addDoc).toHaveBeenCalledWith({ collection: 'products' }, { title: 'Demo  Product', name: 'Demo  Product',
    images: ['/one.webp', null, undefined], priceUSD: 12.5, slug: 'CJ-EXAMPLE-demo-product', description,
    category: { id: '', name: 'Dropshipping' }, subcategory: { id: '', name: 'CJ' }, active: true,
    variants: [{ id: 101, name: 'Blue', image: '/blue.webp', price: 7.5 },
      { id: 'SKU-2', name: null, image: null, price: 0 }, { id: null, name: undefined, image: undefined, price: NaN },
      { id: undefined, name: undefined, image: undefined, price: NaN }] });
  expect(sdk.setDoc).not.toHaveBeenCalled();
  expectNoOtherMutations();
});

test('real CJ import keeps empty-list, description and base-price fallbacks for nullable optional data', async () => {
  const actual = await import('../../src/firebaseUtils');
  sdk.fetch.mockResolvedValue(responseFor({ data: { name: 'Bare', productImageInfoList: null, productInfo: null, productVariantInfoList: null } }));
  await actual.importProductFromCJ('BARE');
  expect(sdk.addDoc).toHaveBeenCalledWith({ collection: 'products' }, { title: 'Bare', name: 'Bare', images: [], priceUSD: 0,
    slug: 'BARE-bare', description: '', category: { id: '', name: 'Dropshipping' }, subcategory: { id: '', name: 'CJ' },
    active: true, variants: [] });
});

test('real CJ import rejects malformed decoded payload before addDoc and rethrows JSON failure unchanged', async () => {
  const actual = await import('../../src/firebaseUtils');
  sdk.fetch.mockResolvedValueOnce(responseFor({ data: { name: 'Example', productVariantInfoList: [{ variantSku: {} }] } }));
  await expect(actual.importProductFromCJ('INVALID')).rejects.toHaveProperty('message', 'Respuesta de producto inválida de CJ');
  const failure = new SyntaxError('Synthetic invalid JSON');
  const response = new Response('{}');
  vi.spyOn(response, 'json').mockRejectedValue(failure);
  sdk.fetch.mockResolvedValueOnce(response);
  await expect(actual.importProductFromCJ('BAD-JSON')).rejects.toBe(failure);
  expectNoWrites();
  expect(sdk.collection).not.toHaveBeenCalled();
});

test('real client reader uses the mapper, retains query order and rejects malformed records without writes', async () => {
  const actual = await import('../../src/firebaseUtils');
  const timestamp = { opaqueTimestamp: true };
  sdk.getDocs.mockResolvedValueOnce({ docs: [{ id: 'reader', data: () => ({ fullName: 'Alias', email: 'READER@EXAMPLE.TEST', createdAt: timestamp }) }] });
  expect(await actual.fetchClientsFromFirebase()).toStrictEqual([{ id: 'reader', name: 'Alias', email: 'reader@example.test',
    phone: '', address: '', city: '', state: '', zip: '', country: '', createdAt: timestamp, updatedAt: undefined }]);
  expect(sdk.orderBy).toHaveBeenCalledWith('createdAt', 'desc');
  expect(sdk.collection).toHaveBeenCalledWith(sdk.db, 'clients');
  sdk.getDocs.mockResolvedValueOnce({ docs: [{ id: 'invalid', data: () => ({ country: { privateValue: 'must-not-leak' } }) }] });
  await expect(actual.fetchClientsFromFirebase()).rejects.toHaveProperty('message', 'Campo de cliente inválido: country');
  expect(sdk.fetch).not.toHaveBeenCalled();
  expectNoWrites();
});

test('saving a new client preserves email ID, creation timestamps, defaults and merge contract', async () => {
  const actual = await import('../../src/firebaseUtils');
  const client = clientFixture(), updatedAt = { timestamp: 'updated' }, createdAt = { timestamp: 'created' };
  sdk.serverTimestamp.mockReturnValueOnce(updatedAt).mockReturnValueOnce(createdAt);
  await actual.saveClientToFirebase(client);
  expect(sdk.doc).toHaveBeenCalledWith(sdk.db, 'clients', 'new@example.test');
  expect(sdk.setDoc).toHaveBeenCalledTimes(1);
  expect(sdk.setDoc).toHaveBeenCalledWith({ collection: 'clients', id: 'new@example.test' },
    { ...client, email: 'new@example.test', updatedAt, createdAt, uid: '', active: true, source: 'manual' }, { merge: true });
  expect(sdk.serverTimestamp).toHaveBeenCalledTimes(2);
  expect(sdk.addDoc).not.toHaveBeenCalled();
  expectNoOtherMutations();
});

test('saving an existing numeric-UID client keeps String ID coercion, opaque source and original createdAt', async () => {
  const actual = await import('../../src/firebaseUtils');
  const source = { opaque: true }, client = { ...clientFixture(), uid: 73, source };
  sdk.getDoc.mockResolvedValue(snapshot(true, { uid: 'old-uid', createdAt: 'existing-date' }));
  await actual.saveClientToFirebase(client);
  expect(sdk.doc).toHaveBeenCalledWith(sdk.db, 'clients', '73');
  expect(savedClient().uid).toBe(73);
  expect(savedClient().source).toBe(source);
  expect(savedClient()).not.toHaveProperty('createdAt');
  expect(sdk.serverTimestamp).toHaveBeenCalledTimes(1);
  expect(sdk.setDoc.mock.calls[0]?.[2]).toEqual({ merge: true });
  expectNoOtherMutations();
});

test('client UID/source getters retain every original access across ID, spread, timestamps and final overrides', async () => {
  const actual = await import('../../src/firebaseUtils');
  const trace: string[] = [], uidValues = ['check', 73, 'spread-uid', 'written-uid'];
  const spreadSource = { source: 'spread' }, writtenSource = { source: 'written' };
  let uidReads = 0, sourceReads = 0;
  const client = { ...clientFixture(),
    get uid() { trace.push('uid'); const value = uidValues[uidReads++]; if (value === undefined) throw new Error('Unexpected UID read'); return value; },
    get source() { trace.push('source'); return sourceReads++ === 0 ? spreadSource : writtenSource; },
  };
  sdk.getDoc.mockImplementationOnce(async () => { trace.push('read'); return snapshot(true, { uid: 'old' }); });
  sdk.serverTimestamp.mockImplementation(() => { trace.push('timestamp'); return 'synthetic-timestamp'; });
  sdk.setDoc.mockImplementationOnce(async () => { trace.push('write'); });
  await actual.saveClientToFirebase(client);
  expect(trace).toEqual(['uid', 'uid', 'read', 'uid', 'source', 'timestamp', 'uid', 'source', 'write']);
  expect(sdk.doc).toHaveBeenCalledWith(sdk.db, 'clients', '73');
  expect(savedClient().uid).toBe('written-uid');
  expect(savedClient().source).toBe(writtenSource);
  expectNoOtherMutations();
});

test('registration catch preserves rejection identity with unknown failure and no later write', async () => {
  const actual = await import('../../src/firebaseUtils');
  const failure = { code: 'synthetic-client-read-failure' };
  sdk.getDoc.mockRejectedValueOnce(failure);
  await expect(actual.registerClient({ client: clientFixture(), shouldRegister: false })).rejects.toBe(failure);
  expect(console.error).toHaveBeenCalledWith('Error al registrar cliente:', failure);
  expectNoWrites();
});
