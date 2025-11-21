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
  // En desarrollo local usamos la env, en build (staging/prod) forzamos la apiKey correcta del proyecto dev
  apiKey: import.meta.env.DEV
    ? import.meta.env.VITE_FIREBASE_API_KEY
    : "AIzaSyAP_bTxW0HrzJsfq4Hh5-N966xiI6U2TDU",
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

// Conectar a emuladores solo en desarrollo
if (import.meta.env.DEV) {
  try {
    connectFirestoreEmulator(db, "localhost", 8080);
    connectAuthEmulator(auth, "http://localhost:9099");
  } catch {
    // evitar error si ya están conectados en HMR
  }
}

// Persistencia local + sesión anónima para invitados
setPersistence(auth, browserLocalPersistence).catch(() => {});

let _authResolved = false;
let _resolveAuthReady: ((uid: string) => void) | null = null;
export const authReady: Promise<string> = new Promise((res) => {
  _resolveAuthReady = res;
});

onAuthStateChanged(auth, (user) => {
  if (!user) {
    // Si no hay usuario, creamos uno anónimo
    signInAnonymously(auth).catch((err) => {
      if (import.meta.env.DEV) console.error("Anonymous sign-in failed", err);
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
  if (auth.currentUser?.uid) return auth.currentUser.uid;
  return authReady; // espera a que se resuelva
};

export const getCurrentUid = (): string | null => auth.currentUser?.uid ?? null;

export { db, auth };
export const firebaseDB = db;
export default app;