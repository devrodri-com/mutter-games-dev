import { createHash } from 'node:crypto';

export const PROJECT = 'mutter-games';
export const DATABASE = `projects/${PROJECT}/databases/(default)`;
export const ROOT = `${DATABASE}/documents`;
export const DECISION = 'MUTTER_FIRST_CUTOVER_RISK_MANAGED_PREPARATION';
export const DECISION_CONTRACT_SHA256 = 'c9806fb28998d1103d878bbbab81168ad573d52066ca05f8b3ca4aad112aa322';
export const PLANNED_ACCOUNT = 'mutter-stock-runtime-v1@mutter-games.iam.gserviceaccount.com';
export const LEGACY_ACCOUNTS = Object.freeze([
  'firebase-adminsdk-fbsvc@mutter-games.iam.gserviceaccount.com',
  'mutter-games@appspot.gserviceaccount.com',
]);
// Coupled to checkout-service/payment-transitions/web-admission/web-stock-sweep and
// Admin catalog consumers. Auth users, clients, carts and credentials are excluded.
export const COLLECTIONS = Object.freeze(['products', 'categories', 'subcategories', 'orders',
  'checkoutIntents', 'webCheckoutLocks', 'webReservationOwners', 'inventoryMovements', 'payments',
  'webAdmissionClaims', 'webAdmissionBuckets', 'webStockMaintenance']);
export function demand(condition, message) {
  if (!condition) throw new Error(`BLOCKED: ${message}`);
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value)).digest('hex');
export const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function relativeDocument(name) {
  demand(typeof name === 'string' && name.startsWith(`${ROOT}/`), 'foreign document identity');
  const path = name.slice(ROOT.length + 1);
  const segments = path.split('/');
  demand(segments.length % 2 === 0 && segments.every(s => s && s !== '.' && s !== '..' && !/[?#\\]/.test(s)), 'invalid document path');
  demand(COLLECTIONS.includes(segments[0]) || path === 'operations/webStockCutover', 'out-of-scope document');
  return path;
}
