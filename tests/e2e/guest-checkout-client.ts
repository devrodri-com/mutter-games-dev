// Browser-only observer of the real app singleton and official SDK. Never
// return an ID token, refresh token, custom token or credential secret.
import { signOut } from 'firebase/auth';
import { auth } from '../../src/firebase';

function demoOnly() {
  if (auth.app.options.projectId !== 'demo-mutter-r1' || auth.emulatorConfig?.host !== '127.0.0.1'
    || auth.emulatorConfig.port !== 9198) throw new Error('Exact demo Auth instance required');
}
export async function identity() {
  demoOnly();
  await auth.authStateReady();
  const user = auth.currentUser;
  if (!user) return null;
  const token = await user.getIdTokenResult();
  if (auth.currentUser !== user) return null;
  return { uid: user.uid, provider: token.signInProvider,
    scope: typeof token.claims.mutterCredentialScope === 'string' ? token.claims.mutterCredentialScope : null,
    admin: token.claims.admin === true, superadmin: token.claims.superadmin === true };
}
export async function signOutCurrent(): Promise<void> {
  demoOnly();
  await auth.authStateReady();
  await signOut(auth);
  if (auth.currentUser !== null) throw new Error('Demo sign-out did not settle');
}
