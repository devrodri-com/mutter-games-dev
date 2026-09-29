// @vitest-environment node
import { test, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMercadoPagoPreference } from '../../api/_lib/mercado-pago';
import { parsePurchase, quotePurchase, record } from '../../api/_lib/checkout-domain';
import { PAYMENT_WINDOW_MS } from '../../api/_lib/reconciliation-policy';

const NOW = Date.parse('2026-09-29T12:00:00.000Z');
const deadline = NOW + PAYMENT_WINDOW_MS;
const quote = quotePurchase(parsePurchase({ items: [{ id: 'p', quantity: 1 }], shipping: { pickup: true, department: '', name: 'Test', address: '', city: '', postalCode: '', phone: '123', email: 'test@example.invalid' } }), new Map([['p', { active: true, title: 'P', stockTotal: 1, priceUSD: 50 }]]));
function response(changes: Record<string, unknown> = {}) {
    return Response.json({ id: 'pref', collector_id: 200, external_reference: 'intent',
        init_point: 'https://www.mercadopago.com.uy/checkout/test', expires: true,
        expiration_date_to: new Date(deadline).toISOString(), ...changes });
}
beforeEach(() => { vi.stubEnv('MP_ACCESS_TOKEN', 'synthetic'); vi.spyOn(Date, 'now').mockReturnValue(NOW); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
test('provider receives canonical UYU values and stable reference without assuming POST idempotency', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _options?: RequestInit) => response());
    vi.stubGlobal('fetch', fetcher);
    await createMercadoPagoPreference('intent', quote, deadline, '200');
    const options = fetcher.mock.calls[0]?.[1];
    const payload = record(JSON.parse(String(options?.body)));
    expect(payload).toMatchObject({ external_reference: 'intent', items: [{ id: 'p', unit_price: 50, currency_id: 'UYU', quantity: 1 }] });
    expect(record(options?.headers)['X-Idempotency-Key']).toBeUndefined();
    expect(payload.expires).toBe(true);
    expect(payload.expiration_date_from).toBe(new Date(NOW).toISOString());
    expect(payload.expiration_date_to).toBe(new Date(deadline).toISOString());
    expect(payload.back_urls).toEqual({ success: 'https://www.muttergames.com/success?orderId=intent', pending: 'https://www.muttergames.com/success?orderId=intent', failure: 'https://www.muttergames.com/success?orderId=intent' });
    expect(payload.binary_mode).toBeUndefined();
    expect(payload.auto_return).toBe('approved');
    expect(payload.payment_methods).toEqual({ excluded_payment_types: [{ id: 'ticket' }], excluded_payment_methods: [{ id: 'abitab' }, { id: 'redpagos' }] });
    expect(fetcher).toHaveBeenCalledTimes(1);
});
test('provider timeout and mismatched reference never become success or automatically retry', async () => {
    const timeout = vi.fn().mockRejectedValue(new Error('Timeout'));
    vi.stubGlobal('fetch', timeout);
    await expect(createMercadoPagoPreference('intent', quote, deadline, '200')).rejects.toThrow();
    expect(timeout).toHaveBeenCalledTimes(1);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ external_reference: 'other' })));
    await expect(createMercadoPagoPreference('intent', quote, deadline, '200')).rejects.toThrow();
});
test.each([undefined, 0, -1, 'seller', Number.MAX_SAFE_INTEGER + 1, 201])('missing, invalid or unexpected collector %s requires recovery', async collector_id => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ collector_id })));
    await expect(createMercadoPagoPreference('intent', quote, deadline, '200')).rejects.toThrow();
});
test.each(['http://www.mercadopago.com.uy/checkout/test', 'https://foreign.invalid/checkout/test', 'https://user:pass@www.mercadopago.com.uy/checkout/test', 'https://www.mercadopago.com.uy:444/checkout/test'])('untrusted provider redirect %s is rejected', async init_point => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ init_point })));
    await expect(createMercadoPagoPreference('intent', quote, deadline, '200')).rejects.toThrow('URL');
});
test('expired preference request fails before a provider POST', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(createMercadoPagoPreference('intent', quote, NOW - 1, '200')).rejects.toThrow('lifetime');
    expect(fetcher).not.toHaveBeenCalled();
});
