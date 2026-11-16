import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as ts from 'typescript';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const boundary = vi.hoisted(() => {
  const forbiddenMutation = () => vi.fn<(...args: unknown[]) => Promise<never>>();
  const forbiddenRead = () => vi.fn<(...args: unknown[]) => never>();
  return {
    app: { options: { projectId: 'demo-firebase-utils-diagnostics' } },
    initializedDb: { kind: 'initialized-synthetic-db' },
    fallbackDb: { kind: 'existing-synthetic-db' },
    auth: { currentUser: null },
    initializeFirestore: vi.fn<(app: unknown, options: unknown) => unknown>(),
    getFirestore: vi.fn<(app: unknown) => unknown>(),
    getAuth: vi.fn<(app: unknown) => unknown>(),
    getApp: vi.fn<() => unknown>(),
    mutations: {
      createUserWithEmailAndPassword: forbiddenMutation(), signInWithEmailAndPassword: forbiddenMutation(),
      sendPasswordResetEmail: forbiddenMutation(), setDoc: forbiddenMutation(), addDoc: forbiddenMutation(),
      updateDoc: forbiddenMutation(), deleteDoc: forbiddenMutation(), ensureAuthReady: forbiddenMutation(),
    },
    reads: { doc: forbiddenRead(), getDoc: forbiddenRead(), collection: forbiddenRead(), getDocs: forbiddenRead(),
      query: forbiddenRead(), orderBy: forbiddenRead(), serverTimestamp: forbiddenRead(), where: forbiddenRead() },
  };
});
vi.mock('../../src/firebase', () => ({ default: boundary.app, ensureAuthReady: boundary.mutations.ensureAuthReady }));
vi.mock('firebase/app', () => ({ getApp: boundary.getApp }));
vi.mock('firebase/auth', () => ({ getAuth: boundary.getAuth,
  createUserWithEmailAndPassword: boundary.mutations.createUserWithEmailAndPassword,
  signInWithEmailAndPassword: boundary.mutations.signInWithEmailAndPassword,
  sendPasswordResetEmail: boundary.mutations.sendPasswordResetEmail }));
vi.mock('firebase/firestore', () => ({ initializeFirestore: boundary.initializeFirestore, getFirestore: boundary.getFirestore,
  ...boundary.reads, setDoc: boundary.mutations.setDoc, addDoc: boundary.mutations.addDoc,
  updateDoc: boundary.mutations.updateDoc, deleteDoc: boundary.mutations.deleteDoc }));

