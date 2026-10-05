// @vitest-environment node
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore, type DocumentSnapshot, type Firestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import checkoutHandler from '../../api/create-mp-preference';
import { checkout } from '../../api/_lib/checkout-service';
import { reconcileOrder } from '../../api/_lib/order-reconciliation';
import { createMercadoPagoPreference } from '../../api/_lib/mercado-pago';
import { mercadoPagoGateway } from '../../api/_lib/mercado-pago-payments';

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
if (!emulator || !/^127\.0\.0\.1:\d+$/.test(emulator)) throw new Error('Loopback emulator required');
const app = initializeApp({ projectId: 'demo-mutter-web-inventory' }, 'web-inventory-regressions');
const db = getFirestore(app);
const originalFetch = globalThis.fetch;
const originalNow = Date.now.bind(Date);
let clock = originalNow();
let posts = 0;
let outcome: 'normal' | 'accepted-response-lost' | 'request-timeout' = 'normal';
let failFinalization = false;
let nextPaymentId = 100;
let nextMerchantId = 300;
const collector = 200;

type PreferenceFixture = {
    id: string; external_reference: string; collector_id: number; expires: boolean;
    expiration_date_to: string; date_created: string; init_point: string;
};
type PaymentFixture = {
    id: number; status: string; status_detail: string; external_reference: string;
    collector_id: number; currency_id: string; transaction_amount: number; live_mode: boolean;
    date_last_updated: string; order: { id: number };
};
type MerchantFixture = {
    id: number; external_reference: string; preference_id: string; collector: { id: number };
    status: string; payments: { id: number; status: string }[];
};
const preferences = new Map<string, PreferenceFixture>();
const payments = new Map<string, PaymentFixture>();
const merchants = new Map<string, MerchantFixture>();
const requestLog: string[] = [];
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
function record(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected test object');
    return value as Record<string, unknown>;
}
async function syntheticProvider(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return originalFetch(input, init);
    if (url.origin !== 'https://api.mercadopago.com') throw new Error(`External network forbidden: ${url.origin}`);
    const method = init?.method ?? 'GET';
    requestLog.push(`${method} ${url.pathname}`);
    if (method === 'POST' && url.pathname === '/checkout/preferences') {
        posts++;
        if (typeof init?.body !== 'string') throw new Error('Expected real adapter JSON');
        const body = record(JSON.parse(init.body));
        expect(body.expires).toBe(true);
        expect(body.external_reference).toEqual(expect.any(String));
        expect(body.expiration_date_to).toEqual(expect.any(String));
        expect(body.items).toEqual(expect.any(Array));
        const orderId = String(body.external_reference);
        const preference: PreferenceFixture = {
            id: `synthetic-pref-${posts}`, external_reference: orderId, collector_id: collector,
            expires: true, expiration_date_to: String(body.expiration_date_to),
            date_created: new Date(clock).toISOString(), init_point: `https://www.mercadopago.com.uy/checkout/synthetic-${posts}`,
        };
        preferences.set(preference.id, preference);
        if (outcome === 'accepted-response-lost') throw new Error('Synthetic provider accepted but response was lost');
        if (outcome === 'request-timeout') throw new DOMException('Synthetic provider timeout', 'TimeoutError');
        // A persistence outage after the real adapter's POST must not allow a second POST.
        if (failFinalization) {
            failFinalization = false;
            vi.spyOn(db, 'runTransaction').mockRejectedValueOnce(new Error('Synthetic persistence outage after preference creation'));
        }
        return json(preference);
    }
    if (method !== 'GET') throw new Error(`Unexpected synthetic method: ${method}`);
    if (url.pathname.startsWith('/checkout/preferences/')) {
        const preference = preferences.get(url.pathname.split('/').at(-1) ?? '');
        if (!preference) throw new Error('Synthetic preference not found');
        return json(preference);
    }
    if (url.pathname === '/v1/payments/search') {
        expect(url.searchParams.get('collector.id')).toBe(String(collector));
        const matching = [...payments.values()].filter(payment => payment.external_reference === url.searchParams.get('external_reference'));
        const offset = Number(url.searchParams.get('offset'));
        const limit = Number(url.searchParams.get('limit'));
        return json({ paging: { total: matching.length, limit, offset }, results: matching.slice(offset, offset + limit).map(({ id }) => ({ id })) });
    }
    if (url.pathname === '/merchant_orders/search') {
        const matching = [...merchants.values()].filter(merchant => merchant.external_reference === url.searchParams.get('external_reference') && merchant.preference_id === url.searchParams.get('preference_id'));
        const offset = Number(url.searchParams.get('offset'));
        const elements = matching.slice(offset, offset + Number(url.searchParams.get('limit'))).map(({ id }) => ({ id }));
        return json({ total: matching.length, next_offset: offset + elements.length, elements });
    }
    if (url.pathname.startsWith('/v1/payments/')) {
        const payment = payments.get(url.pathname.split('/').at(-1) ?? '');
        if (!payment) throw new Error('Synthetic payment not found');
        return json(payment);
    }
    if (url.pathname.startsWith('/merchant_orders/')) {
        const merchant = merchants.get(url.pathname.split('/').at(-1) ?? '');
        if (!merchant) throw new Error('Synthetic merchant order not found');
        return json(merchant);
    }
    throw new Error(`Unexpected synthetic provider route: ${url.pathname}`);
}
const options = () => ({ now: () => clock, gateway: mercadoPagoGateway, collectorId: String(collector), admission: { ipKey: 'a'.repeat(64) } });
async function call(uid: string, input: unknown): Promise<Record<string, unknown>> {
    return record(await checkout(db, uid, input, createMercadoPagoPreference, options()));
}
const shipping = { pickup: true, department: '', name: 'Synthetic Buyer', address: '', city: '', postalCode: '', phone: '00000000', email: 'synthetic@example.invalid' };
function purchase(items = [{ id: 'game', quantity: 1, variantId: 'Color-Rojo' }]) {
    return { items, shipping };
}
const product = (stock = 1) => ({
    active: true, title: { es: 'Juego sintético', en: 'Synthetic game' }, description: 'Preserve this description',
    priceUSD: 100, stockTotal: stock, arbitraryMetadata: { unchanged: [3, 'yes'] },
    variants: [{ label: { es: 'Color', en: 'Color' }, options: [{ value: 'Rojo', priceUSD: 100, stock }] }],
});
async function seed(id = 'game', stock = 1) { await db.doc(`products/${id}`).set(product(stock)); }
async function quote(uid = 'buyer', selection = purchase()) {
    return record((await call(uid, { action: 'quote', purchase: selection })).quote);
}
async function start(uid = 'buyer', selection = purchase(), key = randomUUID(), quoteHash?: unknown) {
    return call(uid, { action: 'start', purchase: selection, key, quoteHash: quoteHash ?? (await quote(uid, selection)).hash });
}
async function order(id: unknown) {
    if (typeof id !== 'string') throw new Error('Expected order id');
    return record((await db.doc(`orders/${id}`).get()).data());
}
async function reservationCount(id = 'game') {
    const data = record((await db.doc(`products/${id}`).get()).data());
    return Object.keys(record(data.webReservations ?? {})).length;
}
async function stock(id = 'game') {
    const data = record((await db.doc(`products/${id}`).get()).data());
    return data.stockTotal;
}
function expire(includeGrace = true) {
    const latest = Math.max(...[...preferences.values()].map(preference => Date.parse(preference.expiration_date_to)));
    clock = latest + (includeGrace ? 15 * 60_000 : 0) + 1;
}
async function observe(orderId: unknown, status: string | null, merchantStatus: 'closed' | 'opened' | 'expired') {
    if (typeof orderId !== 'string') throw new Error('Expected order id');
    const persisted = await order(orderId);
    // A lost preference response leaves no saved preference ID. Discovery still uses
    // the actual provider external_reference, never a fabricated stored linkage.
    const preferenceId = typeof persisted.preferenceId === 'string' ? persisted.preferenceId :
        [...preferences.values()].find(preference => preference.external_reference === orderId)?.id;
    if (!preferenceId) throw new Error('Expected synthetic provider preference');
    const merchant: MerchantFixture = {
        id: ++nextMerchantId, external_reference: orderId, preference_id: preferenceId,
        collector: { id: collector }, status: merchantStatus, payments: [],
    };
    merchants.set(String(merchant.id), merchant);
    if (status === null) return null;
    const payment: PaymentFixture = {
        id: ++nextPaymentId, status,
        status_detail: status === 'approved' ? 'accredited' : status === 'in_process' ? 'pending_review_manual' : 'cc_rejected_other_reason',
        external_reference: orderId, collector_id: collector, currency_id: 'UYU',
        transaction_amount: Number(persisted.total), live_mode: true,
        date_last_updated: new Date(clock).toISOString(), order: { id: merchant.id },
    };
    payments.set(String(payment.id), payment);
    merchant.payments.push({ id: payment.id, status });
    return String(payment.id);
}
async function paymentId(orderId: unknown, status = 'approved', merchantStatus: 'closed' | 'opened' | 'expired' = 'closed') {
    const id = await observe(orderId, status, merchantStatus);
    if (!id) throw new Error('Expected payment');
    return id;
}
async function sweep() {
    // Test-owned fixtures only. Exercise the actual server reconciliation entrypoint;
    // availability intentionally performs no provider I/O in the new contract.
    const orders = await db.collection('orders').get();
    for (const order of orders.docs) await reconcileOrder(db, order.id, options(), 'sweep');
}

beforeEach(async () => {
    vi.restoreAllMocks();
    clock = originalNow(); posts = 0; outcome = 'normal'; failFinalization = false; nextPaymentId = 100; nextMerchantId = 300;
    preferences.clear(); payments.clear(); merchants.clear(); requestLog.length = 0;
    vi.stubEnv('MP_ACCESS_TOKEN', 'synthetic-never-real');
    vi.stubEnv('MP_COLLECTOR_ID', String(collector));
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('WEB_ADMISSION_HMAC_SECRET', 'synthetic-web-inventory-admission-secret-32-plus');
    vi.stubEnv('CRON_SECRET', 'different-synthetic-cron-secret');
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    vi.spyOn(globalThis, 'fetch').mockImplementation(syntheticProvider);
    for (const collection of await db.listCollections()) await db.recursiveDelete(collection);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(async () => { await db.terminate(); await deleteApp(app); });

test('one unit and eight concurrent buyers produce exactly one reservation and one preference', async () => {
    await seed();
    const initial = await quote();
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => start(`buyer-${index}`, purchase(), randomUUID(), initial.hash)));
    const accepted = results.filter(result => result.status === 'fulfilled');
    expect(accepted).toHaveLength(1);
    expect(posts).toBe(1);
    expect(await reservationCount()).toBe(1);
    expect(await stock()).toBe(1);
    expect((await db.collection('orders').get()).size).toBe(1);
    for (const rejected of results.filter(result => result.status === 'rejected')) {
        if (rejected.status === 'rejected') expect(rejected.reason).toMatchObject({ code: 'CATALOG_UNAVAILABLE' });
    }
}, 30000);

