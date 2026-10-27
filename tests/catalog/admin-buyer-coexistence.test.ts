// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { cert, deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { Timestamp } from 'firebase-admin/firestore';
import { JOHN_ADMIN_SCOPE } from '../../api/_lib/credential-access-state';
import { credentialSessionLocator } from '../../api/_lib/credential-capability';
import { receiptPath } from '../../api/_lib/catalog-edit-policy';
import { createHarness, object } from './helpers/web-stock-harness';
import { createCoexistenceHttp } from './helpers/coexistence-http';

const buyerScope = 'BUYER_POST_CUTOVER_V1'; // Expected public session contract.
const projectId = 'demo-mutter-stock-recovery', epoch = 'synthetic_coexistence_epoch';
let h: Awaited<ReturnType<typeof createHarness>>, http: Awaited<ReturnType<typeof createCoexistenceHttp>>;
let admin: App, auth: Auth, expectedState: 'open' | 'closed';
const ownedUsers = new Set<string>();
const administrators = new Map<string, { uid: string; token: string }>();
let protectedControl: Record<string, unknown>, expectedWebControl: Record<string, unknown>, baselineProduct: Record<string, unknown>;
let expectedWebUpdateTime: Timestamp | undefined;
const preserved = { active: true, status: 'legacy-state', archived: false, images: ['legacy:image'],
    version: 'legacy-version', unknown: { nested: ['keep', null, 17] } };
