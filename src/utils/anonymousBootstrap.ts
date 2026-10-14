import { beforeAuthStateChanged, signInAnonymously, type Auth, type User } from 'firebase/auth';
import { readGuestPurchaseTransition, withAnonymousIdentityLock } from './guestPurchaseState';

const requests = new WeakMap<Auth, Promise<User>>();
/** Only an empty, ordinary visitor session may bootstrap. A transition owns
 * sign-out/signup and therefore suppresses automatic anonymous creation. */
export function bootstrapAnonymousVisitor(auth: Auth): Promise<User> {
  const current = auth.currentUser;
  if (current) return Promise.resolve(current);
  const existing = requests.get(auth);
  if (existing) return existing;
  const request = withAnonymousIdentityLock(auth, async () => {
    await auth.authStateReady();
    if (auth.currentUser) return auth.currentUser;
    const transition = readGuestPurchaseTransition(auth);
    if (transition && transition.phase !== 'SETTLED') throw new Error('La compra nueva espera tu confirmación para continuar.');
    let superseded = false;
    const stop = beforeAuthStateChanged(auth, next => {
      if (!next) return;
      if (!next.isAnonymous) { superseded = true; return; }
      if (superseded || (auth.currentUser && auth.currentUser.uid !== next.uid)) throw new Error('Cambió la cuenta durante el ingreso.');
    });
    try {
      const credential = await signInAnonymously(auth);
      const current: User | null = getSdkUser(auth);
      if (!current) throw new Error('No pudimos comprobar la sesión actual.');
      return current.uid === credential.user.uid ? credential.user : current;
    }
    finally { stop(); }
  }, false).finally(() => requests.delete(auth));
  requests.set(auth, request);
  return request;
}
function getSdkUser(auth: Auth): User | null { return auth.currentUser; }
