// @vitest-environment node
// Synthetic response variants reproduce R1-C; they are not observations of a Mercado Pago account.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createMercadoPagoPreference } from '../../api/_lib/mercado-pago';
import { PAYMENT_WINDOW_MS } from '../../api/_lib/reconciliation-policy';
import { createHarness, object } from './helpers/web-stock-harness';

let h: Awaited<ReturnType<typeof createHarness>>;
const FRACTIONAL_START = Date.parse('2026-09-30T12:00:00.789Z');
const KEY = 'synthetic-preference-echo-key';
type Echo = (response: Record<string, unknown>) => void;
type Capture = { payload: Record<string, unknown>; durable: Record<string, unknown> };
beforeEach(async () => { h = await createHarness(); h.state.now = FRACTIONAL_START; });
afterEach(async () => { vi.unstubAllGlobals(); await h.dispose(); });

function echoResponse(echo: Echo) {
    const transport = globalThis.fetch;
    const captures: Capture[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.origin !== 'https://api.mercadopago.com' || init?.method !== 'POST') return transport(input, init);
        const payload = object(JSON.parse(String(init.body)));
        const durable = await h.order(payload.external_reference);
        captures.push({ payload, durable });
        const response = await transport(input, init);
        const body = object(await response.json());
        echo(body);
        return Response.json(body, { status: response.status });
    });
    return captures;
}

async function assertSingleReservation(id: string, intentState: 'ready' | 'uncertain') {
    expect(h.state.posts).toBe(1);
    expect((await h.db.collection('orders').get()).size).toBe(1);
    expect((await h.db.collection('checkoutIntents').get()).size).toBe(1);
    expect((await h.db.doc(`checkoutIntents/${id}`).get()).get('state')).toBe(intentState);
    expect((await h.product()).stockTotal).toBe(2);
    expect(await h.holds()).toHaveLength(1);
    const available = object((await h.call('other-buyer', { action: 'quote', purchase: h.purchase() })).quote);
    expect(available.items).toEqual([expect.objectContaining({ stock: 1 })]);
    const claims = await h.db.collection('webAdmissionClaims').get();
    expect(claims.size).toBe(1);
    expect(claims.docs[0].get('released')).toBe(false);
    const buckets = await h.db.collection('webAdmissionBuckets').get();
    expect(buckets.size).toBe(2);
    for (const bucket of buckets.docs) {
        expect(bucket.get('active')).toEqual([id]);
        expect(bucket.get('admittedAt')).toHaveLength(1);
    }
    expect((await h.db.collection('inventoryMovements').get()).empty).toBe(true);
}

const validEchoes: { name: string; start: number; echo: Echo }[] = [
    { name: 'exact', start: FRACTIONAL_START, echo: () => undefined },
    { name: 'offset-same-instant', start: FRACTIONAL_START, echo: body => {
        const offset = new Date(Date.parse(String(body.expiration_date_to)) - 3 * 60 * 60_000).toISOString();
        body.expiration_date_to = offset.replace('Z', '-03:00');
    } },
    { name: 'truncate-ms', start: FRACTIONAL_START, echo: body => {
        body.expiration_date_to = String(body.expiration_date_to).replace(/\.\d{3}Z$/, 'Z');
    } },
    { name: 'omit-expires', start: FRACTIONAL_START, echo: body => { delete body.expires; } },
    { name: 'truncate-ms-whole-second-control', start: FRACTIONAL_START - 789, echo: body => {
        body.expiration_date_to = String(body.expiration_date_to).replace(/\.\d{3}Z$/, 'Z');
    } },
];

test.each(validEchoes)('R1-C $name starts with one POST, one quota and consistent whole-second dates', async ({ start, echo }) => {
    h.state.now = start;
    await h.seed('game', 2);
    const captures = echoResponse(echo);
    const started = await h.start('buyer', ['game'], KEY);
    expect(started.init_point).toBe('https://www.mercadopago.com.uy/checkout/synthetic-1');
    const id = String(started.id);
    expect(captures).toHaveLength(1);
    const { payload, durable } = captures[0];
    const createdAt = Math.floor(start / 1000) * 1000;
    const deadline = createdAt + PAYMENT_WINDOW_MS;
    expect(durable.paymentCreatedAt).toBe(createdAt);
    expect(durable.paymentDeadline).toBe(deadline);
    expect(durable.inventory).toMatchObject({ state: 'reserved', expiresAt: deadline });
    expect(object(durable.reconciliation).nextCheckAt).toBe(createdAt + 60_000);
    expect(payload).toMatchObject({ expires: true, expiration_date_from: new Date(createdAt).toISOString(),
        expiration_date_to: new Date(deadline).toISOString(), external_reference: id,
        auto_return: 'approved', items: [expect.objectContaining({ currency_id: 'UYU', unit_price: 100, quantity: 1 })],
        payment_methods: { excluded_payment_types: [{ id: 'ticket' }], excluded_payment_methods: [{ id: 'abitab' }, { id: 'redpagos' }] } });
    expect(deadline).toBeLessThanOrEqual(start + PAYMENT_WINDOW_MS);
    expect(deadline).toBeGreaterThan(start + PAYMENT_WINDOW_MS - 1000);
    const inventory = object(durable.inventory);
    expect(object(object((await h.product()).webReservations)[String(inventory.reservationId)]).expiresAt).toBe(deadline);
    expect((await h.db.doc(`checkoutIntents/${id}`).get()).get('expiresAt')).toBe(deadline);
    h.state.now += 1250;
    expect(await h.start('buyer', ['game'], KEY)).toEqual(started);
    expect((await h.order(id)).paymentDeadline).toBe(deadline);
    await assertSingleReservation(id, 'ready');
}, 30_000);

