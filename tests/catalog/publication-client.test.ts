import { createHash, webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { canonicalJson, catalogCreateHashPayload } from '../../api/_lib/catalog-edit-fields';
import { normalizeCatalogCreate } from '../../api/_lib/catalog-edit-create';
import { isObject, type JsonObject } from '../../src/domain/catalogEdit';
const sdk = vi.hoisted(() => ({ user: { uid: 'synthetic-john', getIdToken: async () => 'synthetic-token' } }));
vi.mock('../../src/firebase', () => ({ auth: { get currentUser() { return sdk.user; } } }));
vi.mock('../../src/utils/credentialAccess', () => ({ ensureCredentialSession: async () => ({ uid: sdk.user.uid,
  scope: 'JOHN_ADMIN_CLOSED_V1', admin: true, superadmin: false, expiresAtMs: Date.now() + 60000 }) }));
import { newCatalogDraft, updateCatalogDraft, createCatalogPublication, CatalogCreatePendingError,
  CatalogCreateSupersededError, reopenSupersededCatalogCreate } from '../../src/utils/catalogCreateClient';
import { uploadCatalogImage, recoverCatalogImage, acknowledgeCatalogImage, listCatalogImageDrafts, CatalogImagePendingError } from '../../src/utils/catalogImageClient';

let mode = '', calls: { url: string; method: string; body: unknown }[] = [], created: Record<string, unknown> | undefined;
let media: Record<string, unknown> | undefined;
const imageId = '11111111-1111-4111-8111-111111111111';
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const product = (): JsonObject & { images: string[] } => ({ title: { es: 'Nueva', en: '' }, description: '<p>Descripción</p>',
  category: { id: 'cat', name: 'Categoría' }, subcategory: { id: 'sub', categoryId: 'cat', name: 'Sub' },
  active: false, images: ['https://ik.imagekit.io/synthetic/image.png'], variants: [{ label: { es: 'Modelo' }, options: [{ value: 'Única', priceUSD: 20, stock: 0 }] }] });
beforeEach(() => {
  localStorage.clear(); vi.stubGlobal('crypto', webcrypto); mode = ''; calls = []; created = undefined; media = undefined;
  sdk.user = { uid: 'synthetic-john', getIdToken: async () => 'synthetic-token' };
  vi.stubGlobal('fetch', vi.fn(async (url: string, options?: RequestInit) => {
    const method = options?.method ?? 'GET';
    const body: unknown = typeof options?.body === 'string' ? JSON.parse(options.body) : options?.body;
    calls.push({ url, method, body });
    const parsed = new URL(url, 'https://muttergames.com');
    if (url === 'https://upload.imagekit.io/api/v2/files/upload') {
      expect(options?.redirect).toBe('error'); expect(body).toBeInstanceOf(FormData);
      if (!media) throw new Error('Upload before preparation');
      media.status = 'UPLOADED'; media.fileId = 'synthetic-file'; media.url = product().images[0];
      if (mode === 'upload-ack-lost') throw new Error('Synthetic connection lost');
      return reply({ fileId: 'synthetic-file' });
    }
    expect(parsed.origin).toBe('https://muttergames.com'); expect(options?.redirect).toBe('error');
    if (parsed.pathname === '/api/catalog-media') {
      if (method === 'GET') return mode === 'recovery-server-error'
        ? reply({ code: 'CATALOG_MEDIA_ERROR', error: 'La dirección de la imagen no es válida.', applied: false }, 409)
        : reply(media ?? { status: 'NOT_FOUND' });
      const input = body as Record<string, unknown>;
      if (input.intent === 'prepare') {
        media = { status: 'ISSUED', imageOperationId: input.operationId, productId: input.productId };
        return reply({ ...media, token: 'synthetic-single-use-grant', expire: Math.floor(Date.now() / 1000) + 600,
          fields: { overwriteFile: 'false', useUniqueFileName: 'false', folder: '/synthetic', fileName: 'synthetic.png' } });
      }
      if (!media || input.fileId !== media.fileId) throw Error('Wrong file confirmation');
      if (mode === 'confirm-before-commit') return reply({ code: 'CATALOG_MEDIA_ERROR',
        error: 'No pudimos comprobar la carga.', applied: null, ignoredSecret: 'synthetic-private-not-for-ui' }, 503);
      if (mode === 'confirm-untrusted-error') return reply({ code: 'UNEXPECTED_INTERNAL', error: 'synthetic-private-not-for-ui' }, 503);
      media.status = 'CONFIRMED';
      if (mode === 'confirm-ack-lost') throw new Error('Synthetic confirmation lost');
      return reply(media);
    }
    expect(parsed.pathname).toBe('/api/catalog-edit'); const id = parsed.searchParams.get('id');
    if (method === 'POST') {
      if (mode === 'rejected') return reply({ applied: false, error: 'Categoría no válida' }, 400);
      const input = body as { intent: 'create'; operationId: string; product: JsonObject; imageOperationIds?: string[] };
      const requestHash = createHash('sha256').update(canonicalJson(catalogCreateHashPayload(String(id), input))).digest('hex');
      created = { status: 'CONFIRMED', intent: 'create', id, operationId: input.operationId, version: '123:1', requestHash,
        product: normalizeCatalogCreate(input.product, input.operationId) };
      if (mode === 'create-ack-lost') throw new Error('Synthetic acknowledgement lost');
      return reply(mode === 'bad-receipt' ? { ...created, requestHash: 'f'.repeat(64) } : created, 201);
    }
    if (parsed.searchParams.has('operationId')) return reply(created ?? { status: 'NOT_CONFIRMED' });
    if (mode === 'readback-lost') throw new Error('Synthetic readback lost');
    const observedProduct = mode === 'readback-changed' ? { ...created?.product as JsonObject, active: true }
      : mode === 'superseded' ? { ...created?.product as JsonObject, subtitle: 'Edición posterior conservada' } : created?.product;
    return reply({ id, version: mode === 'superseded' ? '124:1' : '123:1', product: observedProduct,
      capabilities: { editExisting: true } });
  }));
});
afterEach(() => { localStorage.clear(); vi.unstubAllGlobals(); });
const creationPosts = () => calls.filter(call => call.method === 'POST' && call.url.startsWith('/api/catalog-edit'));
const imageUploads = () => calls.filter(call => call.url.startsWith('https://upload.imagekit.io'));
const confirmations = () => calls.filter(call => call.method === 'POST' && call.url === '/api/catalog-media'
  && typeof call.body === 'object' && call.body !== null && 'intent' in call.body && call.body.intent === 'confirm');

test.each(['synthetic-john', 'synthetic-rodrigo'])('%s creates once and validates the full raw readback', async uid => {
  sdk.user = { ...sdk.user, uid }; const draft = newCatalogDraft();
  const result = await createCatalogPublication(draft, product(), [imageId]);
  expect(result.id).toBe(draft.id); expect(result.product).toEqual(normalizeCatalogCreate(product(), draft.operationId));
  expect(result.product.active).toBe(false); expect(creationPosts()).toHaveLength(1);
  expect(localStorage.getItem(`mutter-catalog-create:${uid}`)).toBeNull();
  expect(localStorage.getItem(`mutter-catalog-create:${uid}:history:${draft.operationId}`)).not.toBeNull();
});
test('creation draft survives reopen with exact content and image receipt IDs', () => {
  const draft = newCatalogDraft(); updateCatalogDraft(draft, product(), [imageId]);
  expect(newCatalogDraft()).toEqual({ ...draft, product: product(), imageOperationIds: [imageId] });
  expect(calls).toHaveLength(0);
});
test('lost create ACK reloads the same intent and only reads receipt and document', async () => {
  const draft = newCatalogDraft(); mode = 'create-ack-lost';
  await expect(createCatalogPublication(draft, product(), [imageId])).rejects.toBeInstanceOf(CatalogCreatePendingError);
  const reopened = newCatalogDraft(); expect(reopened.pending).toBe(true); expect(reopened.operationId).toBe(draft.operationId);
  mode = ''; const saved = await createCatalogPublication(reopened, reopened.product, reopened.imageOperationIds);
  expect(saved.id).toBe(draft.id); expect(creationPosts()).toHaveLength(1);
});
test.each(['readback-lost', 'readback-changed', 'bad-receipt'])('%s preserves creation attempt and never claims success', async scenario => {
  const draft = newCatalogDraft(); mode = scenario;
  await expect(createCatalogPublication(draft, product(), [imageId])).rejects.toBeInstanceOf(CatalogCreatePendingError);
  expect(newCatalogDraft().pending).toBe(true); expect(creationPosts()).toHaveLength(1);
});
test('definitive non-applied rejection preserves the draft and rejected result for correction', async () => {
  const draft = newCatalogDraft(); mode = 'rejected';
  await expect(createCatalogPublication(draft, product(), [imageId])).rejects.toThrow('Categoría no válida');
  expect(newCatalogDraft().pending).toBe(false); expect(newCatalogDraft().product).toEqual(product());
  expect(creationPosts()).toHaveLength(1);
});
test.each(['synthetic-john', 'synthetic-rodrigo'])('%s explicitly opens a later version without repeating creation or discarding its receipt', async uid => {
  sdk.user = { ...sdk.user, uid }; const draft = newCatalogDraft(); mode = 'superseded';
  await expect(createCatalogPublication(draft, product(), [imageId])).rejects.toBeInstanceOf(CatalogCreateSupersededError);
  expect(newCatalogDraft().pending).toBe(true);
  const current = await reopenSupersededCatalogCreate(draft);
  expect(current.id).toBe(draft.id); expect(current.version).toBe('124:1');
  expect(current.product.subtitle).toBe('Edición posterior conservada'); expect(current.product.active).toBe(false);
  expect(creationPosts()).toHaveLength(1);
  const archived: unknown = JSON.parse(localStorage.getItem(`mutter-catalog-create:${uid}:history:${draft.operationId}`) ?? 'null');
  if (!isObject(archived)) throw new Error('The original creation receipt was not archived.');
  expect(archived.uid).toBe(uid); expect(archived.receipt).toEqual(created);
  expect(archived.supersededByVersion).toBe('124:1');
  expect(localStorage.getItem(`mutter-catalog-create:${uid}`)).toBeNull();
  const next = newCatalogDraft(); expect(next.id).not.toBe(draft.id); expect(next.operationId).not.toBe(draft.operationId);
  expect(next.pending).toBe(false); expect(creationPosts()).toHaveLength(1);
});
test('a conflicting readback at the same version cannot clear a confirmed creation', async () => {
  const draft = newCatalogDraft(); mode = 'readback-changed';
  await expect(createCatalogPublication(draft, product(), [imageId])).rejects.toBeInstanceOf(CatalogCreatePendingError);
  await expect(reopenSupersededCatalogCreate(draft)).rejects.toThrow('No se comprobó una edición posterior.');
  expect(newCatalogDraft().pending).toBe(true); expect(newCatalogDraft().id).toBe(draft.id);
  expect(creationPosts()).toHaveLength(1);
  expect(localStorage.getItem(`mutter-catalog-create:synthetic-john:history:${draft.operationId}`)).toBeNull();
});
test('changed account cannot dispatch another account draft', async () => {
  const draft = newCatalogDraft(); sdk.user = { ...sdk.user, uid: 'synthetic-rodrigo' };
  await expect(createCatalogPublication(draft, product(), [imageId])).rejects.toBeInstanceOf(CatalogCreatePendingError);
  expect(creationPosts()).toHaveLength(0);
});
test('image finishes only after server verification and remains recoverable before acknowledgment', async () => {
  const file = new File(['synthetic'], 'image.png', { type: 'image/png' });
  const image = await uploadCatalogImage(file, 'publication'); expect(image.url).toBe('https://ik.imagekit.io/synthetic/image.png');
  expect(imageUploads()).toHaveLength(1); expect(confirmations()).toHaveLength(1);
  expect(await recoverCatalogImage('publication')).toEqual(image);
  expect(JSON.stringify(localStorage)).not.toContain('synthetic-single-use-grant');
  acknowledgeCatalogImage('publication', image.imageOperationId);
  expect(listCatalogImageDrafts('publication')).toEqual([image]);
  expect(await recoverCatalogImage('publication')).toBeNull();
});
test.each(['upload-ack-lost', 'confirm-ack-lost'])('%s is recovered without a second upload or duplicate confirmation', async scenario => {
  mode = scenario;
  await expect(uploadCatalogImage(new File(['x'], 'image.png', { type: 'image/png' }), 'publication')).rejects.toBeInstanceOf(CatalogImagePendingError);
  mode = ''; const image = await recoverCatalogImage('publication'); expect(image?.url).toBe('https://ik.imagekit.io/synthetic/image.png');
  expect(imageUploads()).toHaveLength(1); expect(confirmations()).toHaveLength(1);
});
test('confirmation failure before commit recovers the same file only after an explicit check, preserving its provider URL', async () => {
  mode = 'confirm-before-commit';
  await expect(uploadCatalogImage(new File(['x'], 'image.png', { type: 'image/png' }), 'publication')).rejects.toBeInstanceOf(CatalogImagePendingError);
  expect(imageUploads()).toHaveLength(1); expect(confirmations()).toHaveLength(1);
  expect(JSON.parse(localStorage.getItem('mutter-catalog-image:synthetic-john:publication') ?? '{}').phase).toBe('CONFIRMING');
  if (!media) throw new Error('Missing synthetic upload');
  media.url = 'https://ik.imagekit.io/synthetic/image.png?updatedAt=1792873175341';
  mode = ''; const image = await recoverCatalogImage('publication');
  expect(image?.url).toBe(media.url); expect(imageUploads()).toHaveLength(1); expect(confirmations()).toHaveLength(2);
  expect(confirmations()[1].body).toEqual(confirmations()[0].body); expect(creationPosts()).toHaveLength(0);
});
test.each(['imageOperationId', 'productId', 'fileId'])('CONFIRMING rejects a recovered %s mismatch without another confirmation', async field => {
  mode = 'confirm-before-commit';
  await expect(uploadCatalogImage(new File(['x'], 'image.png', { type: 'image/png' }), 'publication')).rejects.toBeInstanceOf(CatalogImagePendingError);
  if (!media) throw new Error('Missing synthetic upload');
  media[field] = 'synthetic-other'; mode = '';
  await expect(recoverCatalogImage('publication')).rejects.toThrow('La imagen comprobada no coincide');
  expect(imageUploads()).toHaveLength(1); expect(confirmations()).toHaveLength(1); expect(creationPosts()).toHaveLength(0);
});
test('CONFIRMING without a persisted fileId cannot dispatch a confirmation', async () => {
  mode = 'confirm-before-commit';
  await expect(uploadCatalogImage(new File(['x'], 'image.png', { type: 'image/png' }), 'publication')).rejects.toBeInstanceOf(CatalogImagePendingError);
  const storageKey = 'mutter-catalog-image:synthetic-john:publication';
  const pending: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '{}');
  if (!isObject(pending)) throw new Error('Missing synthetic pending upload');
  delete pending.fileId; localStorage.setItem(storageKey, JSON.stringify(pending)); mode = '';
  await expect(recoverCatalogImage('publication')).rejects.toThrow('La imagen comprobada no coincide');
  expect(imageUploads()).toHaveLength(1); expect(confirmations()).toHaveLength(1);
});
test('known server image errors explain the pending upload without exposing unrelated response fields', async () => {
  mode = 'confirm-before-commit';
  await expect(uploadCatalogImage(new File(['x'], 'image.png', { type: 'image/png' }), 'publication'))
    .rejects.toThrow('No pudimos comprobar la carga.');
  mode = 'recovery-server-error';
  await expect(recoverCatalogImage('publication')).rejects.toThrow('La dirección de la imagen no es válida.');
  expect(imageUploads()).toHaveLength(1); expect(confirmations()).toHaveLength(1);
  expect(JSON.stringify(localStorage)).not.toContain('synthetic-private-not-for-ui');
});
test('unknown server errors remain generic and never trigger an automatic retry', async () => {
  mode = 'confirm-untrusted-error';
  const failure = await uploadCatalogImage(new File(['x'], 'image.png', { type: 'image/png' }), 'publication').catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(CatalogImagePendingError);
  expect(failure instanceof Error && failure.message).not.toContain('synthetic-private-not-for-ui');
  expect(imageUploads()).toHaveLength(1); expect(confirmations()).toHaveLength(1);
});
test('unresolved image never uploads again and retains its receipt', async () => {
  mode = 'upload-ack-lost'; const file = new File(['x'], 'image.png', { type: 'image/png' });
  await expect(uploadCatalogImage(file, 'publication')).rejects.toBeInstanceOf(CatalogImagePendingError);
  media = undefined;
  await expect(recoverCatalogImage('publication')).rejects.toBeInstanceOf(CatalogImagePendingError);
  await expect(uploadCatalogImage(file, 'publication')).rejects.toBeInstanceOf(CatalogImagePendingError);
  expect(imageUploads()).toHaveLength(1);
});
