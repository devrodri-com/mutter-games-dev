// @vitest-environment node
import { createHash } from 'node:crypto';
import { getApps } from 'firebase-admin/app';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import checkoutHandler from '../../api/create-mp-preference';
import reconcileHandler from '../../api/internal/web-stock-reconcile';
import { releaseAuthorized, type ReleaseAttestation, type ReleaseHandler } from '../../api/_lib/release-attestation';
import { parseReleaseBuildIdentity } from '../../api/_lib/release-build-identity';
import { verifyReleaseAttestation, type AttestationExpectation } from '../../api/_lib/release-attestation-verifier';

const secret = 'synthetic_release_attestation_secret_123456';
const businessCanary = 'SYNTHETIC_BUSINESS_VALUE_NEVER_RETURNED';
const stampFields = {
    schemaVersion: 1, head: 'a'.repeat(40), tree: 'b'.repeat(40), packageLockSha256: 'c'.repeat(64),
    functionsLockSha256: 'd'.repeat(64), builder: '@vercel/node@5.10.2', buildNode: 'v22.23.3',
};
const stamp = { ...stampFields, buildId: createHash('sha256').update(JSON.stringify(stampFields)).digest('hex') };
const expectation: AttestationExpectation = {
    handler: 'checkout', deploymentId: 'dpl_Synthetic123', deploymentUrl: 'synthetic-candidate.vercel.app',
    head: stamp.head, tree: stamp.tree, buildId: stamp.buildId, node: 'v22.23.3', nativeUndici: '6.28.1',
};
function responseRecorder() {
    const state: { code: number; body: unknown; headers: Record<string, string> } = { code: 0, body: undefined, headers: {} };
    const response = {
        setHeader(name: string, value: string) { state.headers[name.toLowerCase()] = value; },
        status(code: number) { state.code = code; return response; },
        json(body: unknown) { state.body = body; return body; },
    };
    return { state, response };
}
async function invoke(handler: ReleaseHandler, authorization: string | string[] | undefined = `Bearer ${secret}`,
    action: string | string[] | undefined = 'runtime-attestation', method = handler === 'checkout' ? 'POST' : 'GET') {
    const { state, response } = responseRecorder();
    const request = { method, headers: { authorization, 'x-mutter-release-action': action }, body: { action: 'start', items: [] } };
    await (handler === 'checkout' ? checkoutHandler : reconcileHandler)(request, response);
    return state;
}
function receipt(value: unknown): ReleaseAttestation {
    // Runtime schema verification remains in the pure verifier. This assertion
    // is a test narrowing after checking the observable endpoint fields.
    expect(value).toMatchObject({ schemaVersion: 1, handler: expect.stringMatching(/^(checkout|reconcile)$/),
        node: expect.any(String), deployment: expect.any(Object), coldStartId: expect.any(String), invocationId: expect.any(String) });
    return value as ReleaseAttestation;
}

