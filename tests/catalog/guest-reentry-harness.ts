import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, vi } from 'vitest';
import { deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, deleteApp as deleteClientApp } from 'firebase/app';
import { connectAuthEmulator, getAuth as getClientAuth, signInAnonymously, signInWithCustomToken } from 'firebase/auth';
import { connectFirestoreEmulator, doc, getDocFromServer, getFirestore as getClientDb } from 'firebase/firestore';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { handleCredentialAccess, type AccessResponse } from '../../api/_lib/credential-access-handler';
import { initializeDemoAdmin } from './demo-admin';

export const guestEpoch = 'synthetic-guest-reentry-epoch';
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Expected demo object');
  return Object.fromEntries(Object.entries(value));
}
export function text(value: unknown): string { if (typeof value !== 'string') throw Error('Expected demo string'); return value; }
type HeldBody = { reading: Promise<void>; onReading(): void; released: Promise<void>; release(): void };
function heldBody(): HeldBody {
  let onReading = () => {}, release = () => {};
  const reading = new Promise<void>(resolve => { onReading = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  return { reading, onReading, released, release };
}

/** Real Auth/Admin/client SDK, real Firestore and production access HTTP. The
 * only transport adaptation resolves browser-relative fetch URLs to loopback. */
export async function guestHarness(rulesFile = 'firebase.catalog-r1b.rules') {
  expect(process.env.FIREBASE_AUTH_EMULATOR_HOST).toBe('127.0.0.1:9198');
  expect(process.env.FIRESTORE_EMULATOR_HOST).toBe('127.0.0.1:8188');
  const projectId = 'demo-mutter-r1', name = `guest-reentry-${randomUUID()}`;
  const app = initializeDemoAdmin(name), auth = getAuth(app), db = getFirestore(app);
  const env = await initializeTestEnvironment({ projectId, firestore: { host: '127.0.0.1', port: 8188, rules: readFileSync(rulesFile, 'utf8') } });
  await env.clearFirestore();
  await db.doc('operations/credentialAccessCutover').set({ schema: 1, phase: 'ENFORCED', epoch: guestEpoch, legacyCutoffMs: 1 });
  const client = initializeApp({ projectId, apiKey: 'synthetic' }, name);
  const browserAuth = getClientAuth(client), browserDb = getClientDb(client);
  connectFirestoreEmulator(browserDb, '127.0.0.1', 8188);
  const users = new Set<string>(), clients = [client], holds: HeldBody[] = [];
  let nextHold: HeldBody | undefined, observedHold: HeldBody | undefined, nextAuthHold: HeldBody | undefined;
  const actualFetch = globalThis.fetch;
  const server = createServer(async (req, res) => {
    const authPath = req.url?.startsWith('/identitytoolkit.googleapis.com/') || req.url?.startsWith('/securetoken.googleapis.com/');
    if (req.url !== '/api/access/session' && !authPath) { res.statusCode = 404; res.end(); return; }
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of req) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > 16000) { res.statusCode = 413; res.end(); return; }
      chunks.push(bytes);
    }
    if (authPath) {
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (key === 'host' || key === 'content-length') continue;
        if (typeof value === 'string') headers.set(key, value);
        else if (Array.isArray(value)) for (const part of value) headers.append(key, part);
      }
      const upstream = await actualFetch(`http://127.0.0.1:9198${req.url}`, { method: req.method, headers,
        ...(req.method !== 'GET' ? { body: Buffer.concat(chunks) } : {}) });
      res.statusCode = upstream.status; res.setHeader('Content-Type', 'application/json');
      const serialized = await upstream.text();
      const hold = upstream.ok && req.url?.includes('/accounts:signInWithCustomToken') ? nextAuthHold : undefined;
      if (!hold) { res.end(serialized); return; }
      nextAuthHold = undefined; res.write(serialized.slice(0, 1)); hold.onReading();
      await hold.released; res.end(serialized.slice(1)); return;
    }
    const reply: AccessResponse = {
      setHeader: (key, value) => res.setHeader(key, value),
      status(code) { res.statusCode = code; return reply; },
      json(body) {
        res.setHeader('Content-Type', 'application/json');
        const serialized = JSON.stringify(body), data = record(body);
        const hold = typeof data.customToken === 'string' ? nextHold : undefined;
        if (!hold) { res.end(serialized); return; }
        nextHold = undefined; observedHold = hold;
        res.setHeader('x-synthetic-held-body', '1');
        res.write(serialized.slice(0, 1));
        return hold.released.then(() => { res.end(serialized.slice(1)); });
      },
    };
    try { await handleCredentialAccess('session', auth, db, { method: req.method, headers: { ...req.headers }, body: Buffer.concat(chunks).toString('utf8') }, reply); }
    catch { res.statusCode = 500; res.end(); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Expected owned loopback server');
  const origin = `http://127.0.0.1:${address.port}`;
  // Node Auth uses its own fetch implementation. This owned HTTP relay forwards
  // its unchanged protocol to the actual Auth emulator and can pause one body.
  connectAuthEmulator(browserAuth, origin, { disableWarnings: true });
  let externalAttempts = 0;
  const transport = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const requested = input instanceof Request ? input.url : String(input);
    const url = new URL(requested, origin);
    if (url.hostname !== '127.0.0.1') { externalAttempts++; throw Error('Only owned loopback transport is permitted'); }
    const response = await actualFetch(input instanceof Request ? input : url, init);
    if (response.headers.get('x-synthetic-held-body') === '1') {
      const hold = observedHold, json = response.json.bind(response);
      // Observe the real JSON reader; never replace its parsing or authority.
      response.json = () => { hold?.onReading(); return json(); };
    }
    return response;
  });
  async function identity() {
    const user = browserAuth.currentUser; if (!user) throw Error('Expected current demo account');
    const token = await user.getIdToken(true), claims = await auth.verifyIdToken(token, true);
    return { user, uid: user.uid, token, claims, sessionId: text(claims.mutterCredentialSession) };
  }
  async function access(token: string, body: unknown = {}) {
    const response = await fetch(`${origin}/api/access/session`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: record(await response.json()) };
  }
  async function newGuest() { const signed = await signInAnonymously(browserAuth); users.add(signed.user.uid); return signed.user; }
  async function otherGuest() {
    const other = initializeApp({ projectId, apiKey: 'synthetic' }, `${name}-other-${randomUUID()}`); clients.push(other);
    const otherAuth = getClientAuth(other); connectAuthEmulator(otherAuth, origin, { disableWarnings: true });
    const signed = await signInAnonymously(otherAuth); users.add(signed.user.uid);
    const native = await access(await signed.user.getIdToken(true)); expect(native.status).toBe(200);
    return { uid: signed.user.uid, customToken: text(native.body.customToken) };
  }
  async function seedData(uid: string) {
    const cart = { cartItems: [{ id: 'synthetic-guest-product', quantity: 2, customName: 'Same holder' }] };
    const order = { uid, commerceVersion: 2, untouched: 'same holder order' }, orderId = `synthetic-guest-order-${randomUUID()}`;
    await db.doc(`carts/${uid}`).set(cart); await db.doc(`orders/${orderId}`).set(order);
    return { cart, order, orderId };
  }
  async function privateReads(uid: string, orderId: string) {
    return { cart: (await getDocFromServer(doc(browserDb, 'carts', uid))).data(), order: (await getDocFromServer(doc(browserDb, 'orders', orderId))).data() };
  }
  async function privateRequest(token: string, path: string) {
    return fetch(`http://127.0.0.1:8188/v1/projects/${projectId}/databases/(default)/documents/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  }
  async function expire(sessionId: string, expiresAtMs = Date.now() - 1) { await db.doc(`credentialSessions/${sessionId}`).update({ expiresAtMs }); }
  function holdNextCustomBody() { const hold = heldBody(); nextHold = hold; holds.push(hold); return hold; }
  function holdNextAuthResponse() { const hold = heldBody(); nextAuthHold = hold; holds.push(hold); return hold; }
  return { auth, db, browserAuth, origin, identity, access, newGuest, otherGuest, seedData, privateReads, privateRequest, expire, holdNextCustomBody, holdNextAuthResponse,
    switchToOther: async (token: string) => { await signInWithCustomToken(browserAuth, token); },
    dispose: async () => {
      for (const hold of holds) hold.release();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      expect(externalAttempts).toBe(0); transport.mockRestore();
      for (const uid of users) await auth.deleteUser(uid).catch((error: unknown) => { if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'auth/user-not-found') throw error; });
      for (const entry of clients) await deleteClientApp(entry);
      await env.clearFirestore(); await env.cleanup(); await db.terminate(); await deleteApp(app);
    } };
}
