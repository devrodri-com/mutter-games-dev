// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

if (process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9198') {
  throw new Error('Exact loopback Auth emulator required');
}

const app = initializeApp({ projectId: 'demo-mutter-r1' });
const auth = getAuth(app);
const uid = `dependency-role-${randomUUID()}`;
const email = `${uid}@example.invalid`;
let setAdminRole: typeof import('../../scripts/setAdminRole').setAdminRole;

beforeAll(async () => {
  // Import the existing exported operation without invoking its terminal CLI.
  const argv = process.argv;
  process.argv = argv.slice(0, 2);
  try {
    ({ setAdminRole } = await vi.importActual<typeof import('../../scripts/setAdminRole')>('../../scripts/setAdminRole.ts'));
  } finally {
    process.argv = argv;
  }
  await auth.createUser({ uid, email });
});

afterAll(async () => {
  await auth.deleteUser(uid);
  await deleteApp(app);
});

test.each([false, true])('existing role operation preserves superadmin=%s with modular Admin SDK', async (superadmin) => {
  await setAdminRole(email, superadmin);
  expect((await auth.getUser(uid)).customClaims).toEqual({ admin: true, superadmin });
});

test('invalid email still rejects without changing synthetic claims', async () => {
  const before = (await auth.getUser(uid)).customClaims;
  await expect(setAdminRole('invalid-email', true)).rejects.toThrow('Email inválido');
  expect((await auth.getUser(uid)).customClaims).toEqual(before);
});
