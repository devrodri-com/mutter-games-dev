import type { VercelRequest } from '@vercel/node';
import { adminApp } from './_lib/firebase-server.js';
import { adminOrders } from './_lib/admin-orders.js';
import { requestAdmissionContext } from './_lib/web-admission.js';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { CheckoutError, record } from './_lib/checkout-domain.js';
import { checkout } from './_lib/checkout-service.js';
import { createMercadoPagoPreference } from './_lib/mercado-pago.js';
import { mercadoPagoGateway } from './_lib/mercado-pago-payments.js';
import { handleReleaseAttestation } from './_lib/release-attestation.js';
import { handleReleaseSmoke } from './_lib/release-smoke.js';
import { assertCutoverOpen, CutoverClosedError } from './_lib/release-cutover.js';
export const config = { maxDuration: 60, architecture: 'x86_64' };
type Response = {
    setHeader(name: string, value: string): unknown;
    status(code: number): Response;
    json(body: unknown): unknown;
};
export default async function handler(req: Pick<VercelRequest, 'method' | 'headers' | 'body'> & { rawHeaders?: string[] }, res: Response) {
    if (await handleReleaseSmoke(req, res, () => getFirestore(adminApp()))) return;
    if (handleReleaseAttestation(req, res, 'checkout')) return;
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST')
        return res.status(405).json({ error: 'Method not allowed' });
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer '))
        return res.status(401).json({ error: 'Iniciá sesión para continuar.' });
    try {
        const app = adminApp();
        let claims: DecodedIdToken;
        try {
            claims = await getAuth(app).verifyIdToken(header.slice(7), true);
        }
        catch {
            return res.status(401).json({ error: 'La sesión no es válida. Volvé a intentarlo.' });
        }
        let body: unknown;
        try {
            body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        }
        catch {
            return res.status(400).json({ error: 'Datos inválidos.' });
        }
        const input = record(body);
        const db = getFirestore(app);
        if (input.action === 'admin_orders' || input.action === 'admin_order') {
            return res.status(200).json(await adminOrders(db, claims, input));
        }
        if (input.action !== 'quote' && input.action !== 'availability') await assertCutoverOpen(db);
        return res.status(200).json(await checkout(db, claims.uid, body, createMercadoPagoPreference, {
            gateway: mercadoPagoGateway,
            ...(input.action === 'start' ? { admission: requestAdmissionContext(req.headers, req.rawHeaders) } : {}),
        }));
    }
    catch (error: unknown) {
        if (error instanceof CheckoutError || error instanceof CutoverClosedError)
            return res.status(error.status).json({ code: error.code, error: error.message });
        return res.status(503).json({ code: 'UNAVAILABLE', error: 'No pudimos verificar la compra. Conservamos tu carrito; intentá nuevamente.' });
    }
}
