import type { Auth } from 'firebase/auth';

const changedEvent = 'mutter-observed-identity';
const unavailable = new WeakSet<Auth>();
export class ObservedIdentityError extends Error {}
function storageKey(auth: Auth): string {
  const project = auth.app.options.projectId;
  if (!project) throw new ObservedIdentityError('No pudimos comprobar la configuración de acceso.');
  return `mutter-observed-identity:${project}`;
}
function validUid(uid: string): boolean { return uid.length > 0 && uid.length <= 128 && !uid.includes('/'); }
/** This identifier is a bootstrap barrier, never proof of ownership or access. */
export function observedIdentityUid(auth: Auth): string | null {
  if (unavailable.has(auth)) throw new ObservedIdentityError('No pudimos conservar el estado de acceso de este navegador.');
  try {
    const uid = localStorage.getItem(storageKey(auth));
    if (uid !== null && !validUid(uid)) throw new ObservedIdentityError('No pudimos comprobar la cuenta observada.');
    return uid;
  } catch (error: unknown) {
    unavailable.add(auth);
    throw error instanceof ObservedIdentityError ? error : new ObservedIdentityError('No pudimos comprobar el estado de acceso de este navegador.');
  }
}
export function recordObservedIdentity(auth: Auth, uid: string): void {
  if (!validUid(uid)) throw new ObservedIdentityError('No pudimos comprobar la cuenta observada.');
  try {
    localStorage.setItem(storageKey(auth), uid);
    window.dispatchEvent(new Event(changedEvent));
  } catch {
    unavailable.add(auth);
    throw new ObservedIdentityError('No pudimos conservar el estado de acceso de este navegador.');
  }
}
/** Only the UI's completed, explicit logout may forget that same source UID. */
export function forgetObservedIdentity(auth: Auth, expectedUid: string): boolean {
  if (observedIdentityUid(auth) !== expectedUid) return false;
  try {
    localStorage.removeItem(storageKey(auth));
    window.dispatchEvent(new Event(changedEvent));
    return true;
  } catch {
    unavailable.add(auth);
    throw new ObservedIdentityError('No pudimos conservar el cierre de sesión de este navegador.');
  }
}
export function observeIdentityState(auth: Auth, callback: () => void): () => void {
  const onStorage = (event: StorageEvent) => { if (event.key === storageKey(auth)) callback(); };
  window.addEventListener('storage', onStorage);
  window.addEventListener(changedEvent, callback);
  return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(changedEvent, callback); };
}
