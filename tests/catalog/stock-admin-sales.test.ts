// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { cert, deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { Timestamp } from 'firebase-admin/firestore';
import handler from '../../api/catalog-edit';
import type { AccessResponse } from '../../api/_lib/credential-access-handler';
import { JOHN_ADMIN_SCOPE } from '../../api/_lib/credential-access-state';
import { credentialSessionLocator } from '../../api/_lib/credential-capability';
import { createSweepHandler } from '../../api/internal/web-stock-reconcile';
import { receiptPath } from '../../api/_lib/catalog-edit-policy';
import { createHarness, object } from './helpers/web-stock-harness';

type Kind = 'base' | 'variant';
type Reply = { status: number; value: Record<string, unknown> };
let h: Awaited<ReturnType<typeof createHarness>>;
let admin: App, auth: Auth, token: string, uid: string;
const epoch = 'synthetic_stock_edit_epoch';
const publicationFields = { active: true, status: 'legacy-publication-state', archived: false,
    unknown: { nested: ['preserve', null, 17] }, version: 'legacy-business-value',
    images: ['legacy:image'] };
const preserved = { ...publicationFields, updatedAt: 'legacy-metadata', webCatalogVersion: '10:2' };

async function editCall(id: string, method = 'GET', body?: unknown, authorization = `Bearer ${token}`): Promise<Reply> {
    let status = 200, value: unknown;
    const headers = new Map<string, string>();
    const response: AccessResponse = {
        setHeader(name, entry) { headers.set(name, entry); return response; },
        status(code) { status = code; return response; },
        json(entry) { value = entry; return response; },
    };
    // The real HTTP handler performs token, named subject, session and closed
    // purchase-control checks before the real saveEdit transaction.
    await handler({ url: `/api/catalog-edit?id=${id}`, method, body,
        headers: { host: 'muttergames.com', origin: 'https://muttergames.com', authorization } }, response);
    expect(headers.get('Cache-Control')).toBe('no-store');
    return { status, value: object(value) };
}
const patch = (version: unknown, changes: Record<string, unknown>) =>
    ({ version, intent: 'edit', operationId: randomUUID(), changes });
async function seed(kind: Kind, stock = 0) {
    await h.seed('game', stock);
    await h.db.doc('products/game').update({ ...preserved, ...(kind === 'variant' ? {
        variants: [{ label: { es: 'Color', en: 'Color' }, custom: { preserve: true }, options: [
            { value: 'Rojo', variantId: 'synthetic-red', priceUSD: 100, stock, unknown: ['keep'] },
            { value: 'Azul', variantId: 'synthetic-blue', priceUSD: 100, stock: 0 },
        ] }],
    } : {}) });
}
const purchase = (kind: Kind, quantity: number) => ({ ...h.purchase(),
    items: [{ id: 'game', variantId: kind === 'variant' ? 'synthetic-red' : '', quantity }] });
