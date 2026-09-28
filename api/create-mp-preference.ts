import type { VercelRequest } from '@vercel/node';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { CheckoutError } from './_lib/checkout-domain.js';
import { checkout } from './_lib/checkout-service.js';
import { createMercadoPagoPreference } from './_lib/mercado-pago.js';
import { mercadoPagoGateway } from './_lib/mercado-pago-payments.js';
type Response = {
    setHeader(name: string, value: string): unknown;
    status(code: number): Response;
    json(body: unknown): unknown;
};
export default async function handler(req: Pick<VercelRequest, 'method' | 'headers' | 'body'>, res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST')
        return res.status(405).json({ error: 'Method not allowed' });
    const header = req.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer '))
        return res.status(401).json({ error: 'Iniciá sesión para continuar.' });
    try {
        const app = getApps().find(app => app.name === 'catalog-checkout') ?? initializeApp({ credential: cert({ projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL, privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n') }) }, 'catalog-checkout');
        let uid: string;
        try {
            uid = (await getAuth(app).verifyIdToken(header.slice(7), true)).uid;
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
        return res.status(200).json(await checkout(getFirestore(app), uid, body, createMercadoPagoPreference, { gateway: mercadoPagoGateway }));
    }
    catch (error: unknown) {
        if (error instanceof CheckoutError)
            return res.status(error.status).json({ code: error.code, error: error.message });
        return res.status(503).json({ code: 'UNAVAILABLE', error: 'No pudimos verificar la compra. Conservamos tu carrito; intentá nuevamente.' });
    }
}
