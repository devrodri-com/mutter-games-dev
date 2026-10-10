import { createHash } from 'node:crypto';
import type { RulesTestEnvironment } from '@firebase/rules-unit-testing';

// These privileged fixtures establish authorization inputs for Rules unit tests.
// They do not claim that a real holder completed a recovery; the Auth boundary
// suite tests that separate production operation with real SDK/REST sessions.
export const credentialEpoch = 'synthetic-rules-credential-epoch';
const capFor = (uid: string) => createHash('sha256').update(`synthetic-rules-capability:${uid}`).digest('hex');
export function credentialClaims(uid: string, extra: Record<string, unknown> = {}) {
  return { firebase: { sign_in_provider: 'custom', identities: {} },
    mutterCredentialSession: capFor(uid), mutterCredentialEpoch: credentialEpoch, ...extra };
}
export async function seedCredentialAuthority(env: RulesTestEnvironment, identities: readonly {
  uid: string; admin?: boolean; superadmin?: boolean;
}[]) {
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await db.doc('operations/credentialAccessCutover').set({ schema: 1, phase: 'ENFORCED',
      epoch: credentialEpoch, legacyCutoffMs: 1 });
    for (const identity of identities) {
      const roles = { admin: identity.admin === true, superadmin: identity.superadmin === true };
      await db.doc(`credentialAccess/${identity.uid}`).set({ schema: 1, uid: identity.uid, epoch: credentialEpoch,
        status: 'RECOVERED', roles, recoveryEmail: `${identity.uid}@example.invalid`,
        channelStatus: 'INDEPENDENTLY_VERIFIED', channelEvidenceSha256: '1'.repeat(64) });
      await db.doc(`credentialSessions/${capFor(identity.uid)}`).set({
        schema: 1, uid: identity.uid, epoch: credentialEpoch, status: 'ACTIVE', expiresAtMs: Date.now() + 3_600_000,
        proofKind: 'RECOVERY_CHANNEL', roles,
      });
    }
  });
}
