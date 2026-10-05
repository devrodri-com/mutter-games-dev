// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from 'vitest';
import { admitsSession } from '../../api/_lib/session-authority';

test('independently deployed consumers carry the same session policy', () => {
  const source = process.env.MUTTER_ADMIN_API_SOURCE;
  if (!source) throw Error('Exact paired Admin checkout required');
  expect(readFileSync(resolve(source, 'api/_lib/session-authority.ts'), 'utf8'))
    .toBe(readFileSync('api/_lib/session-authority.ts', 'utf8'));
});
test('provider shape and values fail closed; anonymous is a buyer, never an administrator', () => {
  for (const claims of [null, [], {}, { firebase: null }, { firebase: [] }, { firebase: {} },
    ...[true, 1, ['password'], {}, 'custom', 'google.com', ''].map(sign_in_provider => ({ firebase: { sign_in_provider } }))]) {
    expect(admitsSession(claims, 'buyer')).toBe(false);
    expect(admitsSession(claims, 'admin')).toBe(false);
  }
  expect(admitsSession({ firebase: { sign_in_provider: 'password' } }, 'admin')).toBe(true);
  expect(admitsSession({ firebase: { sign_in_provider: 'anonymous' } }, 'buyer')).toBe(true);
  expect(admitsSession({ admin: true, firebase: { sign_in_provider: 'anonymous' } }, 'admin')).toBe(false);
});
test('publication configuration selects the cutover Rules actually exercised by the suite', () => {
  expect(JSON.parse(readFileSync('firebase.stock-release.json', 'utf8')))
    .toEqual({ firestore: { rules: 'firebase.catalog-cutover.rules' } });
});
