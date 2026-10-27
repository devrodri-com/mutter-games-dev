import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { checkout } from '../../../api/_lib/checkout-service';
import { createMercadoPagoPreference } from '../../../api/_lib/mercado-pago';
import { mercadoPagoGateway } from '../../../api/_lib/mercado-pago-payments';
import { reconcileOrder } from '../../../api/_lib/order-reconciliation';

export function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected fixture object');
    return value as Record<string, unknown>;
}
export async function createHarness() {
    if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST ?? '')) throw new Error('Loopback emulator required');
    const app = initializeApp({ projectId: 'demo-mutter-stock-recovery' }, `recovery-${randomUUID()}`);
    const db = getFirestore(app);
    for (const collection of await db.listCollections()) await db.recursiveDelete(collection);
    const originalFetch = globalThis.fetch;
    const state = {
        now: Date.now(), posts: 0, reads: 0, searchFails: false, searchIncomplete: false, searchTotal: undefined as number | undefined, hidden: new Set<string>(),
        failedIds: new Set<string>(), lostPost: false, postBarrier: undefined as Promise<void> | undefined,
        searchBarrier: undefined as Promise<void> | undefined,
    };
    const payments = new Map<string, Record<string, unknown>>();
    const preferences = new Map<string, Record<string, unknown>>();
    const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
    vi.stubEnv('MP_ACCESS_TOKEN', 'synthetic-token-never-real');
    vi.stubEnv('MP_COLLECTOR_ID', '200');
    vi.spyOn(Date, 'now').mockImplementation(() => state.now);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return originalFetch(input, init);
        if (url.origin !== 'https://api.mercadopago.com') throw new Error('Non-synthetic network forbidden');
        if (init?.method === 'POST' && url.pathname === '/checkout/preferences') {
            state.posts++;
            const body = object(JSON.parse(String(init.body)));
            const preference = { id: `synthetic-preference-${state.posts}`, external_reference: body.external_reference,
                collector_id: 200, expires: true, expiration_date_to: body.expiration_date_to,
                init_point: `https://www.mercadopago.com.uy/checkout/synthetic-${state.posts}` };
            preferences.set(String(body.external_reference), preference);
            if (state.postBarrier) await state.postBarrier;
            if (state.lostPost) throw new Error('Accepted POST response lost');
            return json(preference);
        }
        state.reads++;
        if (url.pathname === '/v1/payments/search') {
            if (state.searchFails) return new Response('synthetic unavailable', { status: 503 });
            const rows = [...payments.entries()].filter(([id, p]) => !state.hidden.has(id) && p.external_reference === url.searchParams.get('external_reference')).map(([id]) => ({ id }));
            // Capture before waiting to exercise a genuinely stale search observation.
            if (state.searchBarrier) await state.searchBarrier;
            return json({ paging: { total: state.searchTotal ?? (state.searchIncomplete ? rows.length + 1 : rows.length),
                offset: Number(url.searchParams.get('offset')), limit: Number(url.searchParams.get('limit')) }, results: rows });
        }
        if (url.pathname.startsWith('/v1/payments/')) {
            const id = url.pathname.split('/').at(-1) ?? '';
            if (state.failedIds.has(id)) return new Response('synthetic unavailable', { status: 503 });
            const payment = payments.get(id);
            return payment ? json(payment) : new Response('not found', { status: 404 });
        }
        throw new Error(`Unexpected provider route ${url.pathname}`);
    });
    const options = () => ({ now: () => state.now, gateway: mercadoPagoGateway, collectorId: '200', admission: { ipKey: 'a'.repeat(64) } });
    const shipping = { pickup: true, department: '', name: 'Synthetic', address: '', city: '', postalCode: '', phone: '00000000', email: 'synthetic@example.invalid' };
    const purchase = (ids = ['game']) => ({ items: ids.map(id => ({ id, quantity: 1, variantId: '' })), shipping });
    const call = async (uid: string, body: unknown) => object(await checkout(db, uid, body, createMercadoPagoPreference, options()));
    const seed = (id = 'game', stock = 5) => db.doc(`products/${id}`).set({ active: true, title: { es: 'Synthetic', en: 'Synthetic' },
        priceUSD: 100, stockTotal: stock, untouched: { code: 'synthetic-metadata', values: [7, 11] } });
    const start = async (uid = 'buyer', ids = ['game'], key = randomUUID()) => {
        const quote = object((await call(uid, { action: 'quote', purchase: purchase(ids) })).quote);
        return call(uid, { action: 'start', purchase: purchase(ids), key, quoteHash: quote.hash });
    };
    const order = async (id: unknown) => object((await db.doc(`orders/${String(id)}`).get()).data());
    const observe = async (id: unknown, status: string, paymentId = String(100 + payments.size)) => {
        const row = await order(id);
        const payment = { id: paymentId, status, status_detail: 'synthetic', external_reference: id,
            collector_id: 200, currency_id: 'UYU', transaction_amount: row.total, live_mode: true,
            date_last_updated: new Date(state.now).toISOString() };
        payments.set(paymentId, payment);
        return paymentId;
    };
    const check = (id: unknown, hint?: string) => reconcileOrder(db, String(id), options(), 'buyer', hint);
    const product = async (id = 'game') => object((await db.doc(`products/${id}`).get()).data());
    const holds = async (id = 'game') => Object.keys(object((await product(id)).webReservations ?? {}));
    return { db, state, payments, preferences, options, purchase, call, seed, start, order, observe, check, product, holds,
        dispose: async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await db.terminate(); await deleteApp(app); } };
}
