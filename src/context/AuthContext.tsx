import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import { onIdTokenChanged, signOut } from 'firebase/auth';
import type { User } from '../data/types';
import { auth } from '../firebase';
import { CredentialAccessError, ensureCredentialSession, type CredentialAdmission, type LegacyGuestNewPurchase } from '../utils/credentialAccess';
import { startLegacyGuestPurchase } from '../utils/guestPurchase';
import { GuestPurchaseStateError, observeGuestPurchaseState, readGuestPurchaseTransition, writeGuestPurchaseTransition } from '../utils/guestPurchaseState';
import { guestPurchaseSourceUid, publicGuestPurchaseChoice } from '../utils/guestPurchaseChoice';
import { forgetObservedIdentity, observeIdentityState } from '../utils/observedIdentity';
import { startExplicitAnonymousVisitor } from '../utils/anonymousBootstrap';

type AccessState = 'loading' | 'active' | 'pending' | 'unavailable';
interface AuthContextType {
  user: User | null; login: (localUser?: User) => Promise<void>; logout: () => void; isLoading: boolean;
  credentialAccess: AccessState; credentialError: string | null; refreshAccess: () => Promise<CredentialAdmission>;
  credentialScope: CredentialAdmission['scope'] | null;
  credentialAdmissionVersion: number;
  getCredentialAdmissionVersion: () => number;
  newPurchaseOffer: LegacyGuestNewPurchase | null; purchaseStarting: boolean; startNewPurchase: () => Promise<void>;
  canStartGuestPurchase: boolean; startGuestPurchase: () => Promise<void>;
}
const AuthContext = createContext<AuthContextType | undefined>(undefined);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [credentialAccess, setCredentialAccess] = useState<AccessState>('loading');
  const [credentialError, setCredentialError] = useState<string | null>(null);
  const [credentialAdmissionVersion, setCredentialAdmissionVersion] = useState(0);
  const admissionVersion = useRef(0);
  const seenServerAdmissions = useRef(new WeakSet<CredentialAdmission>());
  const [newPurchaseOffer, setNewPurchaseOffer] = useState<LegacyGuestNewPurchase | null>(null);
  const [purchaseStarting, setPurchaseStarting] = useState(false);
  const [canStartGuestPurchase, setCanStartGuestPurchase] = useState(false);
  const starting = useRef(false);
  const admittedIdentity = useRef<CredentialAdmission | null>(null);
  const generation = useRef(0);
  const applyIdentity = (result: CredentialAdmission) => {
    const current = auth.currentUser;
    if (!current || current.uid !== result.uid) return false;
    admittedIdentity.current = result;
    setUser(result.admin || result.superadmin ? { id: current.uid, uid: current.uid, name: current.displayName || current.email || '', email: current.email || '', password: '' } : null);
    setCredentialAccess('active'); setCredentialError(null);
    setNewPurchaseOffer(null);
    setCanStartGuestPurchase(false);
    if (result.admin || result.superadmin) {
      const transition = readGuestPurchaseTransition(auth);
      if (transition && transition.uid !== result.uid && transition.phase !== 'SETTLED') writeGuestPurchaseTransition(auth, { ...transition, phase: 'SETTLED' });
    }
    return true;
  };
  const acceptServerAdmission = (result: CredentialAdmission) => {
    if (!applyIdentity(result)) return;
    // The observer and refresh can consume the same in-flight HTTP result.
    if (seenServerAdmissions.current.has(result)) return;
    seenServerAdmissions.current.add(result);
    setCredentialAdmissionVersion(++admissionVersion.current);
  };
  const getCredentialAdmissionVersion = () => admissionVersion.current;
  const reject = (error: unknown) => {
    admittedIdentity.current = null;
    setUser(null);
    setCredentialAccess(error instanceof CredentialAccessError && error.code === 'RECOVERY_REQUIRED' ? 'pending' : 'unavailable');
    setCredentialError(error instanceof CredentialAccessError || error instanceof GuestPurchaseStateError ? error.message : 'No pudimos comprobar el acceso. Tu cuenta y tus datos se conservan.');
    setNewPurchaseOffer(error instanceof CredentialAccessError ? error.newPurchase : null);
  };
  const restoreTransitionChoice = () => {
    try {
      const saved = readGuestPurchaseTransition(auth), current = auth.currentUser;
      if (!saved) return;
      if (saved.phase === 'SETTLED') { setNewPurchaseOffer(null); return; }
      if (current && current.uid !== saved.uid && (current.email || current.phoneNumber || current.providerData.length > 0)) {
        writeGuestPurchaseTransition(auth, { ...saved, phase: 'SETTLED' }); setNewPurchaseOffer(null); return;
      }
      setNewPurchaseOffer({ kind: saved.kind, uid: saved.uid, epoch: saved.epoch });
      if (!current) {
        setCredentialAccess('pending');
        setCredentialError(previous => previous ?? 'La sesión anterior se cerró. Continuá la compra nueva para empezar con un carrito vacío.');
      }
    } catch (error: unknown) {
      setNewPurchaseOffer(null); setCredentialAccess('unavailable');
      setCredentialError(error instanceof Error ? error.message : 'No pudimos comprobar el inicio guardado.');
    }
  };
  const resolvePublicChoice = async (version: number) => {
    let uid: string | null = null;
    try {
      const saved = readGuestPurchaseTransition(auth);
      if (saved && saved.phase !== 'SETTLED') { restoreTransitionChoice(); return; }
      uid = guestPurchaseSourceUid();
      if (!uid) {
        if (version !== generation.current) return;
        setCanStartGuestPurchase(true); setCredentialAccess('pending'); setCredentialError(null); return;
      }
      setCanStartGuestPurchase(false);
      const choice = await publicGuestPurchaseChoice(uid);
      if (version !== generation.current || admittedIdentity.current?.uid === uid || guestPurchaseSourceUid() !== uid) return;
      setNewPurchaseOffer(choice);
      if (choice) { setCredentialAccess('pending'); setCredentialError(null); }
      else if (!auth.currentUser) {
        setCredentialAccess('unavailable');
        setCredentialError('La sesión se cerró. Volvé a ingresar para continuar; tu cuenta y tus datos se conservan.');
      }
    } catch (error: unknown) {
      if (version !== generation.current) return;
      if (uid && admittedIdentity.current?.uid === uid) return;
      if (uid && auth.currentUser && auth.currentUser.uid !== uid) return;
      if (!auth.currentUser) setCredentialAccess('unavailable');
      setCredentialError(previous => previous ?? (error instanceof Error ? error.message : 'No pudimos comprobar la compra nueva. Intentá nuevamente.'));
    }
  };
  const refreshAccess = async () => {
    const current = auth.currentUser;
    if (!current) throw new CredentialAccessError('ACCESS_UNAVAILABLE', 'Esperá a que termine de cargar tu cuenta.');
    const uid = current.uid;
    const version = generation.current;
    const isCurrent = () => version === generation.current && auth.currentUser?.uid === uid;
    try { const result = await ensureCredentialSession(current); if (isCurrent()) acceptServerAdmission(result); return result; }
    catch (error: unknown) { if (isCurrent()) { reject(error); void resolvePublicChoice(version); } throw error; }
  };
  useEffect(() => onIdTokenChanged(auth, current => {
    const version = ++generation.current;
    admittedIdentity.current = null; setUser(null); setCredentialAccess('loading'); setCredentialError(null); setNewPurchaseOffer(null); setCanStartGuestPurchase(false);
    if (!current) { restoreTransitionChoice(); void resolvePublicChoice(version); return; }
    restoreTransitionChoice();
    void ensureCredentialSession(current).then(result => { if (version === generation.current) acceptServerAdmission(result); }).catch((error: unknown) => { if (version === generation.current) { reject(error); void resolvePublicChoice(version); } });
  }), []);
  useEffect(() => observeGuestPurchaseState(restoreTransitionChoice), []);
  useEffect(() => observeIdentityState(auth, () => {
    if (!auth.currentUser) void resolvePublicChoice(generation.current);
  }), []);
  const startNewPurchase = async () => {
    if (starting.current || !newPurchaseOffer) return;
    const offered = newPurchaseOffer;
    const current = auth.currentUser;
    if (current && current.uid !== offered.uid) {
      if (admittedIdentity.current?.uid === current.uid || credentialAccess === 'loading' || credentialAccess === 'active') return;
      let saved;
      try { saved = readGuestPurchaseTransition(auth); }
      catch (error: unknown) { reject(error); return; }
      if (!saved || saved.uid !== offered.uid || (saved.phase !== 'CREATING' && saved.phase !== 'CREATED' && saved.phase !== 'SIGNED_OUT')
        || current.email || current.phoneNumber || current.providerData.length > 0) return;
    }
    starting.current = true; setPurchaseStarting(true);
    ++generation.current; setUser(null); setCredentialAccess('pending'); setCredentialError(null);
    try { acceptServerAdmission(await startLegacyGuestPurchase(offered)); }
    catch (error: unknown) {
      if (admittedIdentity.current && admittedIdentity.current.uid !== offered.uid) { applyIdentity(admittedIdentity.current); return; }
      let saved = null;
      try { saved = readGuestPurchaseTransition(auth); }
      catch (stateError: unknown) { reject(stateError); return; }
      if (!auth.currentUser || auth.currentUser.uid === offered.uid || saved) {
        reject(error);
        // A fresh authoritative denial without eligibility invalidates the
        // cached choice. Only unavailable transport or an unfinished explicit
        // transition may keep a retry; neither can bypass server admission.
        if (saved || !(error instanceof CredentialAccessError) || error.code !== 'RECOVERY_REQUIRED' || error.newPurchase)
          setNewPurchaseOffer(offered);
        restoreTransitionChoice();
      }
    } finally { starting.current = false; setPurchaseStarting(false); }
  };
  const login = async () => { await refreshAccess(); };
  const startGuestPurchase = async () => {
    if (starting.current || !canStartGuestPurchase || auth.currentUser) return;
    try { if (guestPurchaseSourceUid()) return; }
    catch (error: unknown) { reject(error); return; }
    starting.current = true; setPurchaseStarting(true); setCredentialError(null);
    try { acceptServerAdmission(await ensureCredentialSession(await startExplicitAnonymousVisitor(auth))); }
    catch (error: unknown) {
      if (admittedIdentity.current) applyIdentity(admittedIdentity.current);
      else reject(error);
    } finally { starting.current = false; setPurchaseStarting(false); }
  };
  const logout = () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    void signOut(auth).then(() => {
      if (!auth.currentUser) forgetObservedIdentity(auth, uid);
    }).catch(() => setCredentialError('No pudimos completar el cierre de sesión. Intentá nuevamente.'));
  };
  return <AuthContext.Provider value={{ user, login, logout, isLoading: credentialAccess === 'loading', credentialAccess, credentialError, credentialScope: admittedIdentity.current?.scope ?? null, credentialAdmissionVersion, getCredentialAdmissionVersion, refreshAccess, newPurchaseOffer, purchaseStarting, startNewPurchase, canStartGuestPurchase, startGuestPurchase }}>{children}</AuthContext.Provider>;
}
export function useAuth() { const context = useContext(AuthContext); if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider'); return context; }
