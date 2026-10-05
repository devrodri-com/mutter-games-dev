// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
const auth = vi.hoisted(() => ({ verify: vi.fn(async () => ({ uid: 'synthetic-cutover-buyer', firebase: { sign_in_provider: 'anonymous' } })) }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: auth.verify }) }));
const provider = vi.hoisted(() => ({ post: vi.fn(async () => ({ id: 'synthetic-preference', init_point: 'https://example.invalid/payment', collectorId: '200' })) }));
vi.mock('../../api/_lib/mercado-pago', () => ({ createMercadoPagoPreference: provider.post }));
import handler from '../../api/create-mp-preference';
import { createSweepHandler } from '../../api/internal/web-stock-reconcile';
import { assertCutoverOpen, CUTOVER_PATH } from '../../api/_lib/release-cutover';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8188') throw new Error('Exact demo emulator required');
const app = initializeApp({ projectId: 'demo-mutter-cutover' }, 'catalog-checkout');
const db = getFirestore(app);
const secret = 'synthetic-release-secret-at-least-32-characters';
const purchase = { items: [{ id: 'p', quantity: 1 }], shipping: { pickup: true, department: '', name: 'Synthetic', address: '', city: '', postalCode: '', phone: '123', email: 'test@example.invalid' } };
function recorder() {
    const state: { code: number; body: unknown; headers: Record<string, string> } = { code: 0, body: null, headers: {} };
    const res = { setHeader(key: string, value: string) { state.headers[key.toLowerCase()] = value; },
        status(code: number) { state.code = code; return res; }, json(body: unknown) { state.body = body; } };
    return { state, res };
}
async function call(body: unknown, action?: string, token = 'verified-user') {
    const { state, res } = recorder();
    await handler({ method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-vercel-forwarded-for': '192.0.2.15',
        ...(action ? { 'x-mutter-release-action': action } : {}) }, body }, res);
    return state;
}
async function control(state: 'open' | 'closed' | 'reconciling') {
    await db.doc(CUTOVER_PATH).set({ schema: 1, state, revision: `synthetic-${state}-revision`, updatedAt: Timestamp.now() });
}
async function snapshot() {
    const result: Record<string, unknown> = {};
    for (const collection of await db.listCollections()) for (const doc of (await collection.get()).docs) {
        if (doc.ref.path !== CUTOVER_PATH) result[doc.ref.path] = { data: doc.data(), updateTime: doc.updateTime };
    }
    return result;
}
beforeEach(async () => {
    for (const collection of await db.listCollections()) await db.recursiveDelete(collection);
    await db.doc('products/p').set({ active: true, title: 'Synthetic', stockTotal: 5, priceUSD: 100,
        webReservations: { 'held-synthetic-reservation': { expiresAt: 1, lines: [{ slot: 'base', identity: 'base', quantity: 1 }] } } });
    await db.doc('orders/historical').set({ total: 100, items: [], createdAt: Timestamp.now() });
    vi.stubEnv('RELEASE_ATTESTATION_SECRET', secret);
    vi.stubEnv('MP_COLLECTOR_ID', '200'); vi.stubEnv('VERCEL', '1');
    vi.stubEnv('WEB_ADMISSION_HMAC_SECRET', 'synthetic-admission-secret-at-least-32');
    provider.post.mockClear();
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(async () => { await db.terminate(); await deleteApp(app); });

test('paired Admin uses the identical central admission protocol', () => {
    const paired = process.env.MUTTER_ADMIN_API_SOURCE;
    if (!paired) throw new Error('Exact paired Admin required');
    expect(readFileSync(`${paired}/api/_lib/release-cutover.ts`, 'utf8')).toBe(readFileSync('api/_lib/release-cutover.ts', 'utf8'));
});
test.each([undefined, { schema: 1, state: 'closed' }, { schema: 1, state: 'open' }, { schema: 2, state: 'open', revision: 'synthetic-revision', updatedAt: Timestamp.now() }])('missing/closed/malformed control fails closed: %j', async value => {
    if (value) await db.doc(CUTOVER_PATH).set(value);
    const before = await snapshot();
    for (const action of ['start', 'status', 'verify']) {
        const result = await call({ action, purchase, key: 'synthetic-key-0000000000' });
        expect(result.code).toBe(503); expect(result.body).toMatchObject({ code: 'CUTOVER_CLOSED' });
    }
    expect(await snapshot()).toEqual(before); expect(provider.post).not.toHaveBeenCalled();
});
test('database read failure does not convert maintenance into open', async () => {
    await control('open');
    const document = db.doc(CUTOVER_PATH);
    vi.spyOn(db, 'doc').mockReturnValue(document);
    vi.spyOn(document, 'get').mockRejectedValue(new Error('Synthetic read failure'));
    await expect(assertCutoverOpen(db)).rejects.toMatchObject({ status: 503, code: 'CUTOVER_CLOSED' });
    expect(provider.post).not.toHaveBeenCalled();
});
test('closed control preserves read-only quote, availability and all internal smokes without writes or provider requests', async () => {
    await control('closed'); const before = await snapshot();
    const network = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('No network smoke expected'); });
    for (const body of [{ action: 'quote', purchase }, { action: 'availability', productIds: ['p'] }]) {
        expect((await call(body)).code).toBe(200);
        const smoke = await call(body, 'read-smoke', secret);
        expect(smoke.code).toBe(200); expect(smoke.headers['cache-control']).toBe('no-store');
    }
    for (const action of ['catalog', 'admin_read']) expect((await call({ action }, 'read-smoke', secret)).code).toBe(200);
    for (const action of ['start', 'status', 'verify', 'admin_orders', 'unknown']) expect((await call({ action }, 'read-smoke', secret)).code).toBe(400);
    expect((await call({ action: 'catalog' }, 'read-smoke', 'incorrect-secret')).code).toBe(401);
    expect(await snapshot()).toEqual(before); expect(provider.post).not.toHaveBeenCalled(); expect(network).not.toHaveBeenCalled();
});
test('cron cannot write maintenance receipts or invoke provider while cutover is closed', async () => {
    await control('closed'); const before = await snapshot();
    const options = vi.fn(() => ({}));
    const cron = createSweepHandler({ getDatabase: () => db, secret: () => 'synthetic-cron', options });
    const { state, res } = recorder();
    await cron({ method: 'GET', headers: { authorization: 'Bearer synthetic-cron' } }, res);
    expect(state.code).toBe(503); expect(options).not.toHaveBeenCalled();
    expect(await snapshot()).toEqual(before);
});
test('closed read-smoke rejects array actions with a real valid quote before any business state changes', async () => {
    await control('closed');
    const quoted = await call({ action: 'quote', purchase });
    if (!quoted.body || typeof quoted.body !== 'object' || !('quote' in quoted.body) || !quoted.body.quote || typeof quoted.body.quote !== 'object' || !('hash' in quoted.body.quote)) throw new Error('Missing real quote');
    const before = await snapshot();
    for (const action of [['quote'], ['availability']]) {
        const result = await call({ action, purchase, key: 'synthetic-smoke-array-0001', quoteHash: quoted.body.quote.hash }, 'read-smoke', secret);
        expect(result.code).toBe(400); expect(result.body).toMatchObject({ code: 'INVALID_RELEASE_SMOKE' });
    }
    expect(await snapshot()).toEqual(before); expect(provider.post).not.toHaveBeenCalled();
});
test('explicit reconciling phase permits authenticated maintenance while customer and Admin admission remain closed', async () => {
    await control('reconciling');
    await expect(assertCutoverOpen(db)).rejects.toMatchObject({ code: 'CUTOVER_CLOSED' });
    expect((await call({ action: 'start' })).code).toBe(503);
    const cron = createSweepHandler({ getDatabase: () => db, secret: () => 'synthetic-cron', options: () => ({}) });
    const denied = recorder();
    await cron({ method: 'GET', headers: { authorization: 'Bearer incorrect' } }, denied.res);
    expect(denied.state.code).toBe(401);
    expect((await db.collection('webStockMaintenance').get()).empty).toBe(true);
    const allowed = recorder();
    await cron({ method: 'GET', headers: { authorization: 'Bearer synthetic-cron' } }, allowed.res);
    expect(allowed.state.code).toBe(200);
    expect((await db.collection('webStockMaintenance').get()).size).toBe(1);
    expect((await db.doc('products/p').get()).get('stockTotal')).toBe(5);
    expect(provider.post).not.toHaveBeenCalled();
});
test('admission linearizes at the control read; closing blocks later calls; reopening never rewrites holds', async () => {
    await control('open'); const before = await snapshot();
    await expect(assertCutoverOpen(db)).resolves.toBeUndefined();
    await control('closed'); await expect(assertCutoverOpen(db)).rejects.toMatchObject({ code: 'CUTOVER_CLOSED' });
    await control('open'); await expect(assertCutoverOpen(db)).resolves.toBeUndefined();
    expect(await snapshot()).toEqual(before);
    // A delayed return of an already committed open read is an admitted old
    // operation, never evidence of drain. The effective timeout bounds it.
    const originalDoc = db.doc(CUTOVER_PATH), captured = await originalDoc.get();
    await control('closed');
    vi.spyOn(db, 'doc').mockReturnValue(originalDoc);
    vi.spyOn(originalDoc, 'get').mockResolvedValue(captured);
    await expect(assertCutoverOpen(db)).resolves.toBeUndefined();
});
test('open control preserves normal checkout and commits one reservation before synthetic preference', async () => {
    await control('open');
    const quoted = await call({ action: 'quote', purchase });
    if (!quoted.body || typeof quoted.body !== 'object' || !('quote' in quoted.body) || !quoted.body.quote || typeof quoted.body.quote !== 'object' || !('hash' in quoted.body.quote)) throw new Error('Missing real quote');
    const body = { action: 'start', purchase, key: 'synthetic-release-open-0001', quoteHash: quoted.body.quote.hash };
    expect((await call(body)).code).toBe(200);
    expect((await call(body)).code).toBe(200); expect(provider.post).toHaveBeenCalledTimes(1);
    expect((await db.doc('products/p').get()).get('stockTotal')).toBe(5);
    const holds: unknown = (await db.doc('products/p').get()).get('webReservations');
    expect(holds && typeof holds === 'object' ? Object.keys(holds) : []).toHaveLength(2);
});
