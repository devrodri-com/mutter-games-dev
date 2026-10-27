import { createHash } from 'node:crypto';
import { CredentialAccessError, JOHN_ADMIN_SCOPE, BUYER_SCOPE, HASHED_CAPABILITY_FORMAT, validSecret, safeTime,
  type CredentialAccount, type CredentialCutover, type CredentialSession } from './credential-access-state.js';

/** The locator is public metadata, never the proof accepted from a caller. */
export function credentialSessionLocator(secret: string): string {
  if (!validSecret(secret)) throw new CredentialAccessError(403, 'RECOVERY_REQUIRED', 'Necesitás recuperar el acceso.');
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}
export function scopedSecret(proof: string, purpose: 'recovery' | 'renewal'): string {
  if (!validSecret(proof)) throw new CredentialAccessError(403, 'RECOVERY_NOT_COMPLETED', 'No pudimos completar ese acceso.');
  return createHash('sha256').update(`${JOHN_ADMIN_SCOPE}\0${purpose}\0${proof}`, 'utf8').digest('hex');
}
/** Membership comes only from the protected server control, never caller claims. */
export function scopedSubjectAllowed(control: CredentialCutover, uid: string): boolean {
  return control.schema === 2 && (uid === control.subjectUid || uid === control.additionalSubject?.uid);
}
export function scopedAccountMatches(control: CredentialCutover, account: CredentialAccount | null): boolean {
  return control.schema === 2 && account !== null && account.schema === 2 && account.scope === JOHN_ADMIN_SCOPE
    && scopedSubjectAllowed(control, account.uid) && account.epoch === control.epoch
    && (account.uid === control.subjectUid || account.recoveryEmail === control.additionalSubject?.email)
    && account.channelStatus === 'INDEPENDENTLY_VERIFIED' && account.recoveryEmail !== null
    && account.channelEvidenceSha256 !== null && (account.roles.admin || account.roles.superadmin)
    && account.status !== 'NATIVE_POST_CUTOVER';
}
export function scopedSessionMatches(control: CredentialCutover, account: CredentialAccount | null,
  session: CredentialSession | null): boolean {
  return scopedAccountMatches(control, account) && account?.status === 'RECOVERED' && session !== null
    && session.schema === 2 && session.scope === JOHN_ADMIN_SCOPE && session.capabilityFormat === HASHED_CAPABILITY_FORMAT
    && session.uid === account.uid && session.epoch === account.epoch && session.proofKind === 'RECOVERY_CHANNEL'
    && session.roles.admin === account.roles.admin && session.roles.superadmin === account.roles.superadmin;
}

/** A buyer capability is a separate domain. Existing Admin matching and secret
 * derivation above retain their exact membership and recovery requirements. */
export function buyerAccountMatches(control: CredentialCutover, account: CredentialAccount | null): boolean {
  return control.schema === 2 && account !== null && account.schema === 2 && account.scope === BUYER_SCOPE
    && !scopedSubjectAllowed(control, account.uid) && account.epoch === control.epoch
    && account.status === 'NATIVE_POST_CUTOVER' && !account.roles.admin && !account.roles.superadmin
    && account.recoveryEmail === null && account.channelStatus === 'UNVERIFIED' && account.channelEvidenceSha256 === null
    && safeTime(account.nativeCreatedAtMs) && account.nativeCreatedAtMs > control.legacyCutoffMs;
}
export function buyerSessionMatches(control: CredentialCutover, account: CredentialAccount | null,
  session: CredentialSession | null): boolean {
  return buyerAccountMatches(control, account) && account !== null && session !== null
    && session.schema === 2 && session.scope === BUYER_SCOPE && session.capabilityFormat === HASHED_CAPABILITY_FORMAT
    && session.uid === account.uid && session.epoch === control.epoch && session.proofKind === 'NEW_POST_CUTOVER'
    && !session.roles.admin && !session.roles.superadmin && session.nativeCreatedAtMs === account.nativeCreatedAtMs;
}
export function buyerSecret(proof: string, purpose: 'native' | 'renewal'): string {
  if (purpose === 'native' ? typeof proof !== 'string' || proof.length < 20 || proof.length > 16000 : !validSecret(proof))
    throw new CredentialAccessError(403, 'RECOVERY_REQUIRED', 'No pudimos comprobar el acceso comprador.');
  return createHash('sha256').update(`${BUYER_SCOPE}\0${purpose}\0${proof}`, 'utf8').digest('hex');
}
