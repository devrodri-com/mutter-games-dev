export const CREDENTIAL_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const RECOVERY_CHALLENGE_TTL_MS = 30 * 60 * 1000;
export const JOHN_ADMIN_SCOPE = 'JOHN_ADMIN_CLOSED_V1';
export const BUYER_SCOPE = 'BUYER_POST_CUTOVER_V1';
export type CredentialScope = typeof JOHN_ADMIN_SCOPE | typeof BUYER_SCOPE;
export const HASHED_CAPABILITY_FORMAT = 'SHA256_LOCATOR_V1';
export type CredentialRoles = { admin: boolean; superadmin: boolean };
export type PasswordBinding = { versionMs: number; authTimeSeconds: number };
export type CredentialPasswordProof = PasswordBinding & {
  challengeHash: string; sessionLocator: string; consumedAtMs: number;
};
export type CredentialProofKind = 'NEW_POST_CUTOVER' | 'RECOVERY_CHANNEL';
export type CredentialCutover = { schema: 1; phase: 'ENFORCED'; epoch: string; legacyCutoffMs: number }
  | { schema: 2; phase: 'ENFORCED'; epoch: string; legacyCutoffMs: number; scope: typeof JOHN_ADMIN_SCOPE;
    capabilityFormat: typeof HASHED_CAPABILITY_FORMAT; subjectUid: string; additionalSubject?: { uid: string; email: string } };