test('concurrent and later repeated approved payment reads debit once and create one durable movement', async () => {
    await seed('game', 5);
    expect((await quote()).items).toEqual(expect.arrayContaining([expect.objectContaining({ stock: 5 })]));
    const started = await start();
    const id = await paymentId(started.id);
    await Promise.all(Array.from({ length: 8 }, () => call('buyer', { action: 'verify', orderId: started.id, paymentId: id })));
    expect(await stock()).toBe(4);
    expect(await reservationCount()).toBe(0);
    expect((await db.collection('payments').get()).size).toBe(1);
    expect((await db.collection('inventoryMovements').get()).size).toBe(1);
    expect((await db.doc(`inventoryMovements/${started.id}:commit`).get()).exists).toBe(true);
    const reads = requestLog.filter(path => path === `GET /v1/payments/${id}`).length;
    clock += 60_001;
    await call('buyer', { action: 'status', orderId: started.id });
    expect(requestLog.filter(path => path === `GET /v1/payments/${id}`).length).toBe(reads + 1);
    expect(await stock()).toBe(4);
    expect(posts).toBe(1);
}, 30000);

test.each(['rejected', null])('expired %s purchase releases after grace and complete canonical payment search', async status => {
    await seed();
    const started = await start();
    await observe(started.id, status, 'expired');
    await call('buyer', { action: 'status', orderId: started.id });
    expect(await reservationCount()).toBe(1);
    expect(await stock()).toBe(1);
    expire(false);
    await sweep();
    expect(await reservationCount()).toBe(1);
    expect(await stock()).toBe(1);
    expire();
    await sweep();
    expect(await reservationCount()).toBe(0);
    expect(await stock()).toBe(1);
    const again = await start('new-buyer');
    expect(again.id).not.toBe(started.id);
    expect(posts).toBe(2);
});

