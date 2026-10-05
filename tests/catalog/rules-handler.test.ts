// @vitest-environment node
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { test, expect, vi } from 'vitest';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';
import handler from '../../api/create-mp-preference';
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Expected object');
  return Object.fromEntries(Object.entries(value));
}
function string(value: unknown): string { if (typeof value !== 'string') throw Error('Expected string'); return value; }
test('real Auth + checkout handler + candidate Rules persist one canonical order/intention with a mocked MP boundary', async () => {
  expect(process.env.FIRESTORE_EMULATOR_HOST).toBe('127.0.0.1:8188');
  expect(process.env.FIREBASE_AUTH_EMULATOR_HOST).toBe('127.0.0.1:9198');
  const projectId = 'demo-mutter-r1';
  const uid = `handler-buyer-${randomUUID()}`;
  const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8188, rules: readFileSync('firebase.catalog-r1b.rules', 'utf8') } });
  const app = initializeApp({ projectId }, 'catalog-checkout');
  const db = getFirestore(app); const auth = getAuth(app);
  const actualFetch = globalThis.fetch;
  let posts = 0; let externalReference = '';
  const transport = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (url.href === 'https://api.mercadopago.com/checkout/preferences') {
      posts++; const body = object(JSON.parse(string(init?.body)));
      externalReference = string(body.external_reference);
      expect(body.items).toEqual([{ id: 'p', title: 'P', quantity: 1, unit_price: 100, currency_id: 'UYU' }]);
      return new Response(JSON.stringify({ id: 'synthetic-preference', collector_id: 123, expires: true, expiration_date_to: body.expiration_date_to, init_point: 'https://www.mercadopago.com.uy/checkout/v1/redirect?pref_id=synthetic', external_reference: externalReference }));
    }
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw Error('Nonlocal transport blocked');
    return actualFetch(input, init);
  });
  vi.stubEnv('MP_ACCESS_TOKEN', 'synthetic-not-a-credential');
  vi.stubEnv('MP_COLLECTOR_ID', '123');
  vi.stubEnv('VERCEL', '1');
  vi.stubEnv('WEB_ADMISSION_HMAC_SECRET', 'synthetic-rules-admission-key-only-123');
  async function call(body: unknown, token: string) {
    let output: unknown; let status = 0;
    const res = { setHeader() {}, status(code: number) { status = code; return res; }, json(value: unknown) { output = value; } };
    await handler({ method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-vercel-forwarded-for': '192.0.2.45' }, body }, res);
    return { status, body: object(output) };
  }
  try {
    await env.clearFirestore();
    await db.doc('operations/webStockCutover').set({schema:1,state:'open',revision:'synthetic-open-rules-handler',updatedAt:new Date()});
    await auth.createUser({ uid, email: `${uid}@example.invalid`, password: 'synthetic-handler-buyer-password' });
    const signed = await fetch('http://127.0.0.1:9198/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=synthetic', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${uid}@example.invalid`, password: 'synthetic-handler-buyer-password', returnSecureToken: true }) });
    const token = string(object(await signed.json()).idToken);
    await auth.verifyIdToken(token, true);
    await db.doc('products/p').set({ active: true, title: 'P', stockTotal: 2, priceUSD: 100 });
    const purchase = { items: [{ id: 'p', quantity: 1 }], shipping: { pickup: true, department: '', name: 'Synthetic', address: '', city: '', postalCode: '', phone: '123', email: 'buyer@example.invalid' } };
    expect((await call({ action: 'quote', purchase }, 'invalid')).status).toBe(401);
    const quote = await call({ action: 'quote', purchase }, token); expect(quote.status).toBe(200);
    const input = { action: 'start', purchase, key: 'rules_handler_intent_0001', quoteHash: object(quote.body.quote).hash };
    const started = await call(input, token); expect(started.status).toBe(200);
    expect((await call(input, token)).body).toEqual(started.body); expect(posts).toBe(1);
    const id = string(started.body.id); expect(externalReference).toBe(id);
    expect((await db.doc(`orders/${id}`).get()).data()).toMatchObject({ uid, total: 100, currency: 'UYU', paymentStatus: 'pending', checkoutIntentId: id, preferenceId: 'synthetic-preference' });
    expect((await db.doc(`checkoutIntents/${id}`).get()).data()).toMatchObject({ uid, state: 'ready', preferenceId: 'synthetic-preference' });
    const buyer = env.authenticatedContext(uid, { firebase: { sign_in_provider: 'password', identities: {} } }).firestore();
    await assertSucceeds(buyer.doc(`orders/${id}`).get());
    await assertFails(buyer.doc(`orders/${id}`).update({ paymentStatus: 'paid' }));
    await assertFails(buyer.doc(`checkoutIntents/${id}`).get());
    for (const collection of ['webAdmissionClaims', 'webAdmissionBuckets', 'webStockMaintenance']) {
      await assertFails(buyer.collection(collection).get());
      await assertFails(buyer.doc(`${collection}/synthetic`).set({ synthetic: true }));
    }
  } finally { await auth.deleteUser(uid); transport.mockRestore(); vi.unstubAllEnvs(); await db.terminate(); await deleteApp(app); await env.cleanup(); }
});