export type CredentialAccount = {
  schema: 1 | 2; scope?: CredentialScope; uid: string; epoch: string; status: 'PENDING' | 'RECOVERED' | 'NATIVE_POST_CUTOVER';
  recoveryEmail: string | null; channelStatus: 'UNVERIFIED' | 'INDEPENDENTLY_VERIFIED';
  channelEvidenceSha256: string | null; roles: CredentialRoles; passwordProof?: CredentialPasswordProof; nativeCreatedAtMs?: number;
};
export type CredentialSession = {
  schema: 1 | 2; scope?: CredentialScope; capabilityFormat?: typeof HASHED_CAPABILITY_FORMAT;
  status: 'ACTIVE'; uid: string; epoch: string; expiresAtMs: number;
  proofKind: CredentialProofKind; roles: CredentialRoles;
  renewedToLocator?: string; nativeCreatedAtMs?: number;
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
export function parsePasswordBinding(value: unknown): PasswordBinding | null {
  if (!object(value) || !safeTime(value.versionMs) || !safeTime(value.authTimeSeconds)
    || value.authTimeSeconds <= Math.floor(value.versionMs / 1000)) return null;
  return { versionMs: value.versionMs, authTimeSeconds: value.authTimeSeconds };
}
function parsePasswordProof(value: unknown): CredentialPasswordProof | null {
  const binding = parsePasswordBinding(value);
  if (!binding || !object(value) || !validSecret(value.challengeHash)
    || !validSecret(value.sessionLocator) || !safeTime(value.consumedAtMs)) return null;
  return { ...binding, challengeHash: value.challengeHash, sessionLocator: value.sessionLocator, consumedAtMs: value.consumedAtMs };
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
  if (!object(value) || (value.schema !== 1 && value.schema !== 2) || value.phase !== 'ENFORCED' || !validEpoch(value.epoch) || !safeTime(value.legacyCutoffMs)) {
    throw new CredentialAccessError(503, 'ACCESS_TRANSITION_UNAVAILABLE', 'El acceso está en preparación. Conservamos tus datos.');
  }
  if (value.schema === 2) {
    if (value.scope !== JOHN_ADMIN_SCOPE || value.capabilityFormat !== HASHED_CAPABILITY_FORMAT || !validUid(value.subjectUid)) {
      throw new CredentialAccessError(503, 'ACCESS_TRANSITION_UNAVAILABLE', 'El acceso está en preparación. Conservamos tus datos.');
    }
    let additionalSubject: { uid: string; email: string } | undefined;
    if ('additionalSubject' in value) {
      const candidate = value.additionalSubject;
      const email = object(candidate) ? normalizeRecoveryEmail(candidate.email) : null;
      if (!object(candidate) || !validUid(candidate.uid) || candidate.uid === value.subjectUid || !email
        || candidate.email !== email || Object.keys(candidate).length !== 2) {
        throw new CredentialAccessError(503, 'ACCESS_TRANSITION_UNAVAILABLE', 'El acceso está en preparación. Conservamos tus datos.');
      }
      additionalSubject = { uid: candidate.uid, email };
    }
    return { schema: 2, phase: 'ENFORCED', epoch: value.epoch, legacyCutoffMs: value.legacyCutoffMs,
      scope: JOHN_ADMIN_SCOPE, capabilityFormat: HASHED_CAPABILITY_FORMAT, subjectUid: value.subjectUid,
      ...(additionalSubject ? { additionalSubject } : {}) };
  }
  if ('scope' in value || 'capabilityFormat' in value || 'subjectUid' in value || 'additionalSubject' in value) {
    throw new CredentialAccessError(503, 'ACCESS_TRANSITION_UNAVAILABLE', 'El acceso está en preparación. Conservamos tus datos.');
  }
  return { schema: 1, phase: 'ENFORCED', epoch: value.epoch, legacyCutoffMs: value.legacyCutoffMs };
}
export function parseAccount(value: unknown): CredentialAccount | null {
  if (!object(value) || (value.schema !== 1 && value.schema !== 2) || !validUid(value.uid) || !validEpoch(value.epoch)
    || (value.status !== 'PENDING' && value.status !== 'RECOVERED' && value.status !== 'NATIVE_POST_CUTOVER')
    || (value.channelStatus !== 'UNVERIFIED' && value.channelStatus !== 'INDEPENDENTLY_VERIFIED')) return null;
  const accountRoles = roles(value.roles);
  const recoveryEmail = value.recoveryEmail === null ? null : normalizeRecoveryEmail(value.recoveryEmail);
  const evidence: string | null = validSecret(value.channelEvidenceSha256) ? value.channelEvidenceSha256 : null;
  if (!accountRoles || (value.recoveryEmail !== null && !recoveryEmail)
    || (value.channelEvidenceSha256 !== null && evidence === null)) return null;
  if (value.channelStatus === 'INDEPENDENTLY_VERIFIED' && (!recoveryEmail || !evidence)) return null;
  if (value.schema === 2 ? value.scope !== JOHN_ADMIN_SCOPE && value.scope !== BUYER_SCOPE : 'scope' in value) return null;
  if (value.scope === BUYER_SCOPE && (value.status !== 'NATIVE_POST_CUTOVER' || accountRoles.admin || accountRoles.superadmin
    || value.recoveryEmail !== null || value.channelStatus !== 'UNVERIFIED' || value.channelEvidenceSha256 !== null
    || !safeTime(value.nativeCreatedAtMs) || value.restrictionAction != null || value.restrictedAtMs != null
    || 'passwordProof' in value || 'renewedToLocator' in value)) return null;
  const passwordProof = 'passwordProof' in value ? parsePasswordProof(value.passwordProof) : null;
  if ('passwordProof' in value && (!passwordProof || value.schema !== 2 || value.status !== 'RECOVERED')) return null;
  const status = value.status === 'RECOVERED' ? 'RECOVERED' : value.status === 'NATIVE_POST_CUTOVER' ? 'NATIVE_POST_CUTOVER' : 'PENDING';
  return { schema: value.schema, ...(value.schema === 2 ? { scope: value.scope === BUYER_SCOPE ? BUYER_SCOPE : JOHN_ADMIN_SCOPE } : {}), uid: value.uid, epoch: value.epoch, status, recoveryEmail,
    channelStatus: value.channelStatus, channelEvidenceSha256: evidence, roles: accountRoles, ...(passwordProof ? { passwordProof } : {}),
    ...(value.scope === BUYER_SCOPE && safeTime(value.nativeCreatedAtMs) ? { nativeCreatedAtMs: value.nativeCreatedAtMs } : {}) };
}
export function parseSession(value: unknown): CredentialSession | null {
  if (!object(value) || (value.schema !== 1 && value.schema !== 2) || value.status !== 'ACTIVE' || !validUid(value.uid)
    || !validEpoch(value.epoch) || !safeTime(value.expiresAtMs)
    || (value.proofKind !== 'NEW_POST_CUTOVER' && value.proofKind !== 'RECOVERY_CHANNEL')) return null;
  if (value.schema === 2 ? (value.scope !== JOHN_ADMIN_SCOPE && value.scope !== BUYER_SCOPE) || value.capabilityFormat !== HASHED_CAPABILITY_FORMAT
    : 'scope' in value || 'capabilityFormat' in value || 'renewedToLocator' in value) return null;
  if ('renewedToLocator' in value && !validSecret(value.renewedToLocator)) return null;
  const sessionRoles = roles(value.roles);
  if (value.scope === BUYER_SCOPE && (!sessionRoles || sessionRoles.admin || sessionRoles.superadmin
    || value.proofKind !== 'NEW_POST_CUTOVER' || !safeTime(value.nativeCreatedAtMs) || 'passwordProof' in value)) return null;
  return sessionRoles ? { schema: value.schema, ...(value.schema === 2 ? { scope: value.scope === BUYER_SCOPE ? BUYER_SCOPE : JOHN_ADMIN_SCOPE,
    capabilityFormat: HASHED_CAPABILITY_FORMAT } : {}), status: 'ACTIVE', uid: value.uid, epoch: value.epoch,
    expiresAtMs: value.expiresAtMs, proofKind: value.proofKind, roles: sessionRoles,
    ...(typeof value.renewedToLocator === 'string' ? { renewedToLocator: value.renewedToLocator } : {}),
    ...(value.scope === BUYER_SCOPE && safeTime(value.nativeCreatedAtMs) ? { nativeCreatedAtMs: value.nativeCreatedAtMs } : {}) } : null;
}
export function verifiedClaimIdentity(claims: unknown): { uid: string; provider: string } | null {
  if (!object(claims) || !validUid(claims.uid) || !object(claims.firebase) || typeof claims.firebase.sign_in_provider !== 'string') return null;
  return { uid: claims.uid, provider: claims.firebase.sign_in_provider };
}
