import type { Auth, DecodedIdToken } from 'firebase-admin/auth';
import type { Firestore } from 'firebase-admin/firestore';
import { parseAccount, parseCutover } from './credential-access-state.js';

export type LegacyGuestNewPurchase = { kind: 'LEGACY_ANONYMOUS'; uid: string; epoch: string };

/** This describes a public new-purchase choice. It never admits the old UID. */
export async function legacyGuestNewPurchase(auth: Auth, db: Firestore,
  claims: DecodedIdToken): Promise<LegacyGuestNewPurchase | null> {
  const [controlSnapshot, accountSnapshot, user] = await Promise.all([
    db.doc('operations/credentialAccessCutover').get(), db.doc(`credentialAccess/${claims.uid}`).get(), auth.getUser(claims.uid),
  ]);
  const control = parseCutover(controlSnapshot.data()), account = parseAccount(accountSnapshot.data());
  const createdAtMs = Date.parse(user.metadata.creationTime);
  if (!account || account.uid !== claims.uid || account.epoch !== control.epoch || account.status !== 'PENDING'
    || account.roles.admin || account.roles.superadmin || account.recoveryEmail !== null || account.channelStatus !== 'UNVERIFIED'
    || user.uid !== claims.uid || user.disabled || user.email || user.phoneNumber || user.providerData.length !== 0
    || user.customClaims?.admin === true || user.customClaims?.superadmin === true
    || claims.admin === true || claims.superadmin === true
    || !Number.isSafeInteger(createdAtMs) || createdAtMs > control.legacyCutoffMs) return null;
  return { kind: 'LEGACY_ANONYMOUS', uid: claims.uid, epoch: control.epoch };
}
