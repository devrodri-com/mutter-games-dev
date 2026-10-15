// src/firebase.ts
import { initializeApp, getApps } from "firebase/app";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import {
  initializeAuth,
  onAuthStateChanged,
  browserLocalPersistence,
  indexedDBLocalPersistence,
  browserSessionPersistence,
  browserPopupRedirectResolver,
  connectAuthEmulator,
} from "firebase/auth";
import { bootstrapAnonymousVisitor } from './utils/anonymousBootstrap';
import { readGuestPurchaseTransition } from './utils/guestPurchaseState';

const firebaseConfig = {
  // Siempre usamos la env; eliminamos la API key hardcodeada
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// ——— App singleton (evita reinicializar en HMR) ———
const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const db = getFirestore(app);
// Choose persistence while the official SDK creates its user manager, so its
// cross-tab listener belongs to the final store. The remaining old default
// stores stay in the hierarchy for official same-UID startup migration.
const auth = initializeAuth(app, {
  persistence: [browserLocalPersistence, indexedDBLocalPersistence, browserSessionPersistence],
  popupRedirectResolver: browserPopupRedirectResolver,
});

// Explicit isolated development only: connect before auth or reads can run.
if (import.meta.env.VITE_USE_FIREBASE_EMULATORS === 'true') {
  if (!import.meta.env.DEV || !firebaseConfig.projectId?.startsWith('demo-')) throw new Error('Isolated demo project required');
  connectFirestoreEmulator(db, '127.0.0.1', 8188);
  connectAuthEmulator(auth, 'http://127.0.0.1:9198', {disableWarnings:true});
}

// Persistencia local + sesión anónima para invitados
const persistenceReady = auth.authStateReady();
persistenceReady.catch(() => { if (import.meta.env.DEV) console.error('Local authentication persistence unavailable'); });

let _authResolved = false;
let _resolveAuthReady: ((uid: string) => void) | null = null;
export const authReady: Promise<string> = new Promise((res) => {
  _resolveAuthReady = res;
});

onAuthStateChanged(auth, (user) => {
  if (!user) {
    // Explicit identity transitions suppress this ordinary visitor bootstrap.
    void persistenceReady.then(() => {
      const transition = readGuestPurchaseTransition(auth);
      if (transition && transition.phase !== 'SETTLED') return;
      return bootstrapAnonymousVisitor(auth);
    }).catch(() => {
      if (import.meta.env.DEV) console.error("Anonymous sign-in unavailable");
    });
    return; // esperamos el próximo callback con el user
  }

  if (!_authResolved && _resolveAuthReady) {
    _resolveAuthReady(user.uid);
    _resolveAuthReady = null;
    _authResolved = true;
  }
});

// Utilidad para cuando quieras el UID ya listo
export const ensureAuthReady = async (): Promise<string> => {
  await persistenceReady;
  await auth.authStateReady();
  if (auth.currentUser?.uid) return auth.currentUser.uid;
  const transition = readGuestPurchaseTransition(auth);
  if (transition && transition.phase !== 'SETTLED') throw new Error('Terminá de iniciar la compra nueva antes de continuar.');
  return (await bootstrapAnonymousVisitor(auth)).uid;
};

export const getCurrentUid = (): string | null => auth.currentUser?.uid ?? null;

export { db, auth };
export const firebaseDB = db;
export default app;
