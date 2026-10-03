import { ROOT, DATABASE, demand, canonical } from './common.mjs';
import { validateDocuments, capture } from './backup.mjs';

export const LOCAL_PROJECT = 'demo-mutter-first-cutover';
const localDb = `projects/${LOCAL_PROJECT}/databases/(default)`;
const localAdapters = new WeakSet();
export function requireLocalAdapter(adapter) {
  demand(localAdapters.has(adapter), 'only the sealed loopback adapter may restore or rehearse');
}
// Protobuf JSON omits empty map/array members and may spell the null enum either
// way. Normalize only those encodings, preserving integer precision and types.
export function fieldSemantics(fields) {
  const valueSemantics = value => {
    if ('mapValue' in value) return { mapValue: { fields: fieldSemantics(value.mapValue.fields ?? {}) } };
    if ('arrayValue' in value) return { arrayValue: { values: (value.arrayValue.values ?? []).map(valueSemantics) } };
    if ('nullValue' in value) return { nullValue: null };
    if ('timestampValue' in value) return { timestampValue: value.timestampValue.replace(/\.([0-9]*?)0+Z$/, (_, fraction) => fraction ? `.${fraction}Z` : 'Z') };
    return value;
  };
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, valueSemantics(v)]));
}
export function translate(value, from, to) {
  if (Array.isArray(value)) return value.map(v => translate(v, from, to));
  if (!value || typeof value !== 'object') return value;
  const resource = v => typeof v === 'string' && v.startsWith(`${from}/`) ? to + v.slice(from.length) : v;
  return Object.fromEntries(Object.entries(value).map(([key, v]) => [key,
    ['name', 'referenceValue', 'delete', 'missing'].includes(key) && typeof v === 'string' ? resource(v)
      : key === 'documents' && Array.isArray(v) && v.every(item => typeof item === 'string') ? v.map(resource) : translate(v, from, to)]));
}
/** The only write adapter is hard-bound to loopback and a demo database. */
export function localFirestore(origin) {
  demand(/^http:\/\/127\.0\.0\.1:[1-9]\d{3,4}$/.test(origin) && Number(new URL(origin).port) <= 65535, 'loopback emulator required');
  demand(!Object.keys(process.env).some(k => /^(GOOGLE_APPLICATION_CREDENTIALS|FIREBASE_PRIVATE_KEY|MP_ACCESS_TOKEN|IMAGEKIT_PRIVATE_KEY)$/.test(k)), 'credential-free local restore required');
  const request = async (method, path, body, { allowMissing = false } = {}) => {
    demand(path.startsWith(DATABASE), 'unexpected database');
    const localPath = localDb + path.slice(DATABASE.length);
    // Emulator's documented owner sentinel, not a credential. Never sent off loopback.
    const response = await fetch(`${origin}/v1/${localPath}`, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' }, redirect: 'error',
      signal: AbortSignal.timeout(30000), ...(body ? { body: JSON.stringify(translate(body, DATABASE, localDb)) } : {}) });
    if (response.status === 404 && allowMissing) return null;
    demand(response.ok, `local Firestore HTTP ${response.status}`);
    return translate(await response.json(), localDb, DATABASE);
  };
  const adapter = Object.freeze({ request, origin, project: LOCAL_PROJECT });
  localAdapters.add(adapter);
  return adapter;
}
export async function restoreLocal(adapter, documents) {
  requireLocalAdapter(adapter);
  validateDocuments(documents);
  const existing = await capture(adapter.request);
  demand(existing.documents.length === 0, 'restore requires an empty isolated database');
  // This is structural verification only. No production adapter/restore command exists.
  const persisted = documents.filter(d => d.fields !== undefined);
  for (let i = 0; i < persisted.length; i += 100) {
    await adapter.request('POST', `${ROOT}:commit`, { writes: persisted.slice(i, i + 100).map(d => ({
      update: { name: d.name, fields: d.fields }, currentDocument: { exists: false },
    })) });
  }
  for (const d of documents) {
    const read = await adapter.request('GET', d.name, undefined, { allowMissing: true });
    demand(d.fields === undefined ? read === null : read && canonical(fieldSemantics(read.fields ?? {})) === canonical(fieldSemantics(d.fields)), 'local fields/types/reference mismatch');
  }
  return { status: 'LOCAL_STRUCTURAL_RECOVERY_VERIFIED', documents: persisted.length,
    missingParents: documents.length - persisted.length, project: LOCAL_PROJECT,
    sourceVersionsRetainedInBackup: true, emulatorAssignsNewVersions: true, productionWrites: 0 };
}
