import { cert, getApps, initializeApp } from 'firebase-admin/app';
export function adminApp() {
    return getApps().find(app => app.name === 'catalog-checkout') ?? initializeApp({ credential: cert({
        projectId: process.env.FIREBASE_PROJECT_ID, clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }) }, 'catalog-checkout');
}
