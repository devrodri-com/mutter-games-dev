// @vitest-environment node
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test, expect, vi } from 'vitest';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp as clientApp, deleteApp as deleteClientApp } from 'firebase/app';
import { getAuth as clientAuth, connectAuthEmulator, signInAnonymously, signInWithCustomToken, linkWithCredential,
  EmailAuthProvider, reauthenticateWithCredential, signOut, signInWithEmailAndPassword } from 'firebase/auth';
import handler from '../../api/create-mp-preference';

test('real custom/renewed/derived sessions at checkout and exact candidate Rules', async () => {
  expect(process.env.FIREBASE_AUTH_EMULATOR_HOST).toBe('127.0.0.1:9198');
  expect(process.env.FIRESTORE_EMULATOR_HOST).toBe('127.0.0.1:8188');
  const projectId = 'demo-mutter-r1';
  const app = initializeApp({ projectId }, 'catalog-checkout');
  const auth = getAuth(app), db = getFirestore(app);
  const client = clientApp({ projectId, apiKey: 'synthetic' }, `session-boundary-${randomUUID()}`);
  const browserAuth = clientAuth(client);
  connectAuthEmulator(browserAuth, 'http://127.0.0.1:9198', { disableWarnings: true });
  const uid = `boundary-${randomUUID()}`, email = `${uid}@example.invalid`;
  const actualFetch = globalThis.fetch;
  let externalCalls = 0;
  const transport = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') { externalCalls++; throw Error('External request blocked'); }
    return actualFetch(input, init);
  });
  async function call(token: string, action: string, spoof = true) {
    let status = 0;
    const res = { setHeader() {}, status(value: number) { status = value; return res; }, json() {} };
    await handler({ method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-sign-in-provider': 'password' },
      body: spoof ? { action, admin: true, firebase: { sign_in_provider: 'password' }, orderId: 'synthetic' } : action === 'availability' ? { action, productIds: ['synthetic-nonexistent-session-product'] } : { action } }, res);
    return status;
  }
  async function firestore(project: string, token: string | undefined, path: string, method = 'PATCH') {
    return fetch(`http://127.0.0.1:8188/v1/projects/${project}/databases/(default)/documents/${path}`, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(method === 'PATCH' ? { body: JSON.stringify({ fields: { name: { stringValue: 'Synthetic update' } } }) } : {}),
    });
  }
  try {
    const anonymous = await signInAnonymously(browserAuth);
    try {
      for (const token of [await anonymous.user.getIdToken(), await anonymous.user.getIdToken(true)]) {
        expect((await auth.verifyIdToken(token, true)).firebase.sign_in_provider).toBe('anonymous');
        expect(await call(token, 'availability', false)).toBe(200);
        expect(await call(token, 'admin_orders', false)).toBe(403);
      }
    } finally { await signOut(browserAuth); await auth.deleteUser(anonymous.user.uid); }
    await auth.createUser({ uid }); await auth.setCustomUserClaims(uid, { admin: true, superadmin: true });
    const signed = await signInWithCustomToken(browserAuth, await auth.createCustomToken(uid));
    const original = await signed.user.getIdToken(), renewed = await signed.user.getIdToken(true);
    const collections = vi.spyOn(db, 'collection'); // Call-through only; the SDK and policy remain real.
    for (const token of [original, renewed]) {
      expect.soft(await call(token, 'admin_orders', false)).toBe(403);
      expect((await auth.verifyIdToken(token, true)).firebase.sign_in_provider).toBe('custom');
      for (const action of ['admin_orders', 'admin_order', 'quote', 'availability', 'start', 'status', 'recover', 'verify']) {
        expect.soft(await call(token, action), `custom ${action}`).toBe(403);
      }
    }
    expect.soft(collections).not.toHaveBeenCalled(); collections.mockRestore();
    const password = `synthetic-${randomUUID()}`;
    const credential = EmailAuthProvider.credential(email, password);
    await linkWithCredential(signed.user, credential);
    await reauthenticateWithCredential(signed.user, credential);
    const reauthenticated = await signed.user.getIdToken(true);
    expect((await auth.verifyIdToken(reauthenticated, true)).firebase.sign_in_provider).toBe('password');
    await signOut(browserAuth);
    const ordinary = await signInWithEmailAndPassword(browserAuth, email, password);
    const derived = await ordinary.user.getIdToken(true);
    expect((await auth.verifyIdToken(derived, true)).uid).toBe(uid);
    // Characterization of the residual, NOT a security closure assertion.
    expect(await call(derived, 'admin_orders', false)).toBe(200);
    expect(await call(reauthenticated, 'admin_orders', false)).toBe(200);

    // Reissue after linking: account changes may invalidate an earlier session.
    const customAgain = await signInWithCustomToken(browserAuth, await auth.createCustomToken(uid));
    const custom = await customAgain.user.getIdToken(true);
    for (const rulesFile of ['firebase.catalog-r1b.rules', 'firebase.catalog-cutover.rules']) {
      const rulesProject = rulesFile.includes('cutover') ? 'demo-mutter-boundary-cutover' : 'demo-mutter-boundary-r1b';
      const env = await initializeTestEnvironment({ projectId: rulesProject, firestore: { host: '127.0.0.1', port: 8188, rules: readFileSync(rulesFile, 'utf8') } });
      try {
        await env.clearFirestore();
        const paths = [`carts/${uid}`, `clients/${uid}`, `clients/${email}`, `usuarios/${uid}`];
        await env.withSecurityRulesDisabled(async context => {
          const seed = context.firestore();
          await seed.doc(`adminUsers/${email}`).set({ role: 'admin' });
          await seed.doc('orders/private').set({ uid });
          for (const path of [...paths, 'clients/other', 'products/p', 'categories/c', 'categories/c/subcategories/s']) await seed.doc(path).set({ name: 'Untouched' });
        });
        for (const state of ['open', 'closed']) {
          await env.withSecurityRulesDisabled(context => context.firestore().doc('operations/webStockCutover').set({ schema: 1, state, revision: 'synthetic-boundary-rules', updatedAt: new Date() }));
          for (const path of [...paths, 'clients/other', 'products/p', 'categories/c', 'categories/c/subcategories/s', 'orders/private', 'checkoutIntents/private', 'adminUsers/new']) {
            for (const method of ['PATCH', 'DELETE']) expect.soft((await firestore(rulesProject, custom, path, method)).status, `${rulesFile} ${state} ${method} ${path}`).toBe(403);
          }
          for (const path of [...paths, 'clients/other', 'orders/private', `adminUsers/${email}`]) expect.soft((await firestore(rulesProject, custom, path, 'GET')).status).toBe(403);
          expect.soft((await firestore(rulesProject, undefined, 'products/p', 'GET')).status).toBe(200);
          await env.withSecurityRulesDisabled(async context => {
            for (const path of [...paths, 'products/p', 'categories/c', 'categories/c/subcategories/s']) expect.soft((await context.firestore().doc(path).get()).data()).toEqual({ name: 'Untouched' });
          });
        }
        await env.withSecurityRulesDisabled(context => context.firestore().doc('operations/webStockCutover').set({ schema: 1, state: 'open', revision: 'synthetic-boundary-rules', updatedAt: new Date() }));
        expect((await firestore(rulesProject, derived, `carts/${uid}`)).status).toBe(200);
        for (const path of ['products/p', 'categories/c', 'categories/c/subcategories/s']) expect.soft((await firestore(rulesProject, derived, path)).status, 'catalog stays server owned').toBe(403);
      } finally { await env.cleanup(); }
    }
    expect(externalCalls).toBe(0);
  } finally { transport.mockRestore(); await signOut(browserAuth); await deleteClientApp(client); await auth.deleteUser(uid); await db.terminate(); await deleteApp(app); }
}, 60000);
