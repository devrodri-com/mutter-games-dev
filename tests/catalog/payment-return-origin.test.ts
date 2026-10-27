// @vitest-environment node
import type { IncomingHttpHeaders } from 'node:http';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Provider } from '../../api/_lib/checkout-service';
import { parsePurchase, quotePurchase, record } from '../../api/_lib/checkout-domain';
import { createMercadoPagoPreference, mercadoPagoProviderForRequest } from '../../api/_lib/mercado-pago';
import { PAYMENT_WINDOW_MS } from '../../api/_lib/reconciliation-policy';

// This boundary test isolates auth, database and checkout dispatch. It exercises
// the real handler and provider adapter; it does not claim stock or auth proof.
const deps = vi.hoisted(() => ({ verify: vi.fn(), admit: vi.fn(), checkout: vi.fn(), cutover: vi.fn(), admission: vi.fn() }));
vi.mock('../../api/_lib/firebase-server', () => ({ adminApp: () => Object.freeze({}) }));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: deps.verify }) }));
vi.mock('firebase-admin/firestore', () => ({ getFirestore: () => Object.freeze({}) }));
vi.mock('../../api/_lib/credential-session', () => ({ requireCredentialSession: deps.admit }));
vi.mock('../../api/_lib/checkout-service', () => ({ checkout: deps.checkout }));
vi.mock('../../api/_lib/web-admission', () => ({ requestAdmissionContext: deps.admission }));
vi.mock('../../api/_lib/release-smoke', () => ({ handleReleaseSmoke: () => false }));
vi.mock('../../api/_lib/release-attestation', () => ({ handleReleaseAttestation: () => false }));
vi.mock('../../api/_lib/release-cutover', async importOriginal => ({
    ...await importOriginal<typeof import('../../api/_lib/release-cutover')>(), assertCutoverOpen: deps.cutover,
}));
import handler from '../../api/create-mp-preference';

const quote = quotePurchase(parsePurchase({ items: [{ id: 'p', quantity: 1 }], shipping: {
    pickup: true, department: '', name: 'Synthetic', address: '', city: '', postalCode: '', phone: '123', email: 'buyer@example.invalid',
} }), new Map([['p', { active: true, title: 'P', stockTotal: 1, priceUSD: 50 }]]));
let deadline = 0;
const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (input !== 'https://api.mercadopago.com/checkout/preferences' || init?.method !== 'POST') throw new Error('Unexpected synthetic provider request');
    return Response.json({ id: 'pref', collector_id: 200, external_reference: 'intent',
        init_point: 'https://www.mercadopago.com.uy/checkout/synthetic', expires: true, expiration_date_to: new Date(deadline).toISOString() });
});

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('MP_ACCESS_TOKEN', 'synthetic-not-a-credential');
    vi.stubGlobal('fetch', fetcher);
    deadline = Math.floor(Date.now() / 1000) * 1000 + PAYMENT_WINDOW_MS;
    deps.verify.mockResolvedValue({ uid: 'synthetic-buyer' });
    deps.admit.mockResolvedValue({ uid: 'synthetic-buyer', scope: 'BUYER_POST_CUTOVER_V1', admin: false, superadmin: false });
    deps.cutover.mockResolvedValue(undefined); deps.admission.mockReturnValue({ ipKey: 'a'.repeat(64) });
    deps.checkout.mockImplementation(async (_db: unknown, _uid: string, input: unknown, provider: Provider) => {
        const action = record(input).action;
        return action === 'start' ? provider('intent', quote, deadline, '200') : { testAction: action };
    });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function invoke(headers: IncomingHttpHeaders, rawHeaders?: string[], action = 'start') {
    let status = 0, body: unknown;
    const response = { setHeader() {}, status(code: number) { status = code; return response; }, json(value: unknown) { body = value; } };
    await handler({ method: 'POST', headers: { authorization: 'Bearer synthetic', ...headers }, rawHeaders, body: { action } }, response);
    return { status, body };
}
function backUrls() {
    const options = fetcher.mock.calls[0]?.[1];
    return record(JSON.parse(String(options?.body))).back_urls;
}

test.each(['muttergames.com', 'www.muttergames.com'])('HTTP start preserves %s for success, pending and failure before invoking the provider', async host => {
    const origin = `https://${host}`, returnUrl = `${origin}/success?orderId=intent`;
    const headers = { host, origin, 'x-forwarded-host': 'foreign.invalid', 'x-forwarded-proto': 'http' };
    expect(await invoke(headers, ['Host', host, 'Origin', origin])).toMatchObject({ status: 200 });
    expect(deps.admit).toHaveBeenCalledOnce(); expect(deps.cutover).toHaveBeenCalledOnce();
    expect(deps.checkout).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledOnce();
    expect(backUrls()).toEqual({ success: returnUrl, pending: returnUrl, failure: returnUrl });
    expect(fetcher.mock.calls[0]?.[0]).toBe('https://api.mercadopago.com/checkout/preferences');
});

