// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8188') throw new Error('Demo emulator required');
const env = await initializeTestEnvironment({ projectId: 'demo-mutter-cutover-rules', firestore: {
    host: '127.0.0.1', port: 8188, rules: readFileSync('firebase.catalog-cutover.rules', 'utf8'),
} });
const admin = env.authenticatedContext('admin', { email: 'admin@example.invalid', firebase: { sign_in_provider: 'password', identities: {} } }).firestore();
const buyer = env.authenticatedContext('buyer', { email: 'buyer@example.invalid', firebase: { sign_in_provider: 'password', identities: {} } }).firestore();
const publicDb = env.unauthenticatedContext().firestore();
const controlPath = 'operations/webStockCutover';
async function control(state: 'open' | 'closed' | 'reconciling') {
    await env.withSecurityRulesDisabled(async context => context.firestore().doc(controlPath).set({
        schema: 1, state, revision: 'synthetic-rules-revision', updatedAt: new Date(),
    }));
}
beforeAll(async () => {
    await env.clearFirestore();
    await env.withSecurityRulesDisabled(async context => {
        const db = context.firestore();
        for (const [path, data] of Object.entries({
            'adminUsers/admin@example.invalid': { role: 'admin' },
            'products/p': { stockTotal: 5, webReservations: { opaque: { quantity: 1 } } },
            'categories/c': { name: 'Synthetic' }, 'categories/c/subcategories/s': { name: 'Synthetic' },
            'clients/buyer': { name: 'Synthetic' }, 'carts/buyer': { items: [] }, 'usuarios/buyer': { name: 'Synthetic' },
            'orders/o': { uid: 'buyer', commerceVersion: 2 },
        })) await db.doc(path).set(data);
    });
});
afterAll(() => env.cleanup());

const adminPaths = ['products/p', 'categories/c', 'categories/c/subcategories/s'];
const buyerPaths = ['clients/buyer', 'carts/buyer', 'usuarios/buyer'];
test('missing control closes every direct writer while preserving public and authorized reads', async () => {
    for (const path of adminPaths) await assertFails(admin.doc(path).update({ name: 'blocked' }));
    for (const path of buyerPaths) await assertFails(buyer.doc(path).update({ name: 'blocked' }));
    await assertSucceeds(publicDb.doc('products/p').get());
    await assertSucceeds(buyer.doc('orders/o').get());
    await assertSucceeds(buyer.doc('carts/buyer').get());
});
test('open preserves owner writes and keeps catalogue server-owned; client cannot modify control or commercial ledgers', async () => {
    await control('open');
    for (const path of adminPaths) await assertFails(admin.doc(path).update({ name: 'open' }));
    for (const path of buyerPaths) await assertSucceeds(buyer.doc(path).update({ name: 'open' }));
    for (const db of [admin, buyer, publicDb]) {
        await assertFails(db.doc(controlPath).get());
        await assertFails(db.doc(controlPath).set({ schema: 1, state: 'open' }));
        await assertFails(db.doc('checkoutIntents/attempt').set({ state: 'ready' }));
        await assertFails(db.doc('orders/new').set({ uid: 'buyer', items: [{}], total: 1, createdAt: new Date(), shipping: {} }));
    }
});
test('close rejects create/update/delete including a stale previously-authorized client, without touching reservations', async () => {
    await control('closed');
    for (const path of adminPaths) {
        await assertFails(admin.doc(path).update({ name: 'blocked' }));
        await assertFails(admin.doc(`${path}-new`).set({ name: 'blocked' }));
        await assertFails(admin.doc(path).delete());
        await assertSucceeds(publicDb.doc(path).get());
    }
    for (const path of buyerPaths) {
        await assertFails(buyer.doc(path).set({ name: 'blocked' }));
        await assertFails(buyer.doc(path).delete());
        await assertSucceeds(buyer.doc(path).get());
    }
    await assertFails(admin.doc('clients/buyer').delete());
    await assertFails(admin.doc('orders/o').delete());
    expect((await publicDb.doc('products/p').get()).data()).toMatchObject({ stockTotal: 5, webReservations: { opaque: { quantity: 1 } } });
    await control('open');
    expect((await publicDb.doc('products/p').get()).data()).toMatchObject({ stockTotal: 5, webReservations: { opaque: { quantity: 1 } } });
});
test('malformed control cannot make Rules more permissive', async () => {
    await env.withSecurityRulesDisabled(context => context.firestore().doc(controlPath).set({ schema: 1, state: 'open', revision: 'short', updatedAt: 'not-a-timestamp' }));
    await assertFails(admin.doc('products/p').update({ stockTotal: 99 }));
});
test('reconciling phase never opens any direct client writer', async () => {
    await control('reconciling');
    for (const path of adminPaths) await assertFails(admin.doc(path).update({ stockTotal: 99 }));
    for (const path of buyerPaths) await assertFails(buyer.doc(path).update({ name: 'blocked' }));
    await assertSucceeds(publicDb.doc('products/p').get());
});
