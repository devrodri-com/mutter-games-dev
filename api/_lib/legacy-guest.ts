import type { Auth, DecodedIdToken } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { parseAccount, parseCutover } from './credential-access-state.js';

export type LegacyGuestNewPurchase = { kind: 'LEGACY_ANONYMOUS'; uid: string; epoch: string };

/** This describes a public new-purchase choice. It never admits the old UID. */
export async function publicLegacyGuestChoice(auth: Auth, db: Firestore, uid: string): Promise<LegacyGuestNewPurchase | null> {
  const [controlSnapshot, accountSnapshot, user] = await Promise.all([
    db.doc('operations/credentialAccessCutover').get(), db.doc(`credentialAccess/${uid}`).get(),
    auth.getUser(uid).catch((error: unknown) => {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'auth/user-not-found') return null;
      throw error;
    }),
  ]);
  const control = parseCutover(controlSnapshot.data()), account = parseAccount(accountSnapshot.data());
  if (control.schema === 2) return null;
  if (!user) return null;
  const createdAtMs = Date.parse(user.metadata.creationTime);
  if (!account || account.uid !== uid || account.epoch !== control.epoch || account.status !== 'PENDING'
    || account.roles.admin || account.roles.superadmin || account.recoveryEmail !== null || account.channelStatus !== 'UNVERIFIED'
    || user.uid !== uid || user.disabled || user.email || user.phoneNumber || user.providerData.length !== 0
    || user.customClaims?.admin === true || user.customClaims?.superadmin === true
    || !Number.isSafeInteger(createdAtMs) || createdAtMs > control.legacyCutoffMs) return null;
  return { kind: 'LEGACY_ANONYMOUS', uid, epoch: control.epoch };
}

export function legacyGuestNewPurchase(auth: Auth, db: Firestore, claims: DecodedIdToken): Promise<LegacyGuestNewPurchase | null> {
  if (claims.admin === true || claims.superadmin === true) return Promise.resolve(null);
  return publicLegacyGuestChoice(auth, db, claims.uid);
}
