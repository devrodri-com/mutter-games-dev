export const CREDENTIAL_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RECOVERY_CHALLENGE_TTL_MS = 30 * 60 * 1000;
export type CredentialRoles = { admin: boolean; superadmin: boolean };
export type CredentialProofKind = 'NEW_POST_CUTOVER' | 'RECOVERY_CHANNEL';
export type CredentialCutover = { schema: 1; phase: 'ENFORCED'; epoch: string; legacyCutoffMs: number };
export type CredentialAccount = {
  schema: 1; uid: string; epoch: string; status: 'PENDING' | 'RECOVERED' | 'NATIVE_POST_CUTOVER';
  recoveryEmail: string | null; channelStatus: 'UNVERIFIED' | 'INDEPENDENTLY_VERIFIED';
  channelEvidenceSha256: string | null; roles: CredentialRoles;
};
export type CredentialSession = {
  schema: 1; status: 'ACTIVE'; uid: string; epoch: string; expiresAtMs: number;
  proofKind: CredentialProofKind; roles: CredentialRoles;
};
export class CredentialAccessError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}
export function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
export function safeTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
export function validUid(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && !value.includes('/');
}
export function validEpoch(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{16,100}$/.test(value);
}
export function validSecret(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}
export function normalizeRecoveryEmail(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
    ? value.trim().toLowerCase() : null;
}
function roles(value: unknown): CredentialRoles | null {
  if (!object(value) || typeof value.admin !== 'boolean' || typeof value.superadmin !== 'boolean') return null;
  return { admin: value.admin, superadmin: value.superadmin };
}
export function parseCutover(value: unknown): CredentialCutover {
  if (!object(value) || value.schema !== 1 || value.phase !== 'ENFORCED' || !validEpoch(value.epoch) || !safeTime(value.legacyCutoffMs)) {
    throw new CredentialAccessError(503, 'ACCESS_TRANSITION_UNAVAILABLE', 'El acceso está en preparación. Conservamos tus datos.');
  }
  return { schema: 1, phase: 'ENFORCED', epoch: value.epoch, legacyCutoffMs: value.legacyCutoffMs };
}
export function parseAccount(value: unknown): CredentialAccount | null {
  if (!object(value) || value.schema !== 1 || !validUid(value.uid) || !validEpoch(value.epoch)
    || (value.status !== 'PENDING' && value.status !== 'RECOVERED' && value.status !== 'NATIVE_POST_CUTOVER')
    || (value.channelStatus !== 'UNVERIFIED' && value.channelStatus !== 'INDEPENDENTLY_VERIFIED')) return null;
  const accountRoles = roles(value.roles);
  const recoveryEmail = value.recoveryEmail === null ? null : normalizeRecoveryEmail(value.recoveryEmail);
  const evidence: string | null = validSecret(value.channelEvidenceSha256) ? value.channelEvidenceSha256 : null;
  if (!accountRoles || (value.recoveryEmail !== null && !recoveryEmail)
    || (value.channelEvidenceSha256 !== null && evidence === null)) return null;
  if (value.channelStatus === 'INDEPENDENTLY_VERIFIED' && (!recoveryEmail || !evidence)) return null;
  const status = value.status === 'RECOVERED' ? 'RECOVERED' : value.status === 'NATIVE_POST_CUTOVER' ? 'NATIVE_POST_CUTOVER' : 'PENDING';
  return { schema: 1, uid: value.uid, epoch: value.epoch, status, recoveryEmail,
    channelStatus: value.channelStatus, channelEvidenceSha256: evidence, roles: accountRoles };
}
export function parseSession(value: unknown): CredentialSession | null {
  if (!object(value) || value.schema !== 1 || value.status !== 'ACTIVE' || !validUid(value.uid)
    || !validEpoch(value.epoch) || !safeTime(value.expiresAtMs)
    || (value.proofKind !== 'NEW_POST_CUTOVER' && value.proofKind !== 'RECOVERY_CHANNEL')) return null;
  const sessionRoles = roles(value.roles);
  return sessionRoles ? { schema: 1, status: 'ACTIVE', uid: value.uid, epoch: value.epoch,
    expiresAtMs: value.expiresAtMs, proofKind: value.proofKind, roles: sessionRoles } : null;
}
export function verifiedClaimIdentity(claims: unknown): { uid: string; provider: string } | null {
  if (!object(claims) || !validUid(claims.uid) || !object(claims.firebase) || typeof claims.firebase.sign_in_provider !== 'string') return null;
  return { uid: claims.uid, provider: claims.firebase.sign_in_provider };
}
