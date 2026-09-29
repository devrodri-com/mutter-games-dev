import { createHash, timingSafeEqual } from 'node:crypto';
import type { VercelRequest } from '@vercel/node';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { adminApp } from '../_lib/firebase-server.js';
import { mercadoPagoGateway } from '../_lib/mercado-pago-payments.js';
import type { CheckoutOptions } from '../_lib/order-reconciliation.js';
import { runWebStockSweep } from '../_lib/web-stock-sweep.js';

export const config = { maxDuration: 60 };
type Response = {
    setHeader(name: string, value: string): unknown;
    status(code: number): Response;
    json(body: unknown): unknown;
};
type Dependencies = {
    getDatabase: () => Firestore;
    secret: () => string | undefined;
    options: () => CheckoutOptions;
};
function authorized(header: unknown, secret: unknown): boolean {
    if (typeof header !== 'string' || header.length > 8192 || typeof secret !== 'string' || !secret || /[\u0000-\u0020\u007f]/.test(secret) || secret.length > 4096)
        return false;
    // Fixed-size digests let timingSafeEqual compare even a wrong-length bearer value.
    const actual = createHash('sha256').update(header).digest();
    const expected = createHash('sha256').update(`Bearer ${secret}`).digest();
    return timingSafeEqual(actual, expected);
}
export function createSweepHandler(dependencies: Dependencies) {
    return async function handler(req: Pick<VercelRequest, 'method' | 'headers'>, res: Response) {
        res.setHeader('Cache-Control', 'no-store');
        if (req.method !== 'GET') {
            res.setHeader('Allow', 'GET');
            return res.status(405).json({ error: 'Method not allowed' });
        }
        if (!authorized(req.headers.authorization, dependencies.secret()))
            return res.status(401).json({ error: 'Unauthorized' });
        try {
            // Authentication precedes Firebase initialization and every business read/write.
            const result = await runWebStockSweep(dependencies.getDatabase(), dependencies.options());
            return res.status(200).json(result);
        } catch {
            return res.status(503).json({ error: 'Stock reconciliation unavailable' });
        }
    };
}
export default createSweepHandler({
    getDatabase: () => getFirestore(adminApp()),
    secret: () => process.env.CRON_SECRET,
    options: () => ({ gateway: mercadoPagoGateway }),
});
