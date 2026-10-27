import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import assert from 'node:assert/strict';
assert.equal(process.env.GCLOUD_PROJECT, 'demo-mutter-edit');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8487');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:9397');
const packagePath = resolve(dirname(fileURLToPath(import.meta.url)), process.env.MUTTER_TEST_PREVIOUS_EMITTED === '1'
  ? '../../../../payment-confirmation/package/.vercel/output/functions/api/access.func/package.json'
  : '../../../package/.vercel/output/functions/api/access.func/package.json');
const require = createRequire(packagePath);
// Only the initializer points the emitted, unchanged Firebase consumers at the
// isolated emulators. The runtime, decoder, handler and authorization stay real.
require('firebase-admin/app').initializeApp({ projectId: 'demo-mutter-edit' }, 'catalog-checkout');