test('payment in review remains reserved after expiration', async () => {
    await seed();
    const started = await start();
    await observe(started.id, 'in_process', 'expired');
    expire();
    await sweep();
    expect(await reservationCount()).toBe(1);
    expect(await stock()).toBe(1);
    await expect(start('new-buyer')).rejects.toMatchObject({ code: 'CATALOG_UNAVAILABLE' });
    expect(posts).toBe(1);
});

test('availability makes no MP requests; a complete empty payment search releases after deadline plus grace', async () => {
    await seed();
    await start();
    expire();
    const requestsBeforeAvailability = [...requestLog];
    await call('other-buyer', { action: 'availability', productIds: ['game'] });
    expect(requestLog).toEqual(requestsBeforeAvailability);
    expect(await reservationCount()).toBe(1);
    expect(await stock()).toBe(1);
    await sweep();
    expect(await reservationCount()).toBe(0);
    expect(await stock()).toBe(1);
    expect(requestLog).toContain('GET /v1/payments/search');
    expect(requestLog.some(path => path.includes('merchant_orders'))).toBe(false);
});

test.each(['accepted-response-lost', 'request-timeout'] as const)('%s stays held until canonical recovery and never repeats the POST', async failure => {
    await seed();
    const key = randomUUID();
    const initial = await quote();
    outcome = failure;
    await expect(start('buyer', purchase(), key, initial.hash)).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
    await expect(start('buyer', purchase(), key, initial.hash)).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
    expect(posts).toBe(1);
    expect(await reservationCount()).toBe(1);
    const rows = await db.collection('orders').get();
    expect(rows.size).toBe(1);
    const orderId = rows.docs[0].id;
    expect(rows.docs[0].get('preferenceId')).toBeUndefined();
    await paymentId(orderId);
    // No callback payment ID or stored preference ID: exact external_reference search recovers approval.
    const recovered = await call('buyer', { action: 'status', orderId });
    expect(recovered).toMatchObject({ inventoryState: 'committed', paymentStatus: 'approved' });
    await expect(start('buyer', purchase(), key, initial.hash)).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
    expect(posts).toBe(1);
    expect(preferences.size).toBe(1);
    expect(await reservationCount()).toBe(0);
    expect(await stock()).toBe(0);
    expect((await db.collection('inventoryMovements').get()).size).toBe(1);
});

test('failed preference finalization retains the reservation and forbids a second POST', async () => {
    await seed();
    const key = randomUUID();
    const initial = await quote();
    failFinalization = true;
    await expect(start('buyer', purchase(), key, initial.hash)).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
    await expect(start('buyer', purchase(), key, initial.hash)).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
    expect(posts).toBe(1);
    expect(await reservationCount()).toBe(1);
    expect(await stock()).toBe(1);
    const orders = await db.collection('orders').get();
    expect(orders.size).toBe(1);
    expect(orders.docs[0].get('preferenceId')).toBeUndefined();
});

