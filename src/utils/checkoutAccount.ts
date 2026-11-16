import { beforeAuthStateChanged, EmailAuthProvider, linkWithCredential, type User } from 'firebase/auth';
import { auth } from '../firebase';
import { CredentialAccessError, ensureCredentialSession, type CredentialAdmission } from './credentialAccess';

type CheckoutAccountInput = {
  uid: string;
  email: string;
  password: string;
  refreshAccess: () => Promise<CredentialAdmission>;
};
const changed = () => new CredentialAccessError('ACCESS_UNAVAILABLE', 'Cambió la sesión. No confirmamos la cuenta; revisá el acceso actual antes de continuar.');

/** Upgrade only the admitted buyer who owns this checkout; never create or merge identities. */
export async function linkCheckoutAccount({ uid, email, password, refreshAccess }: CheckoutAccountInput): Promise<void> {
  let superseded = false;
  const sameUser = (): User => {
    const current = auth.currentUser;
    if (superseded || !current || current.uid !== uid) throw changed();
    return current;
  };
  const admit = (value: CredentialAdmission) => {
    sameUser();
    if (value.uid !== uid || value.scope !== 'BUYER_POST_CUTOVER_V1' || value.admin || value.superadmin)
      throw new CredentialAccessError('ACCESS_UNAVAILABLE', 'Se necesita un acceso de compras confirmado para crear la cuenta.');
  };
  const initial = sameUser();
  if (initial.email || initial.phoneNumber || initial.providerData.length !== 0)
    throw new CredentialAccessError('ACCESS_UNAVAILABLE', 'Esta sesión ya tiene una cuenta. Ingresá con sus datos para continuar.');
  const stop = beforeAuthStateChanged(auth, next => {
    if (next?.uid === uid && (superseded || auth.currentUser?.uid !== uid)) throw changed();
    if (next?.uid !== uid) superseded = true;
  });
  try {
    admit(await ensureCredentialSession(initial));
    const current = sameUser();
    if (current.email || current.phoneNumber || current.providerData.length !== 0) throw changed();
    const linked = await linkWithCredential(current, EmailAuthProvider.credential(email, password));
    if (linked.user.uid !== uid) throw changed();
    admit(await ensureCredentialSession(sameUser()));
    admit(await refreshAccess());
  } finally { stop(); }
}