async function quote(kind: Kind, quantity: number, buyer = 'buyer') {
    return object((await h.call(buyer, { action: 'quote', purchase: purchase(kind, quantity) })).quote);
}
async function start(kind: Kind, quantity: number, buyer = 'buyer', quoted?: Record<string, unknown>) {
    const currentQuote = quoted ?? await quote(kind, quantity, buyer);
    return h.call(buyer, { action: 'start', purchase: purchase(kind, quantity), key: randomUUID(), quoteHash: currentQuote.hash });
}
async function physical(kind: Kind) {
    const product = await h.product();
    if (kind === 'base') return product.stockTotal;
    if (!Array.isArray(product.variants)) throw new Error('Missing fixture variants');
    const options = object(product.variants[0]).options;
    if (!Array.isArray(options)) throw new Error('Missing fixture options');
    return object(options[0]).stock;
}
function stockChanges(kind: Kind, product: Record<string, unknown>, stock: number) {
    if (kind === 'base') return { stockTotal: stock };
    if (!Array.isArray(product.variants)) throw new Error('Missing fixture variants');
    const variants: unknown[] = structuredClone(product.variants), first = object(variants[0]);
    if (!Array.isArray(first.options)) throw new Error('Missing fixture options');
    object(first.options[0]).stock = stock;
    return { variants };
}
async function setStock(kind: Kind, stock: number) {
    const before = await editCall('game');
    expect(before.status).toBe(200);
    const input = patch(before.value.version, stockChanges(kind, object(before.value.product), stock));
    const saved = await editCall('game', 'PATCH', input);
    if (saved.status !== 200) {
        // The archived original is exercised with this same test. A rejection
        // counts as the reproduced boundary only with its code and no writes.
        expect(saved.value).toMatchObject({ code: 'INVALID_CATALOG_EDIT', applied: false });
        expect(await h.product()).toEqual(before.value.product);
        expect((await h.db.doc(receiptPath(uid, input.operationId)).get()).exists).toBe(false);
    }
    expect(saved.status, JSON.stringify(saved.value)).toBe(200);
    expect(saved.value).toMatchObject({ status: 'CONFIRMED', baseVersion: before.value.version, operationId: input.operationId });
    const receipt = await h.db.doc(receiptPath(uid, input.operationId)).get();
    expect(receipt.get('status')).toBe('CONFIRMED');
    const reread = await editCall('game');
    expect(reread.value.version).toBe(saved.value.version);
    expect(await physical(kind)).toBe(stock);
    expect(await h.product()).toMatchObject(preserved);
    return saved;
}

