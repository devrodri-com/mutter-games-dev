import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { afterEach, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { forgetObservedIdentity, observedIdentityUid, recordObservedIdentity } from '../../src/utils/observedIdentity';

const apps: ReturnType<typeof initializeApp>[] = [];
function identity() {
  const app = initializeApp({ projectId: `demo-observed-${randomUUID()}`, apiKey: 'synthetic' }, randomUUID());
  apps.push(app); return getAuth(app);
}
afterEach(async () => { await Promise.all(apps.splice(0).map(app => deleteApp(app))); localStorage.clear(); });

test('the project record contains only the last SDK-observed UID and persists independently of a null SDK session', async () => {
  const auth = identity(); await auth.authStateReady();
  expect(observedIdentityUid(auth)).toBeNull();
  recordObservedIdentity(auth, 'synthetic-old-uid');
  expect(auth.currentUser).toBeNull();
  expect(observedIdentityUid(auth)).toBe('synthetic-old-uid');
  expect(localStorage.getItem(`mutter-observed-identity:${auth.app.options.projectId}`)).toBe('synthetic-old-uid');
  expect(localStorage.length).toBe(1);
});

test('explicit logout can forget only its expected UID and preserves a newer identity from another tab', () => {
  const auth = identity();
  recordObservedIdentity(auth, 'synthetic-old-uid');
  recordObservedIdentity(auth, 'synthetic-new-uid');
  expect(forgetObservedIdentity(auth, 'synthetic-old-uid')).toBe(false);
  expect(observedIdentityUid(auth)).toBe('synthetic-new-uid');
  expect(forgetObservedIdentity(auth, 'synthetic-new-uid')).toBe(true);
  expect(observedIdentityUid(auth)).toBeNull();
});

test('a malformed project record fails closed instead of becoming an ordinary empty visitor', () => {
  const auth = identity();
  localStorage.setItem(`mutter-observed-identity:${auth.app.options.projectId}`, 'wrong/path');
  expect(() => observedIdentityUid(auth)).toThrow();
  expect(() => forgetObservedIdentity(auth, 'wrong/path')).toThrow();
});