beforeEach(() => {
    vi.stubEnv('RELEASE_ATTESTATION_SECRET', secret);
    vi.stubEnv('MP_ACCESS_TOKEN', businessCanary);
    vi.stubEnv('FIREBASE_PRIVATE_KEY', businessCanary);
    vi.stubEnv('CRON_SECRET', businessCanary);
    vi.stubEnv('VERCEL_DEPLOYMENT_ID', expectation.deploymentId);
    vi.stubEnv('VERCEL_URL', expectation.deploymentUrl);
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', expectation.head);
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('VERCEL_REGION', 'iad1');
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Attestation must not make network requests'); }));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

test.each(['checkout', 'reconcile'] as const)('%s rejects missing, malformed and incorrect bearer credentials before Firebase/network', async handler => {
    const before = getApps().map(app => app.name);
    for (const authorization of ['', 'Bearer undefined', 'Bearer short', `bearer ${secret}`,
        `Bearer ${'x'.repeat(32)}`, `Bearer ${secret} `, [`Bearer ${secret}`]]) {
        const state = await invoke(handler, authorization);
        expect(state).toMatchObject({ code: 401, body: { error: 'Unauthorized' }, headers: { 'cache-control': 'no-store' } });
    }
    const { state, response } = responseRecorder();
    await (handler === 'checkout' ? checkoutHandler : reconcileHandler)({ method: handler === 'checkout' ? 'POST' : 'GET',
        headers: { 'x-mutter-release-action': 'runtime-attestation' }, body: undefined }, response);
    expect(state.code).toBe(401);
    expect(getApps().map(app => app.name)).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
});

test.each(['checkout', 'reconcile'] as const)('%s rejects unconfigured/invalid dedicated secrets even with a matching bearer', async handler => {
    const before = getApps().map(app => app.name);
    for (const value of ['', 'short', ' '.repeat(32), 'a'.repeat(31), 'a'.repeat(257), `${'a'.repeat(32)}\n`, 'é'.repeat(32)]) {
        vi.stubEnv('RELEASE_ATTESTATION_SECRET', value);
        expect((await invoke(handler, `Bearer ${value}`)).code).toBe(401);
    }
    delete process.env.RELEASE_ATTESTATION_SECRET;
    expect((await invoke(handler)).code).toBe(401);
    expect(getApps().map(app => app.name)).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
});

test.each(['checkout', 'reconcile'] as const)('%s reserves invalid action and method without falling through to business', async handler => {
    const before = getApps().map(app => app.name);
    expect(await invoke(handler, `Bearer ${secret}`, 'unknown')).toMatchObject({ code: 400, body: { error: 'Invalid release action' } });
    expect((await invoke(handler, `Bearer ${secret}`, ['runtime-attestation'])).code).toBe(400);
    expect(await invoke(handler, `Bearer ${secret}`, 'runtime-attestation', 'PUT')).toMatchObject({ code: 405,
        headers: { allow: handler === 'checkout' ? 'POST' : 'GET', 'cache-control': 'no-store' } });
    expect(getApps().map(app => app.name)).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
});

test.each(['checkout', 'reconcile'] as const)('%s returns only raw local runtime and public identity; no Firebase/business initialization', async handler => {
    const before = getApps().map(app => app.name);
    const state = await invoke(handler);
    expect(state.code).toBe(200);
    const body = receipt(state.body);
    expect(Object.keys(body).sort()).toEqual(['buildIdentity', 'coldStartId', 'deployment', 'handler', 'invocationId', 'nativeUndici', 'node', 'schemaVersion']);
    expect(body).toMatchObject({ handler, node: process.version, nativeUndici: process.versions.undici ?? null,
        deployment: { id: expectation.deploymentId, url: expectation.deploymentUrl, commit: expectation.head,
            environment: 'preview', region: 'iad1', runtime: 'node' }, buildIdentity: null });
    expect(process.version).toBe('v22.23.3');
    expect(process.versions.undici).toBe('6.28.1');
    expect(state.headers['cache-control']).toBe('no-store');
    const observed = JSON.stringify({ state, logs: vi.mocked(console.info).mock.calls });
    for (const forbidden of [secret, businessCanary, 'RELEASE_ATTESTATION_SECRET', 'MP_ACCESS_TOKEN', 'FIREBASE_PRIVATE_KEY', process.cwd()])
        expect(observed).not.toContain(forbidden);
    expect(getApps().map(app => app.name)).toEqual(before);
    expect(fetch).not.toHaveBeenCalled();
    expect(verifyReleaseAttestation(body, { ...expectation, handler }).status).toBe('NOT_VERIFIED');
});

test('retries correlate to one cold start, use distinct invocation IDs and safe structured logs', async () => {
    const first = receipt((await invoke('checkout')).body);
    const second = receipt((await invoke('checkout')).body);
    expect(second.coldStartId).toBe(first.coldStartId);
    expect(second.invocationId).not.toBe(first.invocationId);
    expect(vi.mocked(console.info).mock.calls.map(call => JSON.parse(String(call[0])))).toEqual([first, second].map(row => ({
        event: 'release-runtime-attestation', handler: 'checkout', coldStartId: row.coldStartId, invocationId: row.invocationId,
    })));
});

test('cold module start gets a distinct cold-start identity', async () => {
    const first = receipt((await invoke('checkout')).body);
    vi.resetModules();
    const { handleReleaseAttestation } = await import('../../api/_lib/release-attestation');
    const { state, response } = responseRecorder();
    expect(handleReleaseAttestation({ method: 'POST', headers: { authorization: `Bearer ${secret}`, 'x-mutter-release-action': 'runtime-attestation' } }, response, 'checkout')).toBe(true);
    expect(receipt(state.body).coldStartId).not.toBe(first.coldStartId);
});

test('missing native Undici is returned as null and never inferred from an npm dependency', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(process.versions, 'undici');
    if (!descriptor) throw new Error('Native Undici descriptor expected in the authorized Node build');
    Object.defineProperty(process.versions, 'undici', { ...descriptor, value: undefined });
    try {
        const body = receipt((await invoke('checkout')).body);
        expect(body.nativeUndici).toBeNull();
        expect(verifyReleaseAttestation({ ...body, buildIdentity: stamp }, expectation)).toMatchObject({
            status: 'NOT_VERIFIED', reasons: expect.arrayContaining(['NATIVE_UNDICI_NOT_VERIFIED']),
        });
    } finally {
        Object.defineProperty(process.versions, 'undici', descriptor);
    }
});

test('build identity is canonical, rejects an unstamped source, a tampered hash and unexpected fields', () => {
    expect(parseReleaseBuildIdentity(stamp)).toEqual(stamp);
    expect(parseReleaseBuildIdentity({ schemaVersion: 1, status: 'UNSTAMPED' })).toBeNull();
    expect(parseReleaseBuildIdentity({ ...stamp, head: 'e'.repeat(40) })).toBeNull();
    expect(parseReleaseBuildIdentity({ ...stamp, private: businessCanary })).toBeNull();
});

test('receipt verifier requires independently supplied exact deployment/build/runtime, not a self-reported PASS', async () => {
    const body = { ...receipt((await invoke('checkout')).body), buildIdentity: stamp };
    expect(verifyReleaseAttestation(body, expectation)).toEqual({ status: 'VERIFIED', reasons: [] });
    for (const changed of [
        { ...body, nativeUndici: null }, { ...body, nativeUndici: undefined }, { ...body, nativeUndici: '6.27.0' },
        { ...body, node: 'v22.0.0' }, { ...body, handler: 'reconcile' },
        { ...body, deployment: { ...body.deployment, id: null } },
        { ...body, deployment: { ...body.deployment, url: 'other.vercel.app' } },
        { ...body, deployment: { ...body.deployment, commit: 'e'.repeat(40) } },
        { ...body, buildIdentity: null }, { ...body, buildIdentity: { ...stamp, tree: 'e'.repeat(40) } },
        { ...body, invocationId: null }, { ...body, status: 'PASS' },
    ]) expect(verifyReleaseAttestation(changed, expectation).status).toBe('NOT_VERIFIED');
    // Prebuilt commit identity comes from its frozen build stamp even when Git
    // integration metadata is absent; exact deployment id+URL remain required.
    expect(verifyReleaseAttestation({ ...body, deployment: { ...body.deployment, commit: null } }, expectation).status).toBe('VERIFIED');
    expect(verifyReleaseAttestation({ ...body, node: 'v22.0.0' }, { ...expectation, node: 'v22.0.0' }).status).toBe('NOT_VERIFIED');
    expect(verifyReleaseAttestation({ ...body, nativeUndici: '6.27.0' }, { ...expectation, nativeUndici: '6.27.0' }).status).toBe('NOT_VERIFIED');
});

test('dedicated bearer cannot be substituted by cron/MP credentials', () => {
    expect(releaseAuthorized(`Bearer ${businessCanary}`, secret)).toBe(false);
    expect(releaseAuthorized(`Bearer ${secret}`, secret)).toBe(true);
});
