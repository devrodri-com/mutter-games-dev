import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import { onIdTokenChanged, signOut } from 'firebase/auth';
import type { User } from '../data/types';
import { auth } from '../firebase';
import { CredentialAccessError, ensureCredentialSession, type CredentialAdmission } from '../utils/credentialAccess';

type AccessState = 'loading' | 'active' | 'pending' | 'unavailable';
interface AuthContextType {
  user: User | null; login: (localUser?: User) => Promise<void>; logout: () => void; isLoading: boolean;
  credentialAccess: AccessState; credentialError: string | null; refreshAccess: () => Promise<CredentialAdmission>;
}
const AuthContext = createContext<AuthContextType | undefined>(undefined);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [credentialAccess, setCredentialAccess] = useState<AccessState>('loading');
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const generation = useRef(0);
  const accept = (result: CredentialAdmission) => {
    const current = auth.currentUser;
    if (!current || current.uid !== result.uid) return;
    setUser(result.admin || result.superadmin ? { id: current.uid, uid: current.uid, name: current.displayName || current.email || '', email: current.email || '', password: '' } : null);
    setCredentialAccess('active'); setCredentialError(null);
  };
  const reject = (error: unknown) => {
    setUser(null);
    setCredentialAccess(error instanceof CredentialAccessError && error.code === 'RECOVERY_REQUIRED' ? 'pending' : 'unavailable');
    setCredentialError(error instanceof CredentialAccessError ? error.message : 'No pudimos comprobar el acceso. Tu cuenta y tus datos se conservan.');
  };
  const refreshAccess = async () => {
    const current = auth.currentUser;
    if (!current) throw new CredentialAccessError('ACCESS_UNAVAILABLE', 'Esperá a que termine de cargar tu cuenta.');
    const uid = current.uid;
    const version = generation.current;
    const isCurrent = () => version === generation.current && auth.currentUser?.uid === uid;
    try { const result = await ensureCredentialSession(current); if (isCurrent()) accept(result); return result; }
    catch (error: unknown) { if (isCurrent()) reject(error); throw error; }
  };
  useEffect(() => onIdTokenChanged(auth, current => {
    const version = ++generation.current;
    setUser(null); setCredentialAccess('loading'); setCredentialError(null);
    if (!current) return;
    void ensureCredentialSession(current).then(result => { if (version === generation.current) accept(result); }).catch((error: unknown) => { if (version === generation.current) reject(error); });
  }), []);
  const login = async (_localUser?: User) => { await refreshAccess(); };
  const logout = () => { void signOut(auth).catch(() => setCredentialError('No pudimos cerrar la sesión. Intentá nuevamente.')); };
  return <AuthContext.Provider value={{ user, login, logout, isLoading: credentialAccess === 'loading', credentialAccess, credentialError, refreshAccess }}>{children}</AuthContext.Provider>;
}
export function useAuth() { const context = useContext(AuthContext); if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider'); return context; }
