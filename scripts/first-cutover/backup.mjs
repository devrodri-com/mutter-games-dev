import { mkdir, writeFile, readFile, lstat, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ROOT, PROJECT, COLLECTIONS, demand, canonical, digest, relativeDocument } from './common.mjs';

const fields = new Set(['nullValue', 'booleanValue', 'integerValue', 'doubleValue', 'timestampValue', 'stringValue',
  'bytesValue', 'referenceValue', 'geoPointValue', 'arrayValue', 'mapValue']);
export function validateValue(value) {
  demand(value && typeof value === 'object' && Object.keys(value).length === 1, 'invalid Firestore value');
  const type = Object.keys(value)[0];
  demand(fields.has(type), 'unknown Firestore value type');
  const data = value[type];
  if (type === 'mapValue') {
    demand(data && typeof data === 'object' && !Array.isArray(data), 'invalid map');
    for (const v of Object.values(data.fields ?? {})) validateValue(v);
  } else if (type === 'arrayValue') {
    demand(data && typeof data === 'object' && Array.isArray(data.values ?? []), 'invalid array');
    for (const v of data.values ?? []) validateValue(v);
  } else if (type === 'booleanValue') demand(typeof data === 'boolean', 'invalid boolean');
  else if (type === 'integerValue') demand(typeof data === 'string' && /^-?\d+$/.test(data), 'invalid integer');
  else if (type === 'doubleValue') demand(typeof data === 'number' || ['NaN', 'Infinity', '-Infinity'].includes(data), 'invalid double');
  else if (type === 'nullValue') demand(data === null || data === 'NULL_VALUE', 'invalid null');
  else if (type === 'geoPointValue') demand(Number.isFinite(data?.latitude) && Number.isFinite(data?.longitude), 'invalid geopoint');
  else demand(typeof data === 'string', 'invalid scalar');
}
export function validateDocuments(documents) {
  demand(Array.isArray(documents), 'missing documents');
  const paths = new Set();
  for (const doc of documents) {
    const path = relativeDocument(doc.name);
    demand(!paths.has(path), 'duplicate document'); paths.add(path);
    demand(Object.keys(doc).every(k => ['name', 'fields', 'createTime', 'updateTime'].includes(k)), 'unexpected document envelope');
    if (doc.fields !== undefined) {
      demand(typeof doc.updateTime === 'string' && typeof doc.createTime === 'string', 'missing source versions');
      for (const value of Object.values(doc.fields)) validateValue(value);
    } else demand(!doc.createTime && !doc.updateTime, 'invalid missing-parent record');
    // Fail the backup, never silently redact credentials into a purported full copy.
    demand(!/"(?:private_key|privateKey|access_token|accessToken|refreshToken|passwordHash|salt)"\s*:/i.test(canonical(doc.fields)), 'forbidden credential field');
  }
  return documents;
}

/** request receives only Firestore read methods, never arbitrary URLs. No SDK defaults. */
export async function capture(request, { transaction } = {}) {
  const documents = []; const pages = []; const collections = new Set();
  const scan = async collection => {
    demand(!collections.has(collection), 'duplicate collection traversal'); collections.add(collection);
    let pageToken; const tokens = new Set();
    do {
      const query = new URLSearchParams({ pageSize: '100', ...(transaction ? { transaction } : { showMissing: 'true' }) });
      if (pageToken) query.set('pageToken', pageToken);
      let page;
      if (transaction) {
        // The emulator's HTTP adapter cannot decode transaction bytes from a GET
        // query parameter. runQuery is the native transactional read API; paginate
        // by document identity within the same transaction, not by a local sample.
        const split = collection.lastIndexOf('/');
        const rows = await request('POST', `${collection.slice(0, split)}:runQuery`, {
          transaction, structuredQuery: { from: [{ collectionId: collection.slice(split + 1) }],
            orderBy: [{ field: { fieldPath: '__name__' }, direction: 'ASCENDING' }], limit: 100,
            ...(pageToken ? { startAt: { values: [{ referenceValue: pageToken }], before: false } } : {}),
          },
        });
        demand(Array.isArray(rows), 'invalid transactional query response');
        const docs = rows.flatMap(row => row.document ? [row.document] : []);
        page = { documents: docs, ...(docs.length === 100 ? { nextPageToken: docs.at(-1).name } : {}) };
      } else page = await request('GET', `${collection}?${query}`);
      demand(Array.isArray(page.documents ?? []), 'invalid list page');
      pages.push({ collection, documents: (page.documents ?? []).length, hasNext: Boolean(page.nextPageToken) });
      for (const doc of page.documents ?? []) {
        if (doc.fields === undefined && doc.updateTime && doc.createTime) doc.fields = {};
        relativeDocument(doc.name);
        demand(doc.name.startsWith(`${collection}/`) && doc.name.slice(collection.length + 1).split('/').length === 1, 'foreign list result');
        documents.push(doc);
        // Current source has one nested writer. Unknown subcollections must be
        // classified before receiving their contents, not silently omitted.
        if (!transaction) {
          let next; const seen = new Set();
          do {
            const sub = await request('POST', `${doc.name}:listCollectionIds`, { pageSize: 100, ...(next ? { pageToken: next } : {}) });
            demand(Array.isArray(sub.collectionIds ?? []), 'invalid subcollection response');
            for (const id of sub.collectionIds ?? []) {
              demand(collection === `${ROOT}/categories` && id === 'subcategories', 'unclassified subcollection; backup incomplete');
              await scan(`${doc.name}/${id}`);
            }
            next = sub.nextPageToken;
            demand(!next || typeof next === 'string' && !seen.has(next), 'subcollection pagination loop');
            if (next) seen.add(next);
          } while (next);
        } else if (collection === `${ROOT}/categories`) await scan(`${doc.name}/subcategories`);
      }
      pageToken = page.nextPageToken;
      demand(!pageToken || typeof pageToken === 'string' && !tokens.has(pageToken), 'document pagination loop');
      if (pageToken) tokens.add(pageToken);
    } while (pageToken);
  };
  for (const collection of COLLECTIONS) await scan(`${ROOT}/${collection}`);
  let control;
  if (transaction) {
    const rows = await request('POST', `${ROOT}:batchGet`, { documents: [`${ROOT}/operations/webStockCutover`], transaction });
    demand(Array.isArray(rows) && rows.length === 1 && (rows[0].found || rows[0].missing === `${ROOT}/operations/webStockCutover`), 'invalid control read');
    control = rows[0].found;
  } else control = await request('GET', `${ROOT}/operations/webStockCutover`, undefined, { allowMissing: true });
  if (control) documents.push(control);
  validateDocuments(documents);
  documents.sort((a, b) => a.name.localeCompare(b.name));
  return { documents, pages, collections: [...collections].sort() };
}
export const versions = documents => documents.map(d => [d.name, d.updateTime ?? null, digest(d.fields ?? null)]).sort((a, b) => a[0].localeCompare(b[0]));

