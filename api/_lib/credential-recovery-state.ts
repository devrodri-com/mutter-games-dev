import { RECOVERY_CHALLENGE_TTL_MS, JOHN_ADMIN_SCOPE, normalizeRecoveryEmail, object, safeTime,
  validEpoch, validSecret, validUid, parsePasswordBinding, type PasswordBinding, type CredentialAccount } from './credential-access-state.js';

export type RecoveryChallenge = {
  schema: 1 | 2; scope?: typeof JOHN_ADMIN_SCOPE; uid: string; epoch: string; email: string; channelEvidenceSha256: string; secretHash: string;
  createdAtMs: number; expiresAtMs: number; passwordUpdatedAtBeforeMs: number;
  deliveryState: 'PENDING' | 'SENT' | 'UNCERTAIN' | 'CONSUMED'; roles: CredentialAccount['roles'];
  sessionLocator?: string; consumedAtMs?: number; passwordBinding?: PasswordBinding;
};
export function parseChallenge(value: unknown): RecoveryChallenge | null {
  if (!object(value) || (value.schema !== 1 && value.schema !== 2) || !validUid(value.uid) || !validEpoch(value.epoch)
    || !validSecret(value.secretHash) || !validSecret(value.channelEvidenceSha256)
    || !safeTime(value.createdAtMs) || !safeTime(value.expiresAtMs) || !safeTime(value.passwordUpdatedAtBeforeMs)
    || value.expiresAtMs <= value.createdAtMs || value.expiresAtMs > value.createdAtMs + RECOVERY_CHALLENGE_TTL_MS
    || (value.deliveryState !== 'PENDING' && value.deliveryState !== 'SENT' && value.deliveryState !== 'UNCERTAIN' && value.deliveryState !== 'CONSUMED') || !object(value.roles)
    || typeof value.roles.admin !== 'boolean' || typeof value.roles.superadmin !== 'boolean') return null;
  const email = normalizeRecoveryEmail(value.email);
  if (!email) return null;
  const deliveryState = value.deliveryState === 'SENT' ? 'SENT' : value.deliveryState === 'UNCERTAIN' ? 'UNCERTAIN' : value.deliveryState === 'CONSUMED' ? 'CONSUMED' : 'PENDING';
  if (value.schema === 2 ? value.scope !== JOHN_ADMIN_SCOPE : 'scope' in value) return null;
  if (value.schema === 2 && deliveryState === 'CONSUMED' && (!validSecret(value.sessionLocator) || !safeTime(value.consumedAtMs))) return null;
  const passwordBinding = 'passwordBinding' in value ? parsePasswordBinding(value.passwordBinding) : null;
  if ('passwordBinding' in value && (!passwordBinding || value.schema !== 2 || deliveryState !== 'CONSUMED')) return null;
  if (value.schema === 2 && deliveryState === 'CONSUMED'
    && (!safeTime(value.consumedAtMs) || value.consumedAtMs < value.createdAtMs || value.consumedAtMs >= value.expiresAtMs)) return null;
  return { schema: value.schema, ...(value.schema === 2 ? { scope: JOHN_ADMIN_SCOPE } : {}), uid: value.uid, epoch: value.epoch, email, channelEvidenceSha256: value.channelEvidenceSha256,
    secretHash: value.secretHash, createdAtMs: value.createdAtMs, expiresAtMs: value.expiresAtMs,
    passwordUpdatedAtBeforeMs: value.passwordUpdatedAtBeforeMs, deliveryState,
    roles: { admin: value.roles.admin, superadmin: value.roles.superadmin },
    ...(validSecret(value.sessionLocator) ? { sessionLocator: value.sessionLocator } : {}),
    ...(safeTime(value.consumedAtMs) ? { consumedAtMs: value.consumedAtMs } : {}),
    ...(passwordBinding ? { passwordBinding } : {}) };
}

/** The per-account request is only a delivery guard. When it still names a
 * challenge, every lifecycle and closure field must agree with that challenge. */
export function requestMatchesChallenge(value: unknown, challenge: RecoveryChallenge): boolean {
  if (!object(value) || value.schema !== challenge.schema || value.scope !== challenge.scope
    || value.uid !== challenge.uid || value.epoch !== challenge.epoch || value.challengeHash !== challenge.secretHash
    || value.deliveryState !== challenge.deliveryState || value.createdAtMs !== challenge.createdAtMs
    || value.expiresAtMs !== challenge.expiresAtMs) return false;
  return challenge.deliveryState === 'CONSUMED'
    ? value.sessionLocator === challenge.sessionLocator && value.consumedAtMs === challenge.consumedAtMs
      && validSecret(value.sessionLocator) && safeTime(value.consumedAtMs)
    : !('sessionLocator' in value) && !('consumedAtMs' in value);
}
