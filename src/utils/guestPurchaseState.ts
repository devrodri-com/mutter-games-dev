import type { Auth } from 'firebase/auth';
import type { LegacyGuestNewPurchase } from './credentialAccess';

export type GuestPurchaseTransition = LegacyGuestNewPurchase & { schema: 1; phase: 'PREPARING' | 'SIGNED_OUT' | 'CREATING' | 'CREATED' | 'SETTLED'; startedAtMs: number };
export const GUEST_PURCHASE_STATE_EVENT = 'mutter-guest-purchase-state';
const formEvent = 'mutter-purchase-form-preparing';
/** Only an explained, explicit new-purchase action resets this local form. */
export function prepareNewPurchaseForm(): void {
  localStorage.setItem('mutter-cart-migrated', 'yes');
  localStorage.removeItem('shippingData');
  localStorage.removeItem('lastOrderId');
  window.dispatchEvent(new Event(formEvent));
}
export function observeNewPurchaseForm(callback: () => void): () => void {
  const onStorage = (event: StorageEvent) => { if (event.key === 'shippingData' && event.newValue === null) callback(); };
  window.addEventListener(formEvent, callback);
  window.addEventListener('storage', onStorage);
  return () => { window.removeEventListener(formEvent, callback); window.removeEventListener('storage', onStorage); };
}
export class GuestPurchaseStateError extends Error {}
function storageKey(auth: Auth): string | null {
  const projectId = auth.app?.options.projectId;
  return typeof projectId === 'string' && projectId ? `mutter-guest-purchase:${projectId}` : null;
}
export function readGuestPurchaseTransition(auth: Auth): GuestPurchaseTransition | null {
  const key = storageKey(auth);
  if (!key) return null;
  const serialized = localStorage.getItem(key);
  if (serialized === null) return null;
  let data: unknown;
  try { data = JSON.parse(serialized); }
  catch { throw new GuestPurchaseStateError('No pudimos comprobar el inicio guardado. Tu cuenta y tus datos se conservan.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data) || !('schema' in data) || data.schema !== 1
    || !('kind' in data) || data.kind !== 'LEGACY_ANONYMOUS' || !('uid' in data) || typeof data.uid !== 'string' || !data.uid || data.uid.length > 128 || data.uid.includes('/')
    || !('epoch' in data) || typeof data.epoch !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(data.epoch)
    || !('phase' in data) || (data.phase !== 'PREPARING' && data.phase !== 'SIGNED_OUT' && data.phase !== 'CREATING' && data.phase !== 'CREATED' && data.phase !== 'SETTLED')
    || !('startedAtMs' in data) || typeof data.startedAtMs !== 'number' || !Number.isSafeInteger(data.startedAtMs) || data.startedAtMs <= 0)
    throw new GuestPurchaseStateError('No pudimos comprobar el inicio guardado. Tu cuenta y tus datos se conservan.');
  return { schema: 1, kind: 'LEGACY_ANONYMOUS', uid: data.uid, epoch: data.epoch, phase: data.phase, startedAtMs: data.startedAtMs };
}
export function writeGuestPurchaseTransition(auth: Auth, transition: GuestPurchaseTransition | null): void {
  const key = storageKey(auth);
  if (!key) throw new GuestPurchaseStateError('No pudimos comprobar la configuración de acceso.');
  if (transition) {
    const saved = readGuestPurchaseTransition(auth);
    const progress = { PREPARING: 0, SIGNED_OUT: 1, CREATING: 2, CREATED: 3, SETTLED: 4 };
    // A lost HTTP result or a delayed SDK state cannot reopen a creation that
    // may already have reached the provider. This is only a local barrier.
    if (saved && saved.uid === transition.uid && saved.epoch === transition.epoch
      && progress[saved.phase] >= progress.CREATING && progress[transition.phase] < progress[saved.phase])
      throw new GuestPurchaseStateError('No pudimos confirmar la sesión nueva. No crearemos otra cuenta al reintentar.');
    localStorage.setItem(key, JSON.stringify(transition));
  }
  else localStorage.removeItem(key);
  window.dispatchEvent(new Event(GUEST_PURCHASE_STATE_EVENT));
}
export function observeGuestPurchaseState(callback: () => void): () => void {
  window.addEventListener('storage', callback);
  window.addEventListener(GUEST_PURCHASE_STATE_EVENT, callback);
  return () => { window.removeEventListener('storage', callback); window.removeEventListener(GUEST_PURCHASE_STATE_EVENT, callback); };
}
/** The same browser-origin lock covers the bootstrap and the explicit action.
 * Unsupported browsers fail before changing the current session. */
export function withAnonymousIdentityLock<T>(auth: Auth, task: () => Promise<T>, required = true): Promise<T> {
  const key = storageKey(auth);
  if (!key) return Promise.reject(new GuestPurchaseStateError('No pudimos comprobar la configuración de acceso.'));
  if (typeof navigator.locks?.request !== 'function') {
    if (!required) return Promise.resolve().then(task);
    return Promise.reject(new GuestPurchaseStateError('Este navegador no permite iniciar la compra nueva con seguridad. Usá un navegador actualizado.'));
  }
  return navigator.locks.request(key, { mode: 'exclusive' }, task);
}