test('R1-C response precision within the same second is accepted without changing the persisted deadline', async () => {
    await h.seed('game', 2);
    const captures = echoResponse(body => {
        body.expiration_date_to = new Date(Date.parse(String(body.expiration_date_to)) + 456).toISOString();
    });
    const started = await h.start('buyer', ['game'], KEY);
    expect((await h.order(started.id)).paymentDeadline).toBe(Date.parse(String(captures[0].payload.expiration_date_to)));
    await assertSingleReservation(String(started.id), 'ready');
}, 30_000);

const invalidEchoes: { name: string; echo: Echo }[] = [
    { name: 'deadline one second later', echo: body => { body.expiration_date_to = new Date(Date.parse(String(body.expiration_date_to)) + 1000).toISOString(); } },
    { name: 'deadline one second earlier', echo: body => { body.expiration_date_to = new Date(Date.parse(String(body.expiration_date_to)) - 1000).toISOString(); } },
    { name: 'missing deadline', echo: body => { delete body.expiration_date_to; } },
    { name: 'invalid deadline', echo: body => { body.expiration_date_to = 'not-a-date'; } },
    { name: 'non-string deadline', echo: body => { body.expiration_date_to = 1790760000000; } },
    { name: 'explicit expires false', echo: body => { body.expires = false; } },
    { name: 'null expires', echo: body => { body.expires = null; } },
    { name: 'wrong type expires', echo: body => { body.expires = 'true'; } },
    { name: 'foreign reference', echo: body => { body.external_reference = 'another-order'; } },
    { name: 'foreign collector', echo: body => { body.collector_id = 201; } },
    { name: 'missing collector', echo: body => { delete body.collector_id; } },
    { name: 'missing preference ID', echo: body => { delete body.id; } },
    { name: 'invalid preference ID', echo: body => { body.id = 'wrong/id'; } },
    { name: 'foreign URL', echo: body => { body.init_point = 'https://foreign.invalid/checkout'; } },
    { name: 'unsecured URL', echo: body => { body.init_point = 'http://www.mercadopago.com.uy/checkout'; } },
];

test.each(invalidEchoes)('R1-C $name stays uncertain, without another POST or quota and with correct availability', async ({ echo }) => {
    await h.seed('game', 2);
    const captures = echoResponse(echo);
    await expect(h.start('buyer', ['game'], KEY)).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
    expect(captures).toHaveLength(1);
    const id = String(captures[0].payload.external_reference);
    const deadline = (await h.order(id)).paymentDeadline;
    h.state.now += 1250;
    await expect(h.start('buyer', ['game'], KEY)).rejects.toMatchObject({ code: 'RECOVERY_REQUIRED' });
    expect((await h.order(id)).paymentDeadline).toBe(deadline);
    expect((await h.db.doc(`checkoutIntents/${id}`).get()).get('initPoint')).toBeUndefined();
    await assertSingleReservation(id, 'uncertain');
}, 30_000);

test('R1-C delayed provider invocation sends the original persisted window instead of extending it', async () => {
    await h.seed('game', 2);
    const captures = echoResponse(() => undefined);
    const quote = object((await h.call('buyer', { action: 'quote', purchase: h.purchase() })).quote);
    const { checkout } = await import('../../api/_lib/checkout-service');
    const started = object(await checkout(h.db, 'buyer', { action: 'start', purchase: h.purchase(), key: KEY, quoteHash: quote.hash },
        async (id, purchaseQuote, expiresAt, collectorId) => {
            h.state.now += 2345;
            return createMercadoPagoPreference(id, purchaseQuote, expiresAt, collectorId);
        }, h.options()));
    const { payload, durable } = captures[0];
    expect(Date.parse(String(payload.expiration_date_from))).toBe(durable.paymentCreatedAt);
    expect(Date.parse(String(payload.expiration_date_to))).toBe(durable.paymentDeadline);
    expect(Number(durable.paymentDeadline) - Number(durable.paymentCreatedAt)).toBe(PAYMENT_WINDOW_MS);
    expect(Number(durable.paymentDeadline)).toBeLessThan(h.state.now + PAYMENT_WINDOW_MS);
    await assertSingleReservation(String(started.id), 'ready');
}, 30_000);