const text = (value: unknown): string => {
    if (typeof value !== 'string') throw new Error('Missing synthetic string'); return value;
};
async function authRest(action: string, body: unknown) {
    const response = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:${action}?key=synthetic`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    expect(response.status).toBe(200); return object(await response.json());
}
async function exchange(customToken: string): Promise<string> {
    return text((await authRest('signInWithCustomToken', { token: customToken, returnSecureToken: true })).idToken);
}
async function nativeBuyer(kind: 'password' | 'anonymous' = 'password') {
    let signed: Record<string, unknown>;
    if (kind === 'password') {
        const uid = `synthetic-buyer-${randomUUID()}`, email = `${uid}@example.invalid`, password = `Synthetic-${randomUUID()}`;
        await auth.createUser({ uid, email, password }); ownedUsers.add(uid);
        signed = await authRest('signInWithPassword', { email, password, returnSecureToken: true });
    } else {
        signed = await authRest('signUp', { returnSecureToken: true }); ownedUsers.add(text(signed.localId));
    }
    const nativeToken = text(signed.idToken), uid = text(signed.localId);
    const createdAtMs = Date.parse((await auth.getUser(uid)).metadata.creationTime);
    const cutoff = protectedControl.legacyCutoffMs;
    if (typeof cutoff !== 'number') throw new Error('Missing synthetic creation cutoff');
    expect(createdAtMs).toBeGreaterThan(cutoff); expect(createdAtMs).toBeLessThanOrEqual(Date.now());
    const session = await http.call('/api/access/session', nativeToken, 'POST', {});
    expect(session).toMatchObject({ status: 200, cache: 'no-store', value: { status: 'ACTIVE', uid,
        scope: buyerScope, admin: false, superadmin: false } });
    const token = await exchange(text(session.value.customToken));
    const resumed = await http.call('/api/access/session', token, 'POST', {});
    expect(resumed).toMatchObject({ status: 200, value: { status: 'ACTIVE', uid,
        scope: buyerScope, admin: false, superadmin: false } });
    return { uid, nativeToken, token };
}
async function checkout(token: string, body: unknown) {
    const reply = await http.call('/api/create-mp-preference', token, 'POST', body);
    expect(reply.cache).toBe('no-store'); return reply;
}
const purchase = (quantity: number) => ({ ...h.purchase(), items: [{ id: 'game', variantId: '', quantity }] });
async function quote(token: string, quantity: number) {
    const response = await checkout(token, { action: 'quote', purchase: purchase(quantity) });
    expect(response.status).toBe(200); return object(response.value.quote);
}
const patch = (version: unknown, changes: Record<string, unknown>) => ({ version, intent: 'edit', operationId: randomUUID(), changes });
const edit = (token: string, method = 'GET', body?: unknown) => http.call('/api/catalog-edit?id=game', token, method, body);
async function assertControls() {
    const current = await h.db.doc('operations/webStockCutover').get();
    expect(current.get('state')).toBe(expectedState); expect(current.data()).toEqual(expectedWebControl);
    if (!expectedWebUpdateTime) throw new Error('Missing synthetic cutover version');
    expect(current.updateTime?.isEqual(expectedWebUpdateTime)).toBe(true);
    expect((await h.db.doc('operations/credentialAccessCutover').get()).data()).toEqual(protectedControl);
}
async function assertNoCheckoutWrites() {
    for (const name of ['orders', 'checkoutIntents', 'webCheckoutLocks', 'webReservationOwners', 'inventoryMovements'])
        expect((await h.db.collection(name).get()).empty).toBe(true);
    expect(h.state.posts).toBe(0); expect(await h.holds()).toHaveLength(0);
}

beforeEach(async () => {
    for (const key of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_PRIVATE_KEY', 'GOOGLE_OAUTH_ACCESS_TOKEN',
        'VERCEL_TOKEN', 'MP_ACCESS_TOKEN', 'WEB_ADMISSION_HMAC_SECRET']) expect(process.env[key]).toBeUndefined();
    expect(process.env.FIREBASE_AUTH_EMULATOR_HOST).toBe('127.0.0.1:9198');
    expect(process.env.FIRESTORE_EMULATOR_HOST).toBe('127.0.0.1:8188');
    expect(process.env.GCLOUD_PROJECT).toBe(projectId);
    h = await createHarness();
    // The shared stock fixture freezes Date.now for expiry scenarios. This HTTP
    // flow needs the real clock for Auth metadata issued by a separate process.
    vi.spyOn(Date, 'now').mockRestore(); expect(vi.isMockFunction(Date.now)).toBe(false);
    administrators.clear(); ownedUsers.clear(); expectedState = 'open';
    vi.stubEnv('VERCEL', '1'); vi.stubEnv('WEB_ADMISSION_HMAC_SECRET', 'synthetic-coexistence-ip-secret-never-real');
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048,
        privateKeyEncoding: { format: 'pem', type: 'pkcs8' }, publicKeyEncoding: { format: 'pem', type: 'spki' } });
    admin = initializeApp({ projectId, credential: cert({ projectId,
        clientEmail: `synthetic@${projectId}.iam.gserviceaccount.com`, privateKey }) }, 'catalog-checkout');
    auth = getAuth(admin);
    const subjects = ['john', 'rodrigo'].map(name => ({ name, uid: `synthetic-${name}-${randomUUID()}` }));
    protectedControl = { schema: 2, phase: 'ENFORCED', epoch, legacyCutoffMs: h.state.now - 1_000_000,
        scope: JOHN_ADMIN_SCOPE, capabilityFormat: 'SHA256_LOCATOR_V1', subjectUid: subjects[0].uid,
        additionalSubject: { uid: subjects[1].uid, email: `${subjects[1].uid}@example.invalid` } };
    await h.db.doc('operations/credentialAccessCutover').set(protectedControl);
    expectedWebControl = { schema: 1, state: 'open', revision: 'synthetic_open_coexistence', updatedAt: Timestamp.now() };
    await h.db.doc('operations/webStockCutover').set(expectedWebControl);
    expectedWebUpdateTime = (await h.db.doc('operations/webStockCutover').get()).updateTime;
    for (const subject of subjects) {
        const email = `${subject.uid}@example.invalid`, secret = randomBytes(32).toString('hex');
        await auth.createUser({ uid: subject.uid, email, emailVerified: true }); ownedUsers.add(subject.uid);
        // A valid prior protected recovery is fixture state; HTTP resume and
        // every consumer must still verify its current account/session/identity.
        await h.db.doc(`credentialAccess/${subject.uid}`).set({ schema: 2, scope: JOHN_ADMIN_SCOPE, uid: subject.uid, epoch,
            status: 'RECOVERED', recoveryEmail: email, channelStatus: 'INDEPENDENTLY_VERIFIED',
            channelEvidenceSha256: 'a'.repeat(64), roles: { admin: true, superadmin: false } });
        await h.db.doc(`credentialSessions/${credentialSessionLocator(secret)}`).set({ schema: 2, scope: JOHN_ADMIN_SCOPE,
            capabilityFormat: 'SHA256_LOCATOR_V1', status: 'ACTIVE', uid: subject.uid, epoch,
            expiresAtMs: h.state.now + 24 * 60 * 60_000, proofKind: 'RECOVERY_CHANNEL', roles: { admin: true, superadmin: false } });
        const token = await exchange(await auth.createCustomToken(subject.uid, { mutterCredentialSession: secret,
            mutterCredentialEpoch: epoch, mutterCredentialScope: JOHN_ADMIN_SCOPE, admin: true, superadmin: false }));
        administrators.set(subject.name, { uid: subject.uid, token });
    }
    await h.seed('game', 6); await h.db.doc('products/game').update({ ...preserved, title: { es: 'Juego', en: 'Legacy title' } });
    baselineProduct = await h.product(); http = await createCoexistenceHttp();
}, 30_000);
afterEach(async () => {
    try {
        if (h) {
            await assertControls();
            if (process.env.MUTTER_TEST_COEXISTENCE_BASELINE === '1') {
                await assertNoCheckoutWrites(); expect(await h.product()).toEqual(baselineProduct);
            }
        }
    } finally {
        try {
            if (http) await http.dispose();
            if (auth) for (const uid of ownedUsers) await auth.deleteUser(uid);
        } finally {
            if (admin) await deleteApp(admin);
            if (h) await h.dispose();
            vi.restoreAllMocks();
        }
    }
});

test.each(['john', 'rodrigo'])('%s and a native buyer use real HTTP admission/checkout/catalog in the same unchanged open state', async name => {
    const administrator = administrators.get(name); if (!administrator) throw new Error('Missing protected administrator');
    const resumed = await http.call('/api/access/session', administrator.token, 'POST', {});
    expect(resumed).toMatchObject({ status: 200, value: { uid: administrator.uid, scope: JOHN_ADMIN_SCOPE, admin: true } });
    const buyer = await nativeBuyer();
    const opened = await edit(administrator.token); expect(opened.status).toBe(200);
    const input = patch(opened.value.version, { title: { es: 'Juego revisado' }, stockTotal: 5 });
    expect(await edit(administrator.token, 'PATCH', input)).toMatchObject({ status: 200,
        value: { status: 'CONFIRMED', operationId: input.operationId, baseVersion: opened.value.version } });
    const verified = await edit(administrator.token); expect(verified.status).toBe(200);
    expect(verified.value.product).toEqual({ ...object(opened.value.product), title: { es: 'Juego revisado', en: 'Legacy title' }, stockTotal: 5 });
    expect((await h.db.doc(receiptPath(administrator.uid, input.operationId)).get()).get('status')).toBe('CONFIRMED');
    await assertControls();

    const firstQuote = await quote(buyer.token, 3), key = randomUUID();
    const started = await checkout(buyer.token, { action: 'start', purchase: purchase(3), key, quoteHash: firstQuote.hash });
    expect(started.status).toBe(200); expect(typeof started.value.id).toBe('string');
    expect(await h.product()).toMatchObject({ ...preserved, stockTotal: 5 }); expect(await h.holds()).toHaveLength(1);
    const other = await nativeBuyer('anonymous');
    expect((await quote(other.token, 2)).items).toEqual([expect.objectContaining({ quantity: 2, stock: 2 })]);
    expect(await checkout(other.token, { action: 'start', purchase: purchase(3), key: randomUUID(), quoteHash: firstQuote.hash }))
        .toMatchObject({ status: 409, value: { code: 'CATALOG_UNAVAILABLE' } });
    expect((await h.db.collection('orders').get()).size).toBe(1); expect(h.state.posts).toBe(1);
    await assertControls();

    const held = await edit(administrator.token), heldProduct = await h.product();
    const belowHold = patch(held.value.version, { stockTotal: 2 });
    expect(await edit(administrator.token, 'PATCH', belowHold)).toMatchObject({ status: 400, value: { applied: false } });
    expect(await h.product()).toEqual(heldProduct);
    expect((await h.db.doc(receiptPath(administrator.uid, belowHold.operationId)).get()).exists).toBe(false);
    const stale = patch(verified.value.version, { title: { es: 'Stale' } });
    expect(await edit(administrator.token, 'PATCH', stale)).toMatchObject({ status: 409,
        value: { code: 'PRODUCT_VERSION_CONFLICT', applied: false } });
    expect((await h.db.doc(receiptPath(administrator.uid, stale.operationId)).get()).exists).toBe(false);

    h.state.now = Date.now(); // Timestamp only the explicitly synthetic provider observation.
    const paymentId = await h.observe(started.value.id, 'approved');
    for (let check = 0; check < 2; check++) expect(await checkout(buyer.token,
        { action: 'verify', orderId: started.value.id, paymentId })).toMatchObject({ status: 200,
        value: { inventoryState: 'committed', paymentStatus: 'approved' } });
    expect(await h.product()).toMatchObject({ ...preserved, stockTotal: 2, title: { es: 'Juego revisado', en: 'Legacy title' } });
    expect(await h.holds()).toHaveLength(0); expect((await h.db.collection('inventoryMovements').get()).size).toBe(1);
    expect((await quote(other.token, 2)).items).toEqual([expect.objectContaining({ quantity: 2, stock: 2 })]);
    expect((await checkout(other.token, { action: 'quote', purchase: purchase(3) })).status).toBe(409);
    await assertControls();
}, 30_000);

test.each(['password', 'anonymous'] as const)('%s buyer receives no Admin authority and native tokens cannot bypass admission', async kind => {
    const buyer = await nativeBuyer(kind), before = await h.product();
    expect((await checkout(buyer.nativeToken, { action: 'quote', purchase: purchase(1) })).status).toBe(403);
    expect((await edit(buyer.token)).status).toBe(403);
    expect((await edit(buyer.token, 'PATCH', patch('1:1', { stockTotal: 1 }))).status).toBe(403);
    const administrator = administrators.get('john'); if (!administrator) throw new Error('Missing administrator');
    expect((await checkout(administrator.token, { action: 'quote', purchase: purchase(1) })).status).toBe(403);
    expect(await h.product()).toEqual(before); expect((await h.db.collection('adminProductOperations').get()).empty).toBe(true);
    await assertNoCheckoutWrites();
});

test('closed purchase control still admits the buyer session but prevents an order or payment preference', async () => {
    expectedState = 'closed';
    await h.db.doc('operations/webStockCutover').update({ state: 'closed' });
    expectedWebControl = { ...expectedWebControl, state: 'closed' };
    expectedWebUpdateTime = (await h.db.doc('operations/webStockCutover').get()).updateTime;
    const buyer = await nativeBuyer(), before = await h.product(), quoted = await quote(buyer.token, 3);
    expect(await checkout(buyer.token, { action: 'start', purchase: purchase(3), key: randomUUID(), quoteHash: quoted.hash }))
        .toMatchObject({ status: 503, value: { code: 'CUTOVER_CLOSED' } });
    expect(await h.product()).toEqual(before); await assertNoCheckoutWrites(); await assertControls();
});

test('expired buyer explicitly reenters with one child; revoked source and invalid tokens fail before commercial writes', async () => {
    const buyer = await nativeBuyer(), before = await h.product();
    const claims = await auth.verifyIdToken(buyer.token, true);
    const locator = credentialSessionLocator(text(claims.mutterCredentialSession));
    const parent = h.db.doc(`credentialSessions/${locator}`);
    await parent.update({ expiresAtMs: h.state.now - 1 });
    expect((await checkout(buyer.token, { action: 'quote', purchase: purchase(1) })).status).toBe(403);
    const reentered = await http.call('/api/access/session', buyer.token, 'POST', {});
    expect(reentered).toMatchObject({ status: 200, cache: 'no-store', value: { status: 'ACTIVE', uid: buyer.uid,
        scope: buyerScope, admin: false, superadmin: false } });
    const childToken = await exchange(text(reentered.value.customToken));
    const childClaims = await auth.verifyIdToken(childToken, true);
    expect(childClaims.uid).toBe(buyer.uid);
    const childLocator = credentialSessionLocator(text(childClaims.mutterCredentialSession));
    expect(childLocator).not.toBe(locator);
    expect((await parent.get()).get('renewedToLocator')).toBe(childLocator);
    expect((await parent.get()).get('expiresAtMs')).toBeLessThan(Date.now());
    const repeated = await http.call('/api/access/session', buyer.token, 'POST', {});
    expect(repeated).toMatchObject({ status: 200, value: { uid: buyer.uid, scope: buyerScope, admin: false, superadmin: false } });
    const repeatedClaims = await auth.verifyIdToken(await exchange(text(repeated.value.customToken)), true);
    expect(repeatedClaims.uid).toBe(buyer.uid);
    expect(credentialSessionLocator(text(repeatedClaims.mutterCredentialSession))).toBe(childLocator);
    const capabilities = h.db.collection('credentialSessions').where('uid', '==', buyer.uid);
    expect((await capabilities.get()).docs.map(doc => doc.id).sort()).toEqual([locator, childLocator].sort());
    expect((await checkout(buyer.token, { action: 'quote', purchase: purchase(1) })).status).toBe(403);
    await parent.update({ status: 'REVOKED' });
    expect(await http.call('/api/access/session', buyer.token, 'POST', {})).toMatchObject({ status: 403,
        value: { code: 'RECOVERY_REQUIRED' } });
    expect((await capabilities.get()).docs.map(doc => doc.id).sort()).toEqual([locator, childLocator].sort());
    expect((await edit('synthetic-invalid-token')).status).toBe(401);
    expect(await h.product()).toEqual(before);
    expect((await h.db.collection('adminProductOperations').get()).empty).toBe(true);
    await assertNoCheckoutWrites();
});