test('multi-item purchase is all-or-nothing when a concurrent buyer takes one item', async () => {
    await seed(); await seed('other', 2);
    const otherBefore = (await db.doc('products/other').get()).data();
    const selection = purchase([{ id: 'game', quantity: 1, variantId: 'Color-Rojo' }, { id: 'other', quantity: 1, variantId: 'Color-Rojo' }]);
    const initial = await quote('multi', selection);
    await start('single');
    await expect(start('multi', selection, randomUUID(), initial.hash)).rejects.toMatchObject({ code: 'CATALOG_UNAVAILABLE' });
    expect(await reservationCount('other')).toBe(0);
    expect(await stock('other')).toBe(2);
    expect((await db.doc('products/other').get()).data()).toEqual(otherBefore);
    expect((await db.collection('orders').get()).size).toBe(1);
    expect(posts).toBe(1);
});

test('zero-stock variant and legacy base cannot produce a payment link', async () => {
    await seed('game', 0);
    await expect(start()).rejects.toMatchObject({ code: 'CATALOG_UNAVAILABLE' });
    await db.doc('products/base').set({ active: true, title: 'Base', priceUSD: 10, stockTotal: 0 });
    await expect(start('base-buyer', purchase([{ id: 'base', quantity: 1, variantId: '' }]))).rejects.toMatchObject({ code: 'CATALOG_UNAVAILABLE' });
    expect(posts).toBe(0);
    expect((await db.collection('orders').get()).empty).toBe(true);
});

test('reservation-only stock change preserves quote hash for competing remaining units', async () => {
    await seed('game', 3);
    const initial = await quote('buyer');
    await start('buyer', purchase(), randomUUID(), initial.hash);
    const next = await quote('second');
    expect(next.hash).toBe(initial.hash);
    expect(next.items).toEqual(expect.arrayContaining([expect.objectContaining({ stock: 2 })]));
    await start('second', purchase(), randomUUID(), initial.hash);
    expect(posts).toBe(2);
    expect(await reservationCount()).toBe(2);
    expect(await stock()).toBe(3);
});

test('buyer isolation and duplicate-content lock do not mint a second preference', async () => {
    await seed('game', 5);
    const initial = await quote();
    const key = randomUUID();
    const started = await start('buyer', purchase(), key, initial.hash);
    expect((await start('buyer', purchase(), key, initial.hash)).id).toBe(started.id);
    await expect(call('foreign', { action: 'status', orderId: started.id })).rejects.toMatchObject({ status: 403 });
    await expect(start('buyer', purchase(), randomUUID(), initial.hash)).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
    expect(posts).toBe(1);
    expect(await reservationCount()).toBe(1);
});

test('unknown-key status closes the key before a delayed start can create a purchase', async () => {
    await seed();
    const key = randomUUID();
    const initial = await quote();
    const recovered = await call('buyer', { action: 'status', key });
    expect(recovered).toMatchObject({ inventoryState: 'released', paymentStatus: 'not_started', canRetry: true });
    expect((await db.doc(`checkoutIntents/${recovered.id}`).get()).get('state')).toBe('not_started');
    await expect(start('buyer', purchase(), key, initial.hash)).rejects.toMatchObject({ code: 'INTENT_CLOSED' });
    expect(await call('buyer', { action: 'status', key })).toEqual(recovered);
    expect((await db.collection('orders').get()).empty).toBe(true);
    expect(await reservationCount()).toBe(0);
    expect(await stock()).toBe(1);
    expect(posts).toBe(0);
});

test.each([
    { label: 'amount', patch: { transaction_amount: 1 } },
    { label: 'currency', patch: { currency_id: 'USD' } },
    { label: 'live mode', patch: { live_mode: false } },
])('approved payment with invalid $label preserves stock and its reservation', async ({ patch }) => {
    await seed('game', 5);
    const started = await start();
    const id = await paymentId(started.id);
    const payment = payments.get(id);
    if (!payment) throw new Error('Expected synthetic payment');
    Object.assign(payment, patch);
    const result = await call('buyer', { action: 'verify', orderId: started.id, paymentId: id });
    expect(result.inventoryState).toBe('attention');
    expect((await order(started.id)).attention).toBe('payment_identity_mismatch');
    expect(await stock()).toBe(5);
    expect(await reservationCount()).toBe(1);
    expect((await db.collection('payments').get()).empty).toBe(true);
    expect((await db.collection('inventoryMovements').get()).empty).toBe(true);
    expire();
    await sweep();
    expect(await reservationCount()).toBe(1);
    expect(await stock()).toBe(5);
    expect(record((await order(started.id)).inventory).state).toBe('reserved');
    expect((await order(started.id)).attention).toBe('payment_identity_mismatch');
});

