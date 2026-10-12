// Vite serves this test-only module so the browser exercises its actual SDK and
// production app singleton. No token, refresh credential or custom token is returned.
import { auth } from '../../src/firebase';
export async function guestIdentity() {
  await auth.authStateReady();
  const user = auth.currentUser; if (!user) throw Error('Expected current demo guest');
  const result = await user.getIdTokenResult();
  const sessionId: unknown = result.claims.mutterCredentialSession;
  if (typeof sessionId !== 'string') throw Error('Expected admitted demo session');
  return { uid: user.uid, sessionId, provider: result.signInProvider };
}
export async function refreshGuestToken() {
  await auth.authStateReady();
  const user = auth.currentUser; if (!user) throw Error('Expected current demo guest');
  await user.getIdToken(true);
}
