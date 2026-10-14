// Test-only Vite module. Exercise the real app singleton, official SDK and APIs.
// Return identity/observable results only; never return an ID or refresh token.
import { beforeAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { doc, getDocFromServer } from 'firebase/firestore';
import { auth, db } from '../../src/firebase';

export async function identity() {
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) return null;
  const claims = await user.getIdTokenResult();
  return { uid: user.uid, provider: claims.signInProvider, email: user.email,
    admin: claims.claims.admin === true, superadmin: claims.claims.superadmin === true,
    sessionId: typeof claims.claims.mutterCredentialSession === 'string' ? claims.claims.mutterCredentialSession : null };
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
  const result: unknown = await response.json();
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw Error('Expected real API result');
  return { status: response.status, body: Object.fromEntries(Object.entries(result)) };
}
