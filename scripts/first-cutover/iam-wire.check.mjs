import test from 'node:test';
import assert from 'node:assert/strict';
import { readPolicy, policyView, validateWirePolicy, sortedBindings, accountResource, PROJECT_RESOURCE } from './iam-evidence.mjs';
import { legacyAllowProposal, verifyAllowBase, verifyAllowAfter } from './authority.mjs';
import { syntheticEvidence } from './fixtures.mjs';
import { syntheticContainment, policyRead, editSource, bindContainment } from './containment-fixtures.mjs';
import { evaluateFirstCutover } from './policy.mjs';
import { digest, LEGACY_ACCOUNTS } from './common.mjs';
const options = { requestedPolicyVersion: 3, responseComplete: true };
const context = e => ({ synthetic: true, revision: e.revision, window: e.window, nowMs: e.nowMs, maxAgeMs: e.maxAgeMs });
// Sanitized synthetic examples of the OMITTED FIELD SHAPE observed in two private
// Google captures. These are not literal captures, operational receipts or Google
// guarantees. The delivery's private base/HEAD harness checks the untouched bytes.
const examples = [
  { resource: accountResource('wire-a@example.invalid'), raw: '{\n  "etag": "synthetic-a"\n}\n' },
  { resource: accountResource('wire-b@example.invalid'), raw: '{\n  "etag": "synthetic-b"\n}\n' },
];
for (const example of examples) test(`omitted wire shape at ${example.resource}: source and etag preserved`, () => {
  const e = syntheticEvidence(), s = policyRead(e, example.resource, {}, 100031);
  s.responseRaw = example.raw; s.responseSha256 = digest(example.raw);
  const original = structuredClone(s), wire = readPolicy(s, example.resource, context(e)), view = policyView(wire, options);
  assert.deepEqual(view.bindings, []); assert.equal(view.etag, JSON.parse(example.raw).etag);
  assert.equal(Object.hasOwn(wire, 'bindings'), false); assert.equal(Object.hasOwn(wire, 'version'), false);
  assert.equal(Object.hasOwn(view, 'version'), false); assert.deepEqual(s, original);
  view.bindings.push({ role: 'roles/viewer', members: ['user:synthetic@example.invalid'] });
  assert.deepEqual(wire, JSON.parse(example.raw));
  assert.throws(() => readPolicy(s, examples.find(x => x !== example).resource, context(e)), /resource/);
});
for (const version of [undefined, 0, 1, 3]) for (const present of [false, true]) test(`empty version ${version}, bindings present ${present}`, () => {
  const wire = { etag: 'opaque-not-special', ...(version === undefined ? {} : { version }), ...(present ? { bindings: [] } : {}) };
  const copy = structuredClone(wire);
  assert.deepEqual(policyView(wire, options).bindings, []); assert.equal(validateWirePolicy(wire, options), wire);
  assert.deepEqual(wire, copy);
  if (version !== 3 || !present) assert.throws(() => policyView(wire), /complete v3 request/);
});
test('nonempty wire 0/omitted and conditional v3 preserve every field', () => {
  const fields = { etag: 'opaque', bindings: [{ role: 'roles/viewer', members: ['user:synthetic@example.invalid'], unknownBinding: 'kept' }],
    auditConfigs: [{ service: 'allServices', auditLogConfigs: [{ logType: 'DATA_READ' }] }], futureField: { preserved: true } };
  for (const version of [undefined, 0, 1, 3]) {
    const wire = structuredClone(fields); if (version !== undefined) wire.version = version;
    if (version === 3) wire.bindings[0].condition = { expression: 'request.time < timestamp("2099-01-01T00:00:00Z")', title: 'synthetic' };
    assert.deepEqual(policyView(wire, options), wire);
    const changed = structuredClone(wire); changed.futureField.preserved = false;
    assert.notDeepEqual(sortedBindings(wire, options), sortedBindings(changed, options));
  }
});
const invalid = {
  nullPolicy: null, arrayPolicy: [], missingEtag: {}, emptyEtag: { etag: '' }, whitespaceEtag: { etag: ' ' },
  nullBindings: { etag: 'x', bindings: null }, objectBindings: { etag: 'x', bindings: {} }, stringBindings: { etag: 'x', bindings: '[]' },
  nullVersion: { etag: 'x', version: null }, unknownVersion: { etag: 'x', version: 2 }, stringVersion: { etag: 'x', version: '3' },
  nullBinding: { etag: 'x', bindings: [null] }, emptyMembers: { etag: 'x', bindings: [{ role: 'roles/viewer', members: [] }] },
  nullAuditConfigs: { etag: 'x', auditConfigs: null },
};
for (const [name, wire] of Object.entries(invalid)) test(`reject malformed wire ${name}`, () => assert.throws(() => policyView(wire, options), /BLOCKED/));
for (const condition of [null, false, '', [], {}, { expression: '' }]) test(`reject invalid explicit condition ${JSON.stringify(condition)}`, () => {
  assert.throws(() => policyView({ version: 3, etag: 'x', bindings: [{ role: 'roles/viewer', members: ['user:synthetic@example.invalid'], condition }] }, options), /condition/);
});
for (const version of [undefined, 0, 1]) test(`reject condition with version ${version}`, () => {
  const p = { etag: 'x', bindings: [{ role: 'roles/viewer', members: ['user:synthetic@example.invalid'], condition: { expression: 'true' } }] };
  if (version !== undefined) p.version = version;
  assert.throws(() => policyView(p, options), /condition/);
});
const invalidSource = {
  wrongMethod: s => editSource(s, 'request', r => { r.method = 'setIamPolicy'; }),
  wrongResource: s => editSource(s, 'request', r => { r.resource = PROJECT_RESOURCE; }),
  missingV3: s => editSource(s, 'request', r => { delete r.query['options.requestedPolicyVersion']; }),
  wrongScope: s => { s.windowSha256 = '0'.repeat(64); },
  wrongPrincipal: s => { s.channel.principal = 'other@example.invalid'; },
  wrongOrigin: s => { s.origin = 'GOOGLE_OFFICIAL_CAPTURE'; },
  projected: s => { s.projection = 'FIELDS'; },
  incomplete: s => { s.responseComplete = false; },
  emptyFieldProjection: s => editSource(s, 'request', r => { r.query.fields = ''; }),
  readMask: s => editSource(s, 'request', r => { r.body.readMask = 'etag'; }),
  nullBody: s => editSource(s, 'request', r => { r.body = null; }),
  stale: s => { s.observedAtMs = -1; },
  opaqueCondition: s => editSource(s, 'response', r => { r.bindings = [{ role: 'roles/viewer_withcond_deadbeef', members: ['user:synthetic@example.invalid'] }]; }),
};
for (const status of [403, 404, 500, null]) invalidSource[`http${status}`] = s => { s.httpStatus = status; };
for (const raw of ['', '{', '{"etag":"x"', 'null', '[]', '{"error":{"code":403},"etag":"x"}']) invalidSource[`body${raw}`] = s => { s.responseRaw = raw; s.responseSha256 = digest(raw); };
for (const [name, change] of Object.entries(invalidSource)) test(`failed/incomplete source is never empty: ${name}`, () => {
  const e = syntheticEvidence(), r = examples[0].resource, s = policyRead(e, r, { etag: 'x' }, 100031); change(s);
  assert.throws(() => readPolicy(s, r, context(e)));
});
function emptyDirectPolicies(method) {
  const e = syntheticContainment(syntheticEvidence(), method), c = e.containment;
  // Rebind synthetic review references to the synthetic sources actually used.
  // This does not simulate a real review of historical Google responses.
  for (const s of [...c.resourcePolicies, c.candidate.restrictedPolicy]) {
    const previous = digest(s); editSource(s, 'response', p => { delete p.bindings; delete p.version; });
    const next = digest(s);
    const replace = v => { if (Array.isArray(v)) return v.map(replace); if (v && typeof v === 'object') { for (const k of Object.keys(v)) v[k] = replace(v[k]); return v; } return v === previous ? next : v; };
    replace(c.review); replace(c.credentials);
  }
  return bindContainment(e);
}
for (const method of ['ALLOW_ABSENCE_V1', 'PROJECT_DENY']) {
  test(`${method}: empty legacy and candidate -> exact synthetic candidate grant, no remote claim`, () => {
    const e = emptyDirectPolicies(method), result = evaluateFirstCutover(e);
    assert.equal(result.containment.method, method); assert.equal(result.remoteEnforcementAttestedByThisTool, false);
    assert.equal(result.applicationAuthorizedByThisTool, false);
  });
  test(`${method}: empty direct policies cannot conceal inherited authority`, () => {
    const e = emptyDirectPolicies(method);
    editSource(e.containment.allow.readback, 'response', p => { p.bindings.push({ role: 'roles/editor', members: [`serviceAccount:${LEGACY_ACCOUNTS[0]}`] }); });
    assert.throws(() => evaluateFirstCutover(e), /after drift/);
  });
  test(`${method}: empty project is not a substitute for the reviewed allow base`, () => {
    const e = emptyDirectPolicies(method); editSource(e.containment.allow.before, 'response', p => { delete p.bindings; });
    assert.throws(() => evaluateFirstCutover(e), /both legacy principals/);
  });
  test(`${method}: empty direct policy still requires complete credential/delegation review`, () => {
    const e = emptyDirectPolicies(method); e.containment.credentials.unresolved = 1;
    assert.throws(() => evaluateFirstCutover(e), /credential treatment/);
  });
}
test('etag drift and unrelated policy delta still fail after wire compatibility', () => {
  const e = syntheticEvidence(), before = JSON.parse(e.containment.allow.before.responseRaw), proposal = legacyAllowProposal(before, options);
  assert.throws(() => verifyAllowBase(proposal, { ...before, etag: 'different' }, options), /drift/);
  const after = { ...proposal.after, etag: 'changed', newUnreviewedField: true };
  assert.throws(() => verifyAllowAfter(proposal, before, after, options), /after drift/);
});
// Explicitly synthetic envelopes labelled as provider data ONLY inside this
// parser unit test. They do not become receipts or establish real provenance.
for (const resource of [examples[0].resource, PROJECT_RESOURCE]) test(`native transport at ${resource} agrees with logical capture`, () => {
  const e = syntheticEvidence(), s = policyRead(e, resource, { etag: 'synthetic-native' }, 100031);
  s.origin = 'GOOGLE_OFFICIAL_CAPTURE';
  const request = JSON.parse(s.requestRaw), account = resource.includes('/serviceAccounts/');
  s.transport = { httpMethod: 'POST', url: account ? `https://iam.googleapis.com/v1/${resource}:getIamPolicy?options.requestedPolicyVersion=3`
    : `https://cloudresourcemanager.googleapis.com/v1/${resource}:getIamPolicy`, requestBodyRaw: account ? '' : JSON.stringify(request.body) };
  const c = { ...context(e), synthetic: false };
  assert.deepEqual(readPolicy(s, resource, c), { etag: 'synthetic-native' });
  for (const change of [x => { delete x.transport; }, x => { x.transport.httpMethod = 'GET'; },
    x => { x.transport.url = x.transport.url.replace('.googleapis.com', '.example.invalid'); },
    x => { x.transport.url += '&fields=etag'; }, x => { x.transport.requestBodyRaw = '{"fields":"etag"}'; }]) {
    const bad = structuredClone(s); change(bad); assert.throws(() => readPolicy(bad, resource, c));
  }
});