test('stale rejection cannot undo approval and another approved payment cannot debit twice', async () => {
    await seed('game', 5);
    const started = await start();
    const first = await paymentId(started.id);
    await call('buyer', { action: 'verify', orderId: started.id, paymentId: first });
    const oldPayment = payments.get(first);
    const oldMerchant = oldPayment ? merchants.get(String(oldPayment.order.id)) : undefined;
    if (!oldPayment || !oldMerchant) throw new Error('Expected synthetic payment linkage');
    oldPayment.status = 'rejected';
    oldPayment.status_detail = 'cc_rejected_other_reason';
    oldPayment.date_last_updated = new Date(clock - 1000).toISOString();
    oldMerchant.payments[0].status = 'rejected';
    clock += 60_001;
    const stale = await call('buyer', { action: 'verify', orderId: started.id, paymentId: first });
    expect(stale).toMatchObject({ paymentStatus: 'approved', inventoryState: 'committed' });
    expect((await db.doc(`payments/${first}`).get()).get('status')).toBe('approved');
    expect(await stock()).toBe(4);
    clock += 60_001;
    const second = await paymentId(started.id);
    const duplicate = await call('buyer', { action: 'verify', orderId: started.id, paymentId: second });
    expect(duplicate).toMatchObject({ paymentStatus: 'approved', inventoryState: 'attention' });
    expect(await order(started.id)).toMatchObject({ approvedPaymentId: first, attention: 'duplicate_approved_payment' });
    expect(await stock()).toBe(4);
    expect(await reservationCount()).toBe(0);
    expect((await db.collection('inventoryMovements').get()).size).toBe(1);
    expect((await db.collection('payments').get()).size).toBe(2);
});

test('approved multi-item purchase decrements every reserved item exactly once', async () => {
    await seed('game', 3); await seed('other', 4);
    const selection = purchase([
        { id: 'game', quantity: 1, variantId: 'Color-Rojo' },
        { id: 'other', quantity: 2, variantId: 'Color-Rojo' },
    ]);
    const started = await start('multi', selection);
    expect(await reservationCount('game')).toBe(1);
    expect(await reservationCount('other')).toBe(1);
    const id = await paymentId(started.id);
    await call('multi', { action: 'verify', orderId: started.id, paymentId: id });
    await call('multi', { action: 'verify', orderId: started.id, paymentId: id });
    expect(await stock('game')).toBe(2);
    expect(await stock('other')).toBe(2);
    expect(await reservationCount('game')).toBe(0);
    expect(await reservationCount('other')).toBe(0);
    const movements = await db.collection('inventoryMovements').get();
    expect(movements.size).toBe(1);
    expect(movements.docs[0].get('lines')).toHaveLength(2);
});

test('late approval after release and another sale does not make stock negative', async () => {
    await seed();
    const first = await start('first');
    await observe(first.id, null, 'expired');
    expire(); await sweep();
    const second = await start('second');
    const paidSecond = await paymentId(second.id);
    await call('second', { action: 'verify', orderId: second.id, paymentId: paidSecond });
    expect(await stock()).toBe(0);
    clock += 60_001;
    const late = await paymentId(first.id);
    const result = await call('first', { action: 'verify', orderId: first.id, paymentId: late });
    expect(await stock()).toBe(0);
    expect((await db.collection('inventoryMovements').get()).size).toBe(1);
    expect(result.inventoryState).toBe('attention');
    expect((await order(first.id)).attention).toBeTruthy();
});

