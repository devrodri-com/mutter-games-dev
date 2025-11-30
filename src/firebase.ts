// src/firebase.ts
import { initializeApp, getApps } from "firebase/app";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  connectAuthEmulator,
} from "firebase/auth";

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
const auth = getAuth(app);

// Persistencia local + sesión anónima para invitados
setPersistence(auth, browserLocalPersistence).catch(() => {});

let _authResolved = false;
let _signingIn = false; // Flag para evitar múltiples llamadas concurrentes a signInAnonymously
let _resolveAuthReady: ((uid: string) => void) | null = null;
export const authReady: Promise<string> = new Promise((res) => {
  _resolveAuthReady = res;
});

// Listener único centralizado para autenticación anónima
onAuthStateChanged(auth, (user) => {
  if (import.meta.env.DEV) {
    console.log("[firebase] onAuthStateChanged:", user?.uid || "null");
  }

  if (!user) {
    // Si no hay usuario y no estamos ya intentando hacer login, creamos uno anónimo
    if (!_signingIn) {
      _signingIn = true;
      signInAnonymously(auth)
        .then(() => {
          if (import.meta.env.DEV) console.log("[firebase] signInAnonymously iniciado");
        })
        .catch((err) => {
          _signingIn = false;
          if (import.meta.env.DEV) console.error("[firebase] Anonymous sign-in failed", err);
        });
    }
    return; // esperamos el próximo callback con el user
  }

  // Si hay usuario, resetear el flag
  _signingIn = false;

  // Resolver la promesa si aún no se resolvió
  if (!_authResolved && _resolveAuthReady) {
    if (import.meta.env.DEV) console.log("[firebase] authReady resuelto con uid:", user.uid);
    _resolveAuthReady(user.uid);
    _resolveAuthReady = null;
    _authResolved = true;
  }
});

// Utilidad centralizada para obtener UID autenticado (anónimo o logueado)
export const ensureAuthReady = async (): Promise<string> => {
  // Si ya hay usuario, devolver inmediatamente
  if (auth.currentUser?.uid) {
    if (import.meta.env.DEV) console.log("[firebase] ensureAuthReady: usando uid existente:", auth.currentUser.uid);
    return auth.currentUser.uid;
  }
  // Si no, esperar a que se resuelva la promesa
  if (import.meta.env.DEV) console.log("[firebase] ensureAuthReady: esperando authReady...");
  return authReady;
};

// Función async para obtener UID actual (usa ensureAuthReady para garantizar autenticación)
export const getCurrentUid = async (): Promise<string> => {
  return ensureAuthReady();
};

export { db, auth };
export const firebaseDB = db;
export default app;