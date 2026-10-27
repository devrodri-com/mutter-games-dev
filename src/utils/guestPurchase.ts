import { beforeAuthStateChanged, signInAnonymously, signOut, type User } from 'firebase/auth';
import { auth } from '../firebase';
import { CredentialAccessError, ensureCredentialSession, type CredentialAdmission, type LegacyGuestNewPurchase } from './credentialAccess';
import { prepareNewPurchaseForm, readGuestPurchaseTransition, withAnonymousIdentityLock, writeGuestPurchaseTransition, type GuestPurchaseTransition } from './guestPurchaseState';
import { guestPurchaseSourceUid, publicGuestPurchaseChoice } from './guestPurchaseChoice';

function changed(): never { throw new CredentialAccessError('ACCESS_UNAVAILABLE', 'Cambió la cuenta. Tu cuenta actual y sus datos se conservan.'); }
function incomplete(): never {
  throw new CredentialAccessError('ACCESS_UNAVAILABLE', 'No pudimos comprobar la sesión de la compra nueva. Recargá para comprobarla. No crearemos otra cuenta al reintentar; tus datos anteriores se conservan.');
}
// Read again after asynchronous SDK transitions; an earlier null snapshot does
// not describe the identity the provider now owns.
function sdkCurrentUser(): User | null { return auth.currentUser; }
const ordinaryIdentity = () => {
  const current = auth.currentUser;
  return current && !current.email && !current.phoneNumber && current.providerData.length === 0 ? current : null;
};

/** Called only by the explained visitor action. No historical document is read,
 * written, linked or deleted, and retries inspect the SDK before any signup. */
export function startLegacyGuestPurchase(offer: LegacyGuestNewPurchase): Promise<CredentialAdmission> {
  return withAnonymousIdentityLock(auth, async () => {
    await auth.authStateReady();
    let saved = readGuestPurchaseTransition(auth);
    if (saved && (saved.uid !== offer.uid || saved.epoch !== offer.epoch)) changed();
    const initial = auth.currentUser;
    if (saved && (saved.phase === 'CREATING' || saved.phase === 'CREATED' || saved.phase === 'SETTLED')
      && (!initial || initial.uid === offer.uid)) incomplete();
    if (initial && initial.uid !== offer.uid) {
      if ((saved && saved.phase === 'PREPARING') || !ordinaryIdentity()) changed();
      // An earlier SDK signup may already have succeeded. Admission, rather
      // than another signup, is the only retry for that existing identity.
      const admitted = await ensureCredentialSession(initial);
      if (auth.currentUser?.uid !== admitted.uid) changed();
      if (admitted.admin || admitted.superadmin) changed();
      if (saved) writeGuestPurchaseTransition(auth, { ...saved, phase: 'SETTLED' });
      return admitted;
    }
    if (!initial && guestPurchaseSourceUid() !== offer.uid) changed();
    {
      // Public eligibility never accepts the old credential for admission and
      // remains usable after revocation or an observed SDK session loss.
      const trusted = await publicGuestPurchaseChoice(offer.uid);
      if (!trusted) throw new CredentialAccessError('RECOVERY_REQUIRED', 'No pudimos confirmar esta opción de compra nueva. Tu cuenta y tus datos se conservan.');
      if (trusted.uid !== offer.uid || trusted.epoch !== offer.epoch || guestPurchaseSourceUid() !== offer.uid) changed();
      saved = { ...trusted, schema: 1, phase: 'PREPARING', startedAtMs: Date.now() };
      writeGuestPurchaseTransition(auth, saved);
      // These unscoped values belong to this explained purchase form. The
      // old UID's cart/checkout references remain separate and untouched.
      prepareNewPurchaseForm();
    }
    if (!saved) changed();
    const transition: GuestPurchaseTransition = saved;
    let superseded = false;
    let createdUid: string | null = null;
    let creationAttempted = false;
    const stop = beforeAuthStateChanged(auth, next => {
      const current = auth.currentUser;
      if (!next) {
        if (superseded || (current && current.uid !== offer.uid)) changed();
        return;
      }
      if (!next.isAnonymous) {
        if (next.uid !== offer.uid && next.uid !== createdUid) superseded = true;
        return;
      }
      if (superseded || (current && current.uid !== next.uid)) changed();
      createdUid = next.uid;
    });
    try {
      if (initial) {
        await signOut(auth);
        if (auth.currentUser) changed();
      }
      writeGuestPurchaseTransition(auth, { ...transition, phase: 'SIGNED_OUT' });
      if (auth.currentUser || superseded) changed();
      // Record uncertainty before starting the official request. A failed
      // response does not prove that the provider failed to create the user.
      writeGuestPurchaseTransition(auth, { ...transition, phase: 'CREATING' });
      creationAttempted = true;
      const credential = await signInAnonymously(auth);
      if (superseded || credential.user.uid === offer.uid || sdkCurrentUser()?.uid !== credential.user.uid || !ordinaryIdentity()) changed();
      writeGuestPurchaseTransition(auth, { ...transition, phase: 'CREATED' });
    } catch (error: unknown) {
      const current = sdkCurrentUser();
      if (current && current.uid !== offer.uid && !ordinaryIdentity()) {
        writeGuestPurchaseTransition(auth, { ...transition, phase: 'SETTLED' });
        changed();
      }
      if (!current) {
        if (creationAttempted) incomplete();
        writeGuestPurchaseTransition(auth, { ...transition, phase: 'SIGNED_OUT' });
        throw new CredentialAccessError('ACCESS_UNAVAILABLE', 'La sesión anterior se cerró. No pudimos completar la compra nueva. Reintentá para continuar.');
      }
      if (current.uid !== offer.uid) writeGuestPurchaseTransition(auth, { ...transition, phase: 'CREATED' });
      throw error;
    } finally { stop(); }
    const current = sdkCurrentUser();
    if (!current || current.uid === offer.uid) changed();
    const admitted = await ensureCredentialSession(current);
    if (sdkCurrentUser()?.uid !== admitted.uid || admitted.admin || admitted.superadmin) changed();
    // Retain only a source-UID coordination barrier: another tab's SDK storage
    // event may lag behind releasing the lock. This grants no access and stores
    // no destination identity or credential. A stale action must not sign out.
    writeGuestPurchaseTransition(auth, { ...transition, phase: 'SETTLED' });
    return admitted;
  });
}