type FirebaseUtils = typeof import('../../src/firebaseUtils');
const firestoreOptions = {
  experimentalForceLongPolling: true,
  experimentalAutoDetectLongPolling: true,
  ignoreUndefinedProperties: true,
};
function expectNoBusinessSdkCalls() {
  for (const mutation of Object.values(boundary.mutations)) expect(mutation).not.toHaveBeenCalled();
  for (const read of Object.values(boundary.reads)) expect(read).not.toHaveBeenCalled();
  expect(globalThis.fetch).not.toHaveBeenCalled();
}
beforeEach(() => {
  vi.resetModules();
  boundary.initializeFirestore.mockReset().mockReturnValue(boundary.initializedDb);
  boundary.getFirestore.mockReset().mockReturnValue(boundary.fallbackDb);
  boundary.getAuth.mockReset().mockReturnValue(boundary.auth);
  boundary.getApp.mockReset().mockReturnValue(boundary.app);
  for (const mutation of Object.values(boundary.mutations)) mutation.mockReset().mockRejectedValue(new Error('Unexpected synthetic SDK mutation'));
  for (const read of Object.values(boundary.reads)) read.mockReset().mockImplementation(() => { throw new Error('Unexpected synthetic SDK read'); });
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network forbidden in this local regression'));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); });

test('real module initializes its shared db with unchanged options and auth instance without business SDK calls', async () => {
  const actual = await import('../../src/firebaseUtils');
  expect(actual.db).toBe(boundary.initializedDb);
  expect(boundary.initializeFirestore).toHaveBeenCalledExactlyOnceWith(boundary.app, firestoreOptions);
  expect(boundary.getFirestore).not.toHaveBeenCalled();
  expect(actual.auth).toBe(boundary.auth);
  expect(boundary.getAuth).toHaveBeenCalledExactlyOnceWith(boundary.app);
  expect(boundary.getApp).toHaveBeenCalledTimes(1);
  expectNoBusinessSdkCalls();
});

test('real module falls back to the same app Firestore instance when initialization throws', async () => {
  boundary.initializeFirestore.mockImplementationOnce(() => { throw new Error('Synthetic already-initialized instance'); });
  const actual = await import('../../src/firebaseUtils');
  expect(actual.db).toBe(boundary.fallbackDb);
  expect(boundary.initializeFirestore).toHaveBeenCalledExactlyOnceWith(boundary.app, firestoreOptions);
  expect(boundary.getFirestore).toHaveBeenCalledExactlyOnceWith(boundary.app);
  expect(actual.auth).toBe(boundary.auth);
  expect(boundary.getAuth).toHaveBeenCalledExactlyOnceWith(boundary.app);
  expectNoBusinessSdkCalls();
});

const disabledCases: { name: string; invoke: (actual: FirebaseUtils) => Promise<unknown>; message: string; logged?: string }[] = [
  { name: 'deleteClientFromFirebase', invoke: actual => actual.deleteClientFromFirebase('synthetic-client'),
    message: 'deleteClientFromFirebase está deshabilitada en el frontend. Usa el backend /api/admin/clients para eliminar clientes.',
    logged: '❌ Intento de uso de deleteClientFromFirebase en frontend:' },
  { name: 'registerAdminUser', invoke: actual => actual.registerAdminUser({ name: 'Example', email: 'admin@example.test', password: 'synthetic-unused-password' }),
    message: 'registerAdminUser está deshabilitada en el frontend. Usa el backend /api/admin/users para gestionar administradores.',
    logged: '❌ Intento de uso de registerAdminUser en frontend:' },
  { name: 'fetchAdminUsers', invoke: actual => actual.fetchAdminUsers(),
    message: 'fetchAdminUsers está deshabilitada en el frontend. Usa el backend /api/admin/users para obtener la lista de administradores.' },
  { name: 'getAdminUserByEmail', invoke: actual => actual.getAdminUserByEmail('admin@example.test'),
    message: 'getAdminUserByEmail está deshabilitada en el frontend. Usa el backend /api/admin/users para resolver administradores por email.' },
  { name: 'signInAdmin', invoke: actual => actual.signInAdmin('admin@example.test', 'synthetic-unused-password'),
    message: 'signInAdmin está deshabilitada en el frontend. Usa el flujo de autenticación estándar de Firebase Auth y el backend /api/admin/users para login de administradores.' },
  { name: 'sendAdminPasswordReset', invoke: actual => actual.sendAdminPasswordReset('admin@example.test'),
    message: 'sendAdminPasswordReset está deshabilitada en el frontend. Usa el backend para enviar reseteos de contraseña de administradores.' },
];
test.each(disabledCases)('$name still rejects with its exact disabled message and zero SDK mutations', async value => {
  const actual = await import('../../src/firebaseUtils');
  const rejection = value.invoke(actual);
  await expect(rejection).rejects.toBeInstanceOf(Error);
  await expect(rejection).rejects.toHaveProperty('message', value.message);
  expect(console.error).toHaveBeenCalledTimes(value.logged ? 1 : 0);
  if (value.logged) expect(console.error).toHaveBeenCalledWith(value.logged, expect.any(Error));
  expectNoBusinessSdkCalls();
});

test.each([undefined, false, true])('registerAdminUser preserves getter reads when isSuperAdmin is %s', async isSuperAdmin => {
  const actual = await import('../../src/firebaseUtils');
  const reads: string[] = [];
  const input = {
    get name() { reads.push('name'); return 'Example'; },
    get email() { reads.push('email'); return 'admin@example.test'; },
    get password() { reads.push('password'); return 'synthetic-unused-password'; },
    get isSuperAdmin() { reads.push('isSuperAdmin'); return isSuperAdmin; },
  };
  await expect(actual.registerAdminUser(input)).rejects.toHaveProperty('message', disabledCases[1]?.message);
  expect(reads).toEqual(['name', 'email', 'password', 'isSuperAdmin']);
  expect(console.error).toHaveBeenCalledTimes(1);
  expectNoBusinessSdkCalls();
});

test('a throwing argument getter still rejects before the disabled admin body or later getter reads', async () => {
  const actual = await import('../../src/firebaseUtils');
  const reads: string[] = [];
  const failure = new Error('Synthetic email getter failure');
  const input = {
    get name() { reads.push('name'); return 'Example'; },
    get email(): string { reads.push('email'); throw failure; },
    get password() { reads.push('password'); return 'synthetic-unused-password'; },
    get isSuperAdmin() { reads.push('isSuperAdmin'); return undefined; },
  };
  await expect(actual.registerAdminUser(input)).rejects.toBe(failure);
  expect(reads).toEqual(['name', 'email']);
  expect(console.error).not.toHaveBeenCalled();
  expectNoBusinessSdkCalls();
});

// Two boundary validators are the only authorized runtime changes. Everything
// else, including both stock routines, auth guards and saved client IDs, must emit
// the same JavaScript after types and comments are erased.
function unchangedRuntime(text: string, corrected: boolean): string {
  const source = ts.createSourceFile('firebaseUtils.ts', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const changedFunctions = new Set(['fetchClientsFromFirebase', 'importProductFromCJ']);
  let skippedFunctions = 0, addedImports = 0;
  const statements = source.statements.filter(statement => {
    if (ts.isFunctionDeclaration(statement) && statement.name && changedFunctions.has(statement.name.text)) {
      skippedFunctions++; return false;
    }
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)
      && ['./domain/clientDocument', './domain/cjProduct'].includes(statement.moduleSpecifier.text)) {
      addedImports++; return false;
    }
    return true;
  });
  expect(skippedFunctions).toBe(2);
  expect(addedImports).toBe(corrected ? 2 : 0);
  const filtered = ts.factory.updateSourceFile(source, statements);
  const printed = ts.createPrinter({ removeComments: true }).printFile(filtered);
  return ts.transpileModule(printed, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext, removeComments: true,
  } }).outputText;
}

test('all runtime code outside the two validated data readers remains identical, including stock, auth guards and client IDs', () => {
  const oldText = readFileSync(path.resolve(process.cwd(), 'verification/firebase-utils-before-lint.ts.txt'), 'utf8');
  const newText = readFileSync(path.resolve(process.cwd(), 'src/firebaseUtils.ts'), 'utf8');
  expect(createHash('sha256').update(oldText).digest('hex')).toBe('b52d8302aaf950bb34a60a8932260b0613bfc448e0fbc53b1a7f1018751729a5');
  expect(unchangedRuntime(newText, true)).toBe(unchangedRuntime(oldText, false));
});
