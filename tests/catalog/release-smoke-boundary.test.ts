// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { handleReleaseSmoke } from '../../api/_lib/release-smoke';

const secret = 'synthetic_read_smoke_secret_1234567890';
const purchase = { items: [{ id: 'p', quantity: 1 }], shipping: { pickup: true, department: '', name: 'Synthetic',
    address: '', city: '', postalCode: '', phone: '123', email: 'test@example.invalid' } };
function recorder() {
    const state: { status: number; body: unknown; headers: Record<string, string> } = { status: 0, body: null, headers: {} };
    const response = {
        setHeader(key: string, value: string) { state.headers[key.toLowerCase()] = value; },
        status(code: number) { state.status = code; return response; },
        json(body: unknown) { state.body = body; },
    };
    return { state, response };
}
beforeEach(() => {
    vi.stubEnv('RELEASE_ATTESTATION_SECRET', secret);
    vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Rejected smoke made a network request'); }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test.each(['GET', 'PUT', 'OPTIONS'])('read-smoke %s rejects before database initialization', async method => {
    const database = vi.fn(() => { throw new Error('Database must not initialize'); });
    const { state, response } = recorder();
    expect(await handleReleaseSmoke({ method, headers: { 'x-mutter-release-action': 'read-smoke', authorization: `Bearer ${secret}` },
        body: { action: 'catalog' } }, response, database)).toBe(true);
    expect(state).toMatchObject({ status: 405, body: { error: 'Method not allowed' }, headers: { allow: 'POST', 'cache-control': 'no-store' } });
    expect(database).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});

test.each([undefined, '', 'Bearer short', 'Bearer incorrect_secret_1234567890123456', [`Bearer ${secret}`]])(
    'read-smoke bearer %j rejects before database initialization', async authorization => {
        const database = vi.fn(() => { throw new Error('Database must not initialize'); });
        const { state, response } = recorder();
        await handleReleaseSmoke({ method: 'POST', headers: { 'x-mutter-release-action': 'read-smoke', authorization },
            body: { action: 'catalog' } }, response, database);
        expect(state).toMatchObject({ status: 401, body: { error: 'Unauthorized' }, headers: { 'cache-control': 'no-store' } });
        expect(database).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    },
);

test('unset dedicated secret fails closed and never substitutes the cron secret', async () => {
    vi.stubEnv('RELEASE_ATTESTATION_SECRET', ''); vi.stubEnv('CRON_SECRET', secret);
    const database = vi.fn(() => { throw new Error('Database must not initialize'); });
    const { state, response } = recorder();
    await handleReleaseSmoke({ method: 'POST', headers: { 'x-mutter-release-action': 'read-smoke', authorization: `Bearer ${secret}` },
        body: { action: 'catalog' } }, response, database);
    expect(state.status).toBe(401); expect(database).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});

test.each([{ action: 'start' }, { action: 'status' }, { action: 'verify' }, { action: 'admin_order' },
    { action: 'catalog', orderId: 'not-permitted' }, '{malformed'])('internal smoke cannot delegate %j to business', async body => {
    const database = vi.fn(() => { throw new Error('Database must not initialize'); });
    const { state, response } = recorder();
    await handleReleaseSmoke({ method: 'POST', headers: { 'x-mutter-release-action': 'read-smoke', authorization: `Bearer ${secret}` }, body }, response, database);
    expect(state.status).toBe(400); expect(database).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(state)).not.toContain(secret);
});

test('database initialization failure is observable and cannot leak its error details', async () => {
    const database = vi.fn(() => { throw new Error(`PRIVATE_PATH:${secret}`); });
    const { state, response } = recorder();
    await handleReleaseSmoke({ method: 'POST', headers: { 'x-mutter-release-action': 'read-smoke', authorization: `Bearer ${secret}` },
        body: { action: 'catalog' } }, response, database);
    expect(state).toMatchObject({ status: 503, body: { error: 'Read-only smoke unavailable' } });
    expect(database).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
    expect(JSON.stringify(state)).not.toContain(secret);
});

test.each(['quote', 'availability'])('array action %j cannot be coerced into a read capability', async action => {
    const database = vi.fn(() => { throw new Error('Database must not initialize for an invalid action type'); });
    const { state, response } = recorder();
    await handleReleaseSmoke({ method: 'POST', headers: { 'x-mutter-release-action': 'read-smoke', authorization: `Bearer ${secret}` },
        body: { action: [action], purchase, key: 'synthetic-read-smoke-00001', quoteHash: 'a'.repeat(64) } }, response, database);
    expect(state.status).toBe(400); expect(database).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