beforeEach(async () => {
    for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_PRIVATE_KEY', 'GOOGLE_OAUTH_ACCESS_TOKEN', 'VERCEL_TOKEN'])
        expect(process.env[key]).toBeUndefined();
    expect(process.env.FIREBASE_AUTH_EMULATOR_HOST).toMatch(/^127\.0\.0\.1:\d+$/);
    h = await createHarness();
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048,
        privateKeyEncoding: { format: 'pem', type: 'pkcs8' }, publicKeyEncoding: { format: 'pem', type: 'spki' } });
    // In-memory synthetic signing material prevents ADC or metadata discovery.
    admin = initializeApp({ projectId: 'demo-mutter-stock-recovery', credential: cert({
        projectId: 'demo-mutter-stock-recovery', clientEmail: 'synthetic@demo-mutter-stock-recovery.iam.gserviceaccount.com', privateKey,
    }) }, 'catalog-checkout');
    auth = getAuth(admin);
    uid = `synthetic-stock-john-${randomUUID()}`;
    const email = `${uid}@example.invalid`, secret = randomBytes(32).toString('hex');
    const locator = credentialSessionLocator(secret);
    await auth.createUser({ uid, email, emailVerified: true });
    await h.db.doc('operations/credentialAccessCutover').set({ schema: 2, phase: 'ENFORCED', epoch,
        legacyCutoffMs: h.state.now - 1_000_000, scope: JOHN_ADMIN_SCOPE, capabilityFormat: 'SHA256_LOCATOR_V1', subjectUid: uid });
    await h.db.doc('operations/webStockCutover').set({ schema: 1, state: 'closed',
        revision: 'synthetic_closed_stock_control', updatedAt: Timestamp.now() });
    await h.db.doc(`credentialAccess/${uid}`).set({ schema: 2, scope: JOHN_ADMIN_SCOPE, uid, epoch,
        status: 'RECOVERED', recoveryEmail: email, channelStatus: 'INDEPENDENTLY_VERIFIED',
        channelEvidenceSha256: 'a'.repeat(64), roles: { admin: true, superadmin: false } });
    await h.db.doc(`credentialSessions/${locator}`).set({ schema: 2, status: 'ACTIVE', scope: JOHN_ADMIN_SCOPE,
        capabilityFormat: 'SHA256_LOCATOR_V1', uid, epoch, expiresAtMs: h.state.now + 3_600_000,
        proofKind: 'RECOVERY_CHANNEL', roles: { admin: true, superadmin: false } });
    const customToken = await auth.createCustomToken(uid, { mutterCredentialSession: secret,
        mutterCredentialEpoch: epoch, mutterCredentialScope: JOHN_ADMIN_SCOPE, admin: true, superadmin: false });
    const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=synthetic`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    });
    expect(response.status).toBe(200);
    const signed = object(await response.json());
    if (typeof signed.idToken !== 'string') throw new Error('Missing synthetic ID token');
    token = signed.idToken;
}, 30_000);
afterEach(async () => {
    try {
        expect((await h.db.doc('operations/webStockCutover').get()).get('state')).toBe('closed');
        await auth.deleteUser(uid);
    } finally {
        if (admin) await deleteApp(admin);
        if (h) await h.dispose();
        vi.restoreAllMocks();
    }
});

test.each<Kind>(['base', 'variant'])('%s: Admin sets 5; verified sale of 3 leaves 2; reject 3 and admit 2', async kind => {
    await seed(kind);
    await setStock(kind, 5);
    const firstQuote = await quote(kind, 3);
    expect(firstQuote.items).toEqual([expect.objectContaining({ quantity: 3, stock: 5 })]);
    const started = await start(kind, 3, 'buyer', firstQuote);
    expect(await physical(kind)).toBe(5);
    const staleAdmin = await editCall('game');
    const payment = await h.observe(started.id, 'approved');
    const confirms = await Promise.all(Array.from({ length: 2 }, () => h.call('buyer', {
        action: 'verify', orderId: started.id, paymentId: payment,
    })));
    // A competing verify can observe the durable lease before the winning
    // reconciliation commits. The final persisted state establishes the sale.
    for (const value of confirms) expect(['reserved', 'committed']).toContain(value.inventoryState);
    expect((await h.order(started.id)).inventory).toMatchObject({ state: 'committed' });
    expect(await h.call('buyer', { action: 'verify', orderId: started.id, paymentId: payment }))
        .toMatchObject({ inventoryState: 'committed', paymentStatus: 'approved' });
    expect(await physical(kind)).toBe(2);
    const committedProduct = await h.product();
    expect(committedProduct.stockTotal).toBe(2);
    expect(committedProduct).toMatchObject(publicationFields);
    expect(committedProduct.updatedAt).toBeInstanceOf(Timestamp);
    expect(committedProduct.webCatalogVersion).toBeUndefined();
    expect(await h.holds()).toHaveLength(0);
    expect((await h.db.collection('inventoryMovements').get()).size).toBe(1);
    expect((await h.db.doc(`inventoryMovements/${started.id}:commit`).get()).get('orderId')).toBe(started.id);
    const staleInput = patch(staleAdmin.value.version, stockChanges(kind, object(staleAdmin.value.product), 5));
    expect(await editCall('game', 'PATCH', staleInput)).toMatchObject({ status: 409,
        value: { code: 'PRODUCT_VERSION_CONFLICT', applied: false } });
    expect((await h.db.doc(receiptPath(uid, staleInput.operationId)).get()).exists).toBe(false);
    const nextQuote = await quote(kind, 2, 'next-buyer');
    expect(nextQuote.items).toEqual([expect.objectContaining({ quantity: 2, stock: 2 })]);
    await expect(quote(kind, 3, 'too-many')).rejects.toMatchObject({ code: 'CATALOG_UNAVAILABLE' });
    await expect(start(kind, 3, 'too-many', firstQuote)).rejects.toMatchObject({ code: 'CATALOG_UNAVAILABLE' });
    expect((await h.db.collection('orders').get()).size).toBe(1);
    expect(h.state.posts).toBe(1);
    await start(kind, 2, 'next-buyer', nextQuote);
    expect(await physical(kind)).toBe(2);
    expect(await h.holds()).toHaveLength(1);
    expect(h.state.posts).toBe(2);
    const nextProduct = await h.product();
    expect(nextProduct).toMatchObject(publicationFields);
    expect(nextProduct.updatedAt).toEqual(committedProduct.updatedAt);
    expect(nextProduct.webCatalogVersion).toMatch(/^\d+:\d+$/);
}, 30_000);

test.each<Kind>(['base', 'variant'])('%s: one unit set in Admin admits exactly one of eight simultaneous buyers', async kind => {
    await seed(kind);
    await setStock(kind, 1);
    const quoted = await quote(kind, 1);
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => start(kind, 1, `buyer-${index}`, quoted)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    for (const result of results) if (result.status === 'rejected')
        expect(result.reason).toMatchObject({ code: 'CATALOG_UNAVAILABLE' });
    expect(await physical(kind)).toBe(1);
    expect(await h.holds()).toHaveLength(1);
    expect((await h.db.collection('orders').get()).size).toBe(1);
    expect(h.state.posts).toBe(1);
}, 30_000);

test.each<Kind>(['base', 'variant'])('%s: Admin cannot lower stock below an authoritative pending hold', async kind => {
    await seed(kind);
    await setStock(kind, 5);
    await start(kind, 3);
    const before = await h.product(), opened = await editCall('game');
    const invalid = patch(opened.value.version, stockChanges(kind, object(opened.value.product), 2));
    expect(await editCall('game', 'PATCH', invalid)).toMatchObject({ status: 400, value: { applied: false } });
    expect(await h.product()).toEqual(before);
    expect((await h.db.doc(receiptPath(uid, invalid.operationId)).get()).exists).toBe(false);
    await setStock(kind, 3);
    expect((await h.product()).webReservations).toEqual(before.webReservations);
    await expect(quote(kind, 1, 'other')).rejects.toMatchObject({ code: 'CATALOG_UNAVAILABLE' });
}, 30_000);

test.each<Kind>(['base', 'variant'])('%s: simultaneous Admin reduction and checkout cannot create an uncovered hold', async kind => {
    await seed(kind);
    await setStock(kind, 5);
    const opened = await editCall('game'), quoted = await quote(kind, 3);
    const input = patch(opened.value.version, stockChanges(kind, object(opened.value.product), 2));
    const [edited, bought] = await Promise.allSettled([
        editCall('game', 'PATCH', input), start(kind, 3, 'racing-buyer', quoted),
    ]);
    expect(edited.status).toBe('fulfilled');
    if (edited.status !== 'fulfilled') throw edited.reason;
    if (edited.value.status === 200) {
        expect(bought).toMatchObject({ status: 'rejected', reason: { code: 'CATALOG_UNAVAILABLE' } });
        expect(await physical(kind)).toBe(2); expect(await h.holds()).toHaveLength(0);
        expect(h.state.posts).toBe(0);
    } else {
        expect(edited.value).toMatchObject({ status: 409, value: { code: 'PRODUCT_VERSION_CONFLICT', applied: false } });
        expect(bought.status).toBe('fulfilled');
        expect(await physical(kind)).toBe(5); expect(await h.holds()).toHaveLength(1);
        expect(h.state.posts).toBe(1);
    }
    expect(await h.product()).toMatchObject(preserved);
}, 30_000);

test.each(['in_process', 'provider_failure'] as const)('%s after a stock edit keeps physical stock and reservation', async outcome => {
    await seed('base'); await setStock('base', 1);
    const started = await start('base', 1), before = await h.product();
    if (outcome === 'in_process') await h.observe(started.id, 'in_process');
    else h.state.searchFails = true;
    h.state.now += 46 * 60_000;
    await h.check(started.id);
    expect(await physical('base')).toBe(1);
    expect((await h.product()).webReservations).toEqual(before.webReservations);
    expect(object((await h.order(started.id)).inventory).state).toBe('reserved');
    expect((await h.db.collection('inventoryMovements').get()).empty).toBe(true);
    await expect(quote('base', 1, 'other')).rejects.toMatchObject({ code: 'CATALOG_UNAVAILABLE' });
}, 30_000);

test('stock edit preserves unknown fields, state and a historical variant aggregate difference', async () => {
    await seed('variant', 2);
    await h.db.doc('products/game').update({ stockTotal: 9 });
    const before = await h.product();
    await setStock('variant', 4);
    expect(await h.product()).toEqual({ ...before, variants: stockChanges('variant', before, 4).variants, stockTotal: 11 });
});

test('stock mutation still requires the real editor authorization', async () => {
    await seed('base'); const before = await h.product();
    const opened = await editCall('game');
    expect(await editCall('game', 'PATCH', patch(opened.value.version, { stockTotal: 5 }), 'Bearer synthetic-invalid-token'))
        .toMatchObject({ status: 401, value: { code: 'INVALID_SESSION', applied: false } });
    expect(await h.product()).toEqual(before);
    expect((await h.db.collection('adminProductOperations').get()).empty).toBe(true);
});


test.each<Kind>(['base', 'variant'])('%s: reconciling keeps Admin edits and payment confirmation concurrent without stale overwrite or duplicate debit', async kind => {
    await seed(kind, 5);
    const started = await start(kind, 3);
    await h.observe(started.id, 'approved');
    h.state.now += 61_000;
    const control = h.db.doc('operations/webStockCutover');
    await control.update({ state: 'reconciling' });
    let releaseSearch: () => void = () => { throw new Error('Missing provider barrier'); };
    h.state.searchBarrier = new Promise<void>(resolve => { releaseSearch = resolve; });
    const sweepHandler = createSweepHandler({ getDatabase: () => h.db,
        secret: () => 'synthetic-concurrent-cron', options: h.options });
    const sweep = async () => {
        let status = 200, body: unknown;
        const response: AccessResponse = { setHeader: () => response,
            status: code => { status = code; return response; },
            json: value => { body = value; return response; } };
        await sweepHandler({ method: 'GET', headers: { authorization: 'Bearer synthetic-concurrent-cron' } }, response);
        return { status, body: object(body) };
    };
    const checking = sweep();
    try {
        await vi.waitFor(() => expect(h.state.reads).toBeGreaterThan(0));
        const opened = await editCall('game');
        expect(opened.status, JSON.stringify(opened.value)).toBe(200);
        const input = patch(opened.value.version, stockChanges(kind, object(opened.value.product), 6));
        expect(await editCall('game', 'PATCH', input)).toMatchObject({ status: 200, value: { status: 'CONFIRMED' } });
        expect(await physical(kind)).toBe(6);
        expect(await h.holds()).toHaveLength(1);
        const beforeConfirmation = await editCall('game');
        releaseSearch();
        expect(await checking).toMatchObject({ status: 200, body: { selected: 1, verified: 1, failed: 0 } });
        expect(await physical(kind)).toBe(3);
        expect(await h.holds()).toHaveLength(0);
        expect((await h.order(started.id)).inventory).toMatchObject({ state: 'committed' });
        const stale = patch(beforeConfirmation.value.version, stockChanges(kind, object(beforeConfirmation.value.product), 6));
        expect(await editCall('game', 'PATCH', stale)).toMatchObject({ status: 409, value: { code: 'PRODUCT_VERSION_CONFLICT', applied: false } });
        expect((await h.db.doc(receiptPath(uid, stale.operationId)).get()).exists).toBe(false);
        expect(await sweep()).toMatchObject({ status: 200, body: { selected: 0, attempted: 0 } });
        expect(await physical(kind)).toBe(3);
        expect((await h.db.collection('inventoryMovements').get()).size).toBe(1);
        expect(await h.product()).toMatchObject(publicationFields);
        expect(h.state.posts).toBe(1);
        expect((await control.get()).get('state')).toBe('reconciling');
    } finally {
        releaseSearch();
        await checking;
        await control.update({ state: 'closed' });
    }
}, 30_000);