export async function privateDirectory(directory, { create = false } = {}) {
  const root = '/Users/lolo/PrivateBackups/Mutter';
  const path = resolve(directory);
  demand(path.startsWith(`${root}/`) && path !== root, 'private destination required');
  await mkdir(root, { recursive: true, mode: 0o700 });
  demand(await realpath(root) === root && (await lstat(root)).mode % 512 === 0o700, 'private root mode or symlink');
  if (create) await mkdir(path, { recursive: false, mode: 0o700 });
  const stat = await lstat(path);
  demand(stat.isDirectory() && !stat.isSymbolicLink() && await realpath(path) === path && stat.mode % 512 === 0o700, 'unsafe private directory');
  return path;
}
export async function createBackup(request, directory) {
  const path = await privateDirectory(directory, { create: true });
  const manifest = { schema: 1, project: PROJECT, database: '(default)', scope: [...COLLECTIONS, 'operations/webStockCutover'],
    startedAt: new Date().toISOString(), atomic: false, complete: false, errors: [], documents: 0,
    personalDataPurpose: 'Order ownership and fulfillment fields retained privately for coherent loss recovery; no Auth export, clients or unrelated profiles.' };
  try {
    const first = await capture(request); const second = await capture(request);
    const bytes = canonical(first.documents);
    await writeFile(join(path, 'documents.json'), bytes, { mode: 0o600, flag: 'wx' });
    await writeFile(join(path, 'second-pass-versions.json'), canonical(versions(second.documents)), { mode: 0o600, flag: 'wx' });
    await writeFile(join(path, 'pages.json'), canonical([first.pages, second.pages]), { mode: 0o600, flag: 'wx' });
    Object.assign(manifest, { complete: true, documents: first.documents.length, pages: first.pages.length + second.pages.length,
      counts: Object.fromEntries(COLLECTIONS.map(c => [c, first.documents.filter(d => relativeDocument(d.name).split('/')[0] === c).length])),
      stableAcrossPasses: canonical(versions(first.documents)) === canonical(versions(second.documents)),
      documentsSha256: digest(bytes), secondPassSha256: digest(canonical(versions(second.documents))), pagesSha256: digest(canonical([first.pages, second.pages])) });
  } catch (error) {
    // Provider bodies and document paths never enter the public receipt.
    manifest.errors.push(error instanceof Error && /^BLOCKED:/.test(error.message) ? error.message : 'BACKUP_READ_FAILED');
  }
  manifest.finishedAt = new Date().toISOString();
  await writeFile(join(path, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600, flag: 'wx' });
  demand(manifest.complete, 'backup incomplete; private failure manifest retained');
  return manifest;
}
export async function loadBackup(directory) {
  const path = await privateDirectory(directory);
  for (const name of ['manifest.json', 'documents.json', 'second-pass-versions.json', 'pages.json']) {
    const s = await lstat(join(path, name));
    demand(s.isFile() && !s.isSymbolicLink() && s.mode % 512 === 0o600, 'private file mode or symlink');
  }
  const manifest = JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8'));
  demand(manifest.schema === 1 && manifest.project === PROJECT && manifest.database === '(default)' && manifest.complete === true
    && manifest.errors?.length === 0 && canonical(manifest.scope) === canonical([...COLLECTIONS, 'operations/webStockCutover']), 'invalid/incomplete backup manifest');
  for (const [name, key] of [['documents.json', 'documentsSha256'], ['second-pass-versions.json', 'secondPassSha256'], ['pages.json', 'pagesSha256']]) {
    demand(digest(await readFile(join(path, name))) === manifest[key], 'backup hash mismatch');
  }
  const documents = validateDocuments(JSON.parse(await readFile(join(path, 'documents.json'), 'utf8')));
  demand(documents.length === manifest.documents, 'backup count mismatch');
  return { manifest, documents };
}
