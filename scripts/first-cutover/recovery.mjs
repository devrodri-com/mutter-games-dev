import { ROOT, demand, canonical, digest, isHash, relativeDocument } from './common.mjs';
import { validateDocuments, capture } from './backup.mjs';
import { requireLocalAdapter } from './local-firestore.mjs';

export function compare(backup, current) {
  validateDocuments(backup); validateDocuments(current);
  const a = new Map(backup.map(d => [d.name, d])); const b = new Map(current.map(d => [d.name, d]));
  return [...new Set([...a.keys(), ...b.keys()])].sort().flatMap(name => {
    const before = a.get(name); const now = b.get(name);
    if (canonical(before) === canonical(now)) return [];
    return [{ path: relativeDocument(name), kind: !before ? 'NEW_PRESERVE' : !now ? 'ABSENT_AMBIGUOUS' :
      before.createTime !== now.createTime ? 'RECREATED_PRESERVE' : 'CHANGED_REQUIRES_EXPLANATION',
      before: before ? digest(before) : null, current: now ? digest(now) : null }];
  });
}
const held = d => {
  const value = d?.fields?.webReservations;
  if (!value) return false;
  demand(value.mapValue && typeof value.mapValue === 'object', 'unknown reservation encoding');
  return Object.keys(value.mapValue.fields ?? {}).length > 0;
};
const sorted = docs => [...docs].sort((a, b) => a.name.localeCompare(b.name));

/** A single-product loss case only; no inference of sales and no quantity arithmetic.
 * Evidence of illegitimacy is a separately reviewed incident, never updateTime alone.
 * All other recovery records must remain unchanged. This intentionally sacrifices
 * automatic repair availability when any new commerce exists.
 */
export function proposeRepair(backup, current, incident) {
  validateDocuments(backup); validateDocuments(current);
  demand(incident?.schema === 1 && incident.classification === 'ACCREDITED_LEGACY_LATE_WRITE'
    && incident.reviewedLoss === true && isHash(incident.evidenceSha256) && isHash(incident.authorizationSha256)
    && typeof incident.explanation === 'string' && incident.explanation.length >= 30, 'loss causality and explicit repair scope required');
  demand(typeof incident.path === 'string' && /^products\/[^/]+$/.test(incident.path), 'single product repair only');
  const name = `${ROOT}/${incident.path}`;
  const before = backup.find(d => d.name === name); const now = current.find(d => d.name === name);
  demand(before?.fields && incident.backupDocumentSha256 === digest(before)
    && incident.currentDocumentSha256 === (now ? digest(now) : null), 'incident content/version mismatch');
  demand(Number.isSafeInteger(incident.admittedAtMs) && Number.isSafeInteger(incident.barrierAtMs)
    && incident.admittedAtMs < incident.barrierAtMs, 'new admission is not accepted residual');
  demand(!now || now.createTime === before.createTime, 'recreated document is new work');
  demand(!held(before) && !held(now), 'active reservation forbids repair');
  const others = docs => sorted(docs.filter(d => d.name !== name));
  demand(canonical(others(backup)) === canonical(others(current)), 'dependent data changed; manual resolution required');
  // Category/variant relations and history are retained, not inferred from stock.
  for (const field of ['categoryId', 'subcategoryId']) {
    const id = before.fields[field]?.stringValue;
    if (id) demand(current.some(d => d.name === `${ROOT}/${field === 'categoryId' ? 'categories' : 'subcategories'}/${id}` && d.fields), 'missing catalog dependency');
  }
  demand(!now || canonical(before.fields) !== canonical(now.fields), 'no damaged content to repair');
  demand(now || incident.absenceCause === 'ACCREDITED_LOSS_NOT_LEGITIMATE_DELETE', 'absence alone never authorizes recreation');
  return { schema: 1, status: 'SELECTIVE_REPAIR_PROPOSAL_ONLY', path: incident.path,
    incident: structuredClone(incident), backupSha256: digest(sorted(backup)), currentSha256: digest(sorted(current)),
    currentDocument: now ? { updateTime: now.updateTime } : { exists: false },
    update: { name, fields: structuredClone(before.fields) }, productionAuthorized: false };
}

/** Re-evaluate every dependency inside the same Firestore transaction as repair.
 * adapter can only be the loopback-only transport; there is no production switch.
 */
export async function rehearseRepair(adapter, backup, comparedCurrent, proposal, beforeCommit = async () => {}) {
  requireLocalAdapter(adapter);
  const { transaction } = await adapter.request('POST', `${ROOT}:beginTransaction`, { options: { readWrite: {} } });
  demand(typeof transaction === 'string' && transaction, 'transaction not obtained');
  try {
    const current = await capture(adapter.request, { transaction });
    demand(digest(sorted(comparedCurrent)) === proposal.currentSha256 && digest(sorted(current.documents)) === proposal.currentSha256,
      'concurrent change after comparison');
    const expected = proposeRepair(backup, current.documents, proposal.incident);
    demand(canonical(proposal) === canonical(expected), 'repair proposal was changed');
    await beforeCommit();
    await adapter.request('POST', `${ROOT}:commit`, { transaction, writes: [{ update: proposal.update, currentDocument: proposal.currentDocument }] });
    return { status: 'LOCAL_SELECTIVE_REPAIR_VERIFIED', documentsWritten: 1, productionWrites: 0 };
  } catch (error) {
    try { await adapter.request('POST', `${ROOT}:rollback`, { transaction }); }
    catch { throw new AggregateError([error], 'Local repair failed; rollback response unavailable'); }
    throw error;
  }
}