const invalidHeaders: { name: string; headers: IncomingHttpHeaders; rawHeaders?: string[] }[] = [
    { name: 'missing origin', headers: { host: 'muttergames.com' } },
    { name: 'missing host', headers: { origin: 'https://muttergames.com' } },
    { name: 'forwarded origin only', headers: { host: 'muttergames.com', 'x-forwarded-host': 'muttergames.com', 'x-forwarded-proto': 'https' } },
    { name: 'foreign origin', headers: { host: 'muttergames.com', origin: 'https://foreign.invalid' } },
    { name: 'allowlist suffix', headers: { host: 'muttergames.com', origin: 'https://muttergames.com.foreign.invalid' } },
    { name: 'cleartext origin', headers: { host: 'muttergames.com', origin: 'http://muttergames.com' } },
    { name: 'path in origin', headers: { host: 'muttergames.com', origin: 'https://muttergames.com/' } },
    { name: 'credentials in origin', headers: { host: 'muttergames.com', origin: 'https://user@muttergames.com' } },
    { name: 'port in origin', headers: { host: 'muttergames.com', origin: 'https://muttergames.com:443' } },
    { name: 'cross alias', headers: { host: 'www.muttergames.com', origin: 'https://muttergames.com' } },
    { name: 'foreign host despite forwarded allowlist', headers: { host: 'foreign.invalid', origin: 'https://muttergames.com', 'x-forwarded-host': 'muttergames.com' } },
    { name: 'host with port', headers: { host: 'muttergames.com:443', origin: 'https://muttergames.com' } },
    { name: 'origin array', headers: Object.fromEntries<string | string[]>([['host', 'muttergames.com'], ['origin', ['https://muttergames.com']]]) },
    { name: 'host array', headers: Object.fromEntries<string | string[]>([['host', ['muttergames.com']], ['origin', 'https://muttergames.com']]) },
    { name: 'case-duplicated parsed origin', headers: { host: 'muttergames.com', origin: 'https://muttergames.com', Origin: 'https://muttergames.com' } },
    { name: 'joined origins', headers: { host: 'muttergames.com', origin: 'https://muttergames.com, https://muttergames.com' } },
    { name: 'raw duplicated origin', headers: { host: 'muttergames.com', origin: 'https://muttergames.com' },
        rawHeaders: ['Host', 'muttergames.com', 'Origin', 'https://muttergames.com', 'origin', 'https://muttergames.com'] },
    { name: 'raw duplicated host', headers: { host: 'muttergames.com', origin: 'https://muttergames.com' },
        rawHeaders: ['Host', 'muttergames.com', 'host', 'muttergames.com', 'Origin', 'https://muttergames.com'] },
    { name: 'raw parsed disagreement', headers: { host: 'muttergames.com', origin: 'https://muttergames.com' },
        rawHeaders: ['Host', 'muttergames.com', 'Origin', 'https://www.muttergames.com'] },
    { name: 'odd raw headers', headers: { host: 'muttergames.com', origin: 'https://muttergames.com' }, rawHeaders: ['Host'] },
];
test.each(invalidHeaders)('$name fails before cutover, checkout, admission quota or provider POST', async ({ headers, rawHeaders }) => {
    expect(await invoke(headers, rawHeaders)).toMatchObject({ status: 400, body: { code: 'RETURN_ORIGIN_UNAVAILABLE' } });
    expect(deps.cutover).not.toHaveBeenCalled(); expect(deps.checkout).not.toHaveBeenCalled();
    expect(deps.admission).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
});

test.each(['quote', 'availability', 'status', 'verify'])('%s does not create a return destination or require an Origin header', async action => {
    expect(await invoke({}, undefined, action)).toMatchObject({ status: 200, body: { testAction: action } });
    expect(fetcher).not.toHaveBeenCalled(); expect(deps.admission).not.toHaveBeenCalled();
});
test('a validated provider retains the four-argument checkout callback contract', async () => {
    const provider: Provider = mercadoPagoProviderForRequest({ host: 'muttergames.com', origin: 'https://muttergames.com' });
    expect(await provider('intent', quote, deadline, '200')).toMatchObject({ id: 'pref', collectorId: '200' });
    expect(backUrls()).toEqual({ success: 'https://muttergames.com/success?orderId=intent',
        pending: 'https://muttergames.com/success?orderId=intent', failure: 'https://muttergames.com/success?orderId=intent' });
});
test('direct legacy adapter callers retain their existing default', async () => {
    await createMercadoPagoPreference('intent', quote, deadline, '200');
    expect(backUrls()).toEqual({ success: 'https://www.muttergames.com/success?orderId=intent',
        pending: 'https://www.muttergames.com/success?orderId=intent', failure: 'https://www.muttergames.com/success?orderId=intent' });
});
