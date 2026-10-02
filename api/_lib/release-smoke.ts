import type { Firestore } from 'firebase-admin/firestore';
import { CheckoutError, record } from './checkout-domain.js';
import { checkout } from './checkout-service.js';
import { adminOrders } from './admin-orders.js';
import { releaseAuthorized, type ReleaseRequest, type ReleaseResponse } from './release-attestation.js';

/** Internal read-only capability. It cannot forward arbitrary checkout actions. */
export async function handleReleaseSmoke(
    req: ReleaseRequest & { body?: unknown }, res: ReleaseResponse, getDatabase: () => Firestore,
): Promise<boolean> {
    if (req.headers['x-mutter-release-action'] !== 'read-smoke') return false;
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST'); res.status(405).json({ error: 'Method not allowed' }); return true;
    }
    if (!releaseAuthorized(req.headers.authorization, process.env.RELEASE_ATTESTATION_SECRET)) {
        res.status(401).json({ error: 'Unauthorized' }); return true;
    }
    try {
        let input: unknown;
        try { input = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
        catch { throw new CheckoutError(400, 'INVALID_INPUT', 'Datos inválidos.'); }
        const body = record(input);
        if (typeof body.action !== 'string' || !['quote', 'availability', 'catalog', 'admin_read'].includes(body.action)) {
            throw new CheckoutError(400, 'INVALID_RELEASE_SMOKE', 'Smoke inválido.');
        }
        if ((body.action === 'catalog' || body.action === 'admin_read') && Object.keys(body).length !== 1) {
            throw new CheckoutError(400, 'INVALID_RELEASE_SMOKE', 'Smoke inválido.');
        }
        const db = getDatabase();
        if (body.action === 'catalog') {
            const page = await db.collection('products').limit(1).get();
            res.status(200).json({ schemaVersion: 1, smoke: 'catalog', readable: true, sampled: page.size });
        } else if (body.action === 'admin_read') {
            const page = await adminOrders(db, { admin: true }, { action: 'admin_orders', limit: 1 });
            res.status(200).json({ schemaVersion: 1, smoke: 'admin_read', readable: true, sampled: 'orders' in page ? page.orders.length : 0 });
        } else {
            // These exact existing actions only read. Never pass status/verify/start,
            // a provider implementation or a payment gateway to this capability.
            const result = await checkout(db, 'release-read-only', body, async () => { throw new Error('Read-only smoke attempted a provider write'); });
            res.status(200).json(result);
        }
    } catch (error: unknown) {
        if (error instanceof CheckoutError) res.status(error.status).json({ code: error.code, error: error.message });
        else res.status(503).json({ error: 'Read-only smoke unavailable' });
    }
    return true;
}
