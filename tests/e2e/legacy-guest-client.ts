// Test-only Vite module. Exercise the real app singleton, official SDK and APIs.
// Return identity/observable results only; never return an ID or refresh token.
import { beforeAuthStateChanged, indexedDBLocalPersistence, onAuthStateChanged, setPersistence, signInWithCustomToken } from 'firebase/auth';
import { doc, getDocFromServer } from 'firebase/firestore';
import { auth, db } from '../../src/firebase';

export async function identity() {
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) return null;
  const claims = await user.getIdTokenResult();
  // The official SDK may have selected another user while token claims were
  // awaited. Report only an identity that is still the current SDK instance.
  if (auth.currentUser !== user) return null;
  return { uid: user.uid, provider: claims.signInProvider, email: user.email,
    admin: claims.claims.admin === true, superadmin: claims.claims.superadmin === true,
    sessionId: typeof claims.claims.mutterCredentialSession === 'string' ? claims.claims.mutterCredentialSession : null };
}

/** Admission precedes the cart's first authoritative Firestore snapshot. Wait
 * only for a cache to exist, then let the caller assert its complete contents.
 * A different SDK owner fails this observation instead of being retried. */
export async function waitForPersistedCart(uid: string): Promise<void> {
  if (auth.currentUser?.uid !== uid) throw Error('SDK identity changed before cart persistence');
  return new Promise((resolve, reject) => {
    let finished = false, frame = 0;
    let stop = () => {};
    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeout); window.cancelAnimationFrame(frame); stop();
      if (error) reject(error); else resolve();
    };
    const timeout = window.setTimeout(() => finish(new Error('Cart cache was not persisted for the admitted UID')), 5000);
    stop = onAuthStateChanged(auth, user => {
      if (user?.uid !== uid) finish(new Error('SDK identity changed while awaiting cart persistence'));
    });
    const inspect = () => {
      if (finished) return;
      if (auth.currentUser?.uid !== uid) { finish(new Error('SDK identity changed while awaiting cart persistence')); return; }
      try {
        if (localStorage.getItem(`mutter-cart:${uid}`) !== null) finish();
        else frame = window.requestAnimationFrame(inspect);
      } catch (error: unknown) { finish(error instanceof Error ? error : new Error('Cart cache could not be read')); }
    };
    inspect();
  });
}

export async function signIn(token: string) {
  return (await signInWithCustomToken(auth, token)).user.uid;
}

export async function refresh() {
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) throw Error('Expected current demo identity');
  await user.getIdToken(true);
}

async function responseObject(response: Response) {
  const result: unknown = await response.json();
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error('Expected real API result');
  return { status: response.status, body: Object.fromEntries(Object.entries(result)) };
}

export async function accessSession() {
  const current = auth.currentUser;
  if (!current) throw Error('Expected current demo identity');
  const token = await current.getIdToken();
  return responseObject(await fetch('/api/access/session', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: '{}' }));
}

export async function newPurchaseChoice(uid: string) {
  // This public selector is a decision prompt, never identity or capability.
  return responseObject(await fetch('/api/access/new-purchase-choice', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid }) }));
}

/** Create an older persistence format through the official SDK, then let the
 * next actual app startup perform its supported migration. Demo setup only. */
export async function persistInIndexedDb() {
  if (auth.app.options.projectId !== 'demo-mutter-r1' || auth.emulatorConfig?.host !== '127.0.0.1'
    || auth.emulatorConfig.port !== 9198) throw Error('Exact demo Auth instance required');
  await setPersistence(auth, indexedDBLocalPersistence);
}

let anonymousAbort: Promise<{ rejectedUid: string }> | null = null;
let stopAbortObserver: (() => void) | null = null;
/** Readonly official SDK observer, registered before the production action.
 * onAbort proves a later production middleware rejected the attempted update. */
export function watchAnonymousAbort() {
  stopAbortObserver?.();
  let attemptedUid: string | null = null;
  anonymousAbort = new Promise(resolve => {
    stopAbortObserver = beforeAuthStateChanged(auth, next => {
      if (next?.isAnonymous) attemptedUid = next.uid;
    }, () => { if (attemptedUid) resolve({ rejectedUid: attemptedUid }); });
  });
}
export async function waitAnonymousAbort() {
  if (!anonymousAbort) throw Error('Expected installed SDK observation');
  try { return await anonymousAbort; }
  finally { stopAbortObserver?.(); stopAbortObserver = null; anonymousAbort = null; }
}
export function stopAnonymousAbort() { stopAbortObserver?.(); stopAbortObserver = null; anonymousAbort = null; }

export async function privateRead(collection: string, id: string) {
  try {
    const result = await getDocFromServer(doc(db, collection, id));
    return { status: 'READ', exists: result.exists(), data: result.data() };
  } catch (error: unknown) {
    return { status: 'DENIED', code: error && typeof error === 'object' && 'code' in error ? String(error.code) : 'UNKNOWN' };
  }
}

export async function api(body: Record<string, unknown>) {
  const current = auth.currentUser;
  if (!current) throw Error('Expected current demo identity');
  const token = await current.getIdToken();
  const response = await fetch('/api/create-mp-preference', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return responseObject(response);
}