type AdminModule = {
    patchProduct(db: Firestore, id: string, input: unknown): Promise<unknown>;
    productVersion(snapshot: DocumentSnapshot): string;
};
async function adminModule(projectId: 'demo-mutter-web-inventory' | 'demo-mutter-r1' = 'demo-mutter-web-inventory'): Promise<AdminModule & { db: Firestore; dispose(): Promise<void> }> {
    const source = process.env.MUTTER_ADMIN_API_SOURCE;
    if (!source) throw new Error('MUTTER_ADMIN_API_SOURCE must identify the paired exact Admin checkout');
    const module: Partial<AdminModule> = await import(/* @vite-ignore */ pathToFileURL(resolve(source, 'api/_lib/product-patch.ts')).href);
    if (typeof module.patchProduct !== 'function' || typeof module.productVersion !== 'function') throw new Error('Invalid paired Admin module');
    // Each deployed app has its own SDK. Its sentinels must use that same SDK's database instance.
    const requireAdmin = createRequire(resolve(source, 'package.json'));
    const adminApps: typeof import('firebase-admin/app') = requireAdmin('firebase-admin/app');
    const adminFirestore: typeof import('firebase-admin/firestore') = requireAdmin('firebase-admin/firestore');
    const adminApp = adminApps.initializeApp({ projectId }, 'web-inventory-admin-coupling');
    const adminDb = adminFirestore.getFirestore(adminApp);
    return {
        patchProduct: module.patchProduct, productVersion: module.productVersion, db: adminDb,
        dispose: async () => { await adminDb.terminate(); await adminApps.deleteApp(adminApp); },
    };
}

test('real handler withholds the existing payment link after actual Admin unpublishes the reserved product', async () => {
    const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
    if (!authHost || !/^127\.0\.0\.1:\d+$/.test(authHost)) throw new Error('Loopback Auth emulator required');
    // Auth's API-key sign-in endpoint issues tokens for the emulator launch project.
    const admin = await adminModule('demo-mutter-r1');
    const handlerApp = initializeApp({ projectId: 'demo-mutter-r1' }, 'catalog-checkout');
    const handlerDb = getFirestore(handlerApp);
    const auth = getAuth(handlerApp);
    const uid = `handler-${randomUUID()}`;
    const productId = `handler-game-${randomUUID()}`;
    let authCreated = false;
    let createdOrderId: string | undefined;
    let reservationId: string | undefined;
    try {
        await handlerDb.doc('operations/webStockCutover').set({schema:1,state:'open',revision:'synthetic-coupled-handler-open',updatedAt:new Date()});
        await auth.createUser({ uid, email: `${uid}@example.invalid`, password: `synthetic-${uid}` });
        authCreated = true;
        const signed = await fetch(`http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=synthetic`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${uid}@example.invalid`, password: `synthetic-${uid}`, returnSecureToken: true }),
        });
        const authResponse = record(await signed.json());
        if (typeof authResponse.idToken !== 'string') throw new Error('Expected emulator ID token');
        const idToken = authResponse.idToken;
        expect((await auth.verifyIdToken(idToken, true)).uid).toBe(uid);
        async function invoke(body: unknown) {
            let status = 0;
            let output: unknown;
            const response = {
                setHeader() {}, status(code: number) { status = code; return response; },
                json(value: unknown) { output = value; },
            };
            await checkoutHandler({ method: 'POST', headers: { authorization: `Bearer ${idToken}`, 'x-vercel-forwarded-for': '192.0.2.90' },
                rawHeaders: ['authorization', `Bearer ${idToken}`, 'x-vercel-forwarded-for', '192.0.2.90'], body }, response);
            return { status, body: record(output) };
        }
        await handlerDb.doc(`products/${productId}`).set(product());
        const selection = purchase([{ id: productId, quantity: 1, variantId: 'Color-Rojo' }]);
        const quoted = await invoke({ action: 'quote', purchase: selection });
        expect(quoted.status).toBe(200);
        const input = { action: 'start', purchase: selection, key: randomUUID(), quoteHash: record(quoted.body.quote).hash };
        const started = await invoke(input);
        expect(started.status).toBe(200);
        if (typeof started.body.id !== 'string') throw new Error('Expected handler order');
        createdOrderId = started.body.id;
        const inventory = record((await handlerDb.doc(`orders/${createdOrderId}`).get()).get('inventory'));
        if (typeof inventory.reservationId !== 'string') throw new Error('Expected handler reservation');
        reservationId = inventory.reservationId;
        const ready = await invoke({ action: 'status', orderId: started.body.id });
        expect(ready.status).toBe(200);
        expect(ready.body.init_point).toBe(started.body.init_point);
        const productRef = admin.db.doc(`products/${productId}`);
        const reserved = await productRef.get();
        await admin.patchProduct(admin.db, productRef.id, {
            version: admin.productVersion(reserved), intent: 'publication', changes: { active: false },
        });
        const unavailable = await invoke({ action: 'status', orderId: started.body.id });
        expect(unavailable.status).toBe(200);
        expect(unavailable.body).not.toHaveProperty('init_point');
        expect(unavailable.body).toMatchObject({ inventoryState: 'reserved', canRetry: false });
        const repeated = await invoke(input);
        expect(repeated).toMatchObject({ status: 409, body: { code: 'CATALOG_UNAVAILABLE' } });
        expect((await productRef.get()).data()?.webReservations).toEqual(reserved.data()?.webReservations);
        expect((await productRef.get()).get('stockTotal')).toBe(1);
        expect(posts).toBe(1);
    } finally {
        await handlerDb.doc(`products/${productId}`).delete();
        if (createdOrderId) {
            const locks = await handlerDb.collection('webCheckoutLocks').where('orderId', '==', createdOrderId).get();
            for (const lock of locks.docs) await lock.ref.delete();
            await handlerDb.doc(`orders/${createdOrderId}`).delete();
            await handlerDb.doc(`checkoutIntents/${createdOrderId}`).delete();
        }
        if (reservationId) await handlerDb.doc(`webReservationOwners/${reservationId}`).delete();
        if (authCreated) await auth.deleteUser(uid);
        await handlerDb.terminate();
        await deleteApp(handlerApp);
        await admin.dispose();
    }
});

test('actual Admin edit coexists with active hold and cannot overwrite a sale using stale version', async () => {
    const admin = await adminModule();
    try {
        await seed('game', 5);
        const ref = admin.db.doc('products/game');
        const initial = await ref.get();
        const version = admin.productVersion(initial);
        const started = await start();
        const reserved = await ref.get();
        expect(admin.productVersion(reserved)).toBe(version);
        await admin.patchProduct(admin.db, ref.id, { version, intent: 'edit', changes: { variants: product(4).variants } });
        expect(await stock()).toBe(4);
        expect((await ref.get()).data()?.webReservations).toEqual(reserved.data()?.webReservations);
        const beforePaid = admin.productVersion(await ref.get());
        const id = await paymentId(started.id);
        await call('buyer', { action: 'verify', orderId: started.id, paymentId: id });
        expect(await stock()).toBe(3);
        await expect(admin.patchProduct(admin.db, ref.id, { version: beforePaid, intent: 'edit', changes: { variants: product(4).variants } })).rejects.toMatchObject({ status: 409 });
        expect(await stock()).toBe(3);
    } finally { await admin.dispose(); }
});

test('unrelated existing stock and missing legacy stock remain byte-identical', async () => {
    await seed(); await seed('unrelated', 41);
    await db.doc('products/missing').set({ active: true, title: 'Legacy missing stock', priceUSD: 7, legacy: { keep: true } });
    const before = JSON.stringify((await db.collection('products').get()).docs.filter(doc => doc.id !== 'game').map(doc => [doc.id, doc.data()]));
    const started = await start();
    const id = await paymentId(started.id);
    await call('buyer', { action: 'verify', orderId: started.id, paymentId: id });
    await expect(start('legacy', purchase([{ id: 'missing', quantity: 1, variantId: '' }]))).rejects.toMatchObject({ code: 'CATALOG_UNAVAILABLE' });
    const after = JSON.stringify((await db.collection('products').get()).docs.filter(doc => doc.id !== 'game').map(doc => [doc.id, doc.data()]));
    expect(after).toBe(before);
});
