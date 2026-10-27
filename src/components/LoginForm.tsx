import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { EmailAuthProvider, linkWithCredential, signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { captureRecoveryNonce, completeCredentialRecovery, CredentialAccessError, discardRecoveryNonce, ensureCredentialSession, requestCredentialRecovery, type CredentialAdmission } from '../utils/credentialAccess';
import LegacyGuestNewPurchase from './LegacyGuestNewPurchase';
import './LoginForm.css';

export default function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [nonce, setNonce] = useState(captureRecoveryNonce);
  const [failedAttempt, setFailedAttempt] = useState<{ uid: string; afterAdmissionVersion: number } | null>(null);
  const navigate = useNavigate();
  const { refreshAccess, credentialAccess, credentialAdmissionVersion, getCredentialAdmissionVersion, credentialScope, user } = useAuth();
  const finish = async (result: CredentialAdmission) => {
    const changedAccount = () => auth.currentUser?.uid !== result.uid;
    const cancelled = () => new CredentialAccessError('ACCESS_UNAVAILABLE', 'Cambió la cuenta. Ingreso anterior cancelado; tu cuenta actual y sus datos se conservan.');
    if (changedAccount()) throw cancelled();
    const fresh = await refreshAccess().catch((error: unknown) => { if (changedAccount()) throw cancelled(); throw error; });
    if (fresh.uid !== result.uid || auth.currentUser?.uid !== fresh.uid) throw cancelled();
    navigate(fresh.scope === 'JOHN_ADMIN_CLOSED_V1' ? '/admin/productList' : fresh.admin || fresh.superadmin ? '/admin' : '/carrito', { replace: true });
  };
  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return; setBusy(true); setMessage(null); setFailedAttempt(null);
    let attemptedUid: string | null = null;
    try {
      if (register) {
        const current = auth.currentUser;
        if (!current || current.email || current.providerData.length !== 0) throw new CredentialAccessError('ACCESS_UNAVAILABLE', 'Usá el ingreso de tu cuenta existente. No crearemos otra cuenta.');
        await ensureCredentialSession(current);
        const linked = await linkWithCredential(current, EmailAuthProvider.credential(email.trim(), password));
        await finish(await ensureCredentialSession(linked.user));
      } else {
        const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
        attemptedUid = credential.user.uid;
        if (nonce) {
          const result = await completeCredentialRecovery(credential.user, nonce);
          discardRecoveryNonce(); setNonce(null); await finish(result);
        } else await finish(await ensureCredentialSession(credential.user));
      }
      setPassword('');
    } catch (error: unknown) {
      setPassword('');
      if (!register && !nonce && attemptedUid && auth.currentUser?.uid === attemptedUid) {
        // Capture at failure, including admissions accepted since this render.
        setFailedAttempt({ uid: attemptedUid, afterAdmissionVersion: getCredentialAdmissionVersion() });
      }
      setMessage(error instanceof CredentialAccessError ? error.message : 'No pudimos ingresar. Revisá el correo y la contraseña, o solicitá recuperar el acceso.');
    } finally { setBusy(false); }
  };
  const recover = async () => {
    if (busy) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setMessage('Escribí tu correo electrónico para solicitar la recuperación.'); return; }
    setBusy(true); setMessage(null);
    try {
      await requestCredentialRecovery(email.trim());
      setMessage('Solicitud recibida. Si corresponde y el correo está acreditado, recibirás un enlace oficial. Abrilo, elegí tu contraseña y volvé a ingresar aquí. Si no llega, contactá a Mutter antes de volver a solicitarlo.');
    } catch { setMessage('No pudimos recibir la solicitud. Tu cuenta y tus datos se conservan. Intentá nuevamente más tarde.'); }
    finally { setBusy(false); }
  };
  // Another tab may finish the same login after this form's request failed.
  // Navigate only on a newer server admission of this attempt's exact account.
  if (!busy && !nonce && !register && failedAttempt && credentialAccess === 'active'
    && credentialAdmissionVersion > failedAttempt.afterAdmissionVersion
    && user?.uid === failedAttempt.uid && auth.currentUser?.uid === failedAttempt.uid
    && credentialScope === 'JOHN_ADMIN_CLOSED_V1') {
    return <Navigate to="/admin/productList" replace />;
  }
  return <div className="mutter-login">
    <header className="mutter-login__top">
      <Link to="/carrito" className="mutter-login__back">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m14 5-7 7 7 7M7 12h14" /></svg>
        Volver a mi carrito
      </Link>
    </header>
    <main className="mutter-login__main">
      <img src="/brand/login/mutter-compacto-color-positivo.svg" alt="Mutter Games" width="846" height="150" className="mutter-login__brand" />
      <div className="mutter-login__panel">
        <div className="mutter-login__heading">
          <h1>{register ? 'Guardar mi cuenta' : 'Ingresar a mi cuenta'}</h1>
          <p>{nonce ? 'Ya volviste del enlace. Ingresá con la contraseña que acabás de elegir.' : register ? 'Es opcional. Conservaremos el mismo usuario y su carrito.' : 'Usá el correo y la contraseña de tu cuenta.'}</p>
        </div>
        <form onSubmit={handleLogin} className="mutter-login__form">
          <div className="mutter-login__fields">
            <div><label htmlFor="access-email">Correo electrónico</label><input id="access-email" type="email" value={email} required autoComplete="email" disabled={busy} onChange={event => setEmail(event.target.value)} /></div>
            <div><label htmlFor="access-password">Contraseña</label><input id="access-password" type="password" value={password} required autoComplete={register ? 'new-password' : 'current-password'} disabled={busy} onChange={event => setPassword(event.target.value)} /></div>
          </div>
          <button disabled={busy} type="submit" className="mutter-login__submit">
            {busy ? 'Comprobando…' : register ? 'Guardar mi cuenta' : 'Ingresar'}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m13 5 7 7-7 7M20 12H4" /></svg>
          </button>
          {!register && <button type="button" disabled={busy} onClick={() => void recover()} className="mutter-login__recover">Recuperar mi acceso por correo</button>}
          {credentialAccess === 'active' && !auth.currentUser?.email && auth.currentUser?.providerData.length === 0 && !nonce && <button type="button" disabled={busy} onClick={() => { setRegister(!register); setMessage(null); }} className="mutter-login__recover">{register ? 'Ya tengo una cuenta' : 'Quiero guardar mi cuenta de invitado'}</button>}
          {message && <p role="status" className="mutter-login__message">{message}</p>}
        </form>
        <div className="mutter-login__guest"><LegacyGuestNewPurchase /></div>
      </div>
    </main>
    <footer className="mutter-login__footer">Mutter Games &amp; Coleccionables · Uruguay</footer>
  </div>;
}
