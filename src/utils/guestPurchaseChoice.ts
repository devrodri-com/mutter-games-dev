import { auth } from '../firebase';
import { CredentialAccessError, type LegacyGuestNewPurchase } from './credentialAccess';
import { observedIdentityUid } from './observedIdentity';
import { readGuestPurchaseTransition } from './guestPurchaseState';

function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
export function guestPurchaseSourceUid(): string | null {
  if (auth.currentUser) return auth.currentUser.uid;
  const observed = observedIdentityUid(auth);
  if (observed) return observed;
  const saved = readGuestPurchaseTransition(auth);
  return saved && saved.phase !== 'SETTLED' ? saved.uid : null;
}
/** No token is sent: choosing a new public purchase never admits the source. */
export async function publicGuestPurchaseChoice(uid: string): Promise<LegacyGuestNewPurchase | null> {
  const response = await fetch('/api/access/new-purchase-choice', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uid }), cache: 'no-store',
  });
  if (!response.ok) throw new CredentialAccessError('ACCESS_UNAVAILABLE', 'No pudimos comprobar la compra nueva. Intentá nuevamente.');
  const body: unknown = await response.json();
  const currentUid = guestPurchaseSourceUid();
  if (currentUid !== uid) throw new CredentialAccessError('ACCESS_UNAVAILABLE', 'Cambió la cuenta. Tu cuenta actual y sus datos se conservan.');
  if (!object(body) || !('newPurchase' in body)) throw new CredentialAccessError('ACCESS_UNAVAILABLE', 'No pudimos comprobar la compra nueva.');
  const choice = body.newPurchase;
  if (choice === null) return null;
  if (!object(choice) || choice.kind !== 'LEGACY_ANONYMOUS' || choice.uid !== uid
    || typeof choice.epoch !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(choice.epoch))
    throw new CredentialAccessError('ACCESS_UNAVAILABLE', 'No pudimos comprobar la compra nueva.');
  return { kind: 'LEGACY_ANONYMOUS', uid, epoch: choice.epoch };
}
