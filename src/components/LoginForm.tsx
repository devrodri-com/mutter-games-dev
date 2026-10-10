import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EmailAuthProvider, linkWithCredential, signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase';
import { useAuth } from '../context/AuthContext';
import { captureRecoveryNonce, completeCredentialRecovery, CredentialAccessError, discardRecoveryNonce, ensureCredentialSession, requestCredentialRecovery, type CredentialAdmission } from '../utils/credentialAccess';

export default function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [register, setRegister] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [nonce, setNonce] = useState(captureRecoveryNonce);
  const navigate = useNavigate();
  const { refreshAccess, credentialAccess } = useAuth();
  const finish = async (result: CredentialAdmission) => {
    const changedAccount = () => auth.currentUser?.uid !== result.uid;
    const cancelled = () => new CredentialAccessError('ACCESS_UNAVAILABLE', 'Cambió la cuenta. Ingreso anterior cancelado; tu cuenta actual y sus datos se conservan.');
    if (changedAccount()) throw cancelled();
    const fresh = await refreshAccess().catch((error: unknown) => { if (changedAccount()) throw cancelled(); throw error; });
    if (fresh.uid !== result.uid || auth.currentUser?.uid !== fresh.uid) throw cancelled();
    navigate(fresh.admin || fresh.superadmin ? '/admin' : '/carrito', { replace: true });
  };
  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); if (busy) return; setBusy(true); setMessage(null);
    try {
      if (register) {
        const current = auth.currentUser;
        if (!current || current.email || current.providerData.length !== 0) throw new CredentialAccessError('ACCESS_UNAVAILABLE', 'Usá el ingreso de tu cuenta existente. No crearemos otra cuenta.');
        await ensureCredentialSession(current);
        const linked = await linkWithCredential(current, EmailAuthProvider.credential(email.trim(), password));
        await finish(await ensureCredentialSession(linked.user));
      } else {
        const credential = await signInWithEmailAndPassword(auth, email.trim(), password);
        if (nonce) {
          const result = await completeCredentialRecovery(credential.user, nonce);
          discardRecoveryNonce(); setNonce(null); await finish(result);
        } else await finish(await ensureCredentialSession(credential.user));
      }
      setPassword('');
    } catch (error: unknown) {
      setPassword('');
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
  return <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 px-4 py-10">
    <img src="/logo1.png" alt="Mutter Games" className="w-24 h-24 object-contain mb-4" />
    <h1 className="text-2xl font-bold text-gray-800 mb-2">{register ? 'Guardar mi cuenta' : 'Ingresar a mi cuenta'}</h1>
    <p className="text-gray-500 text-sm mb-8 text-center">{nonce ? 'Ya volviste del enlace. Ingresá con la contraseña que acabás de elegir.' : register ? 'Es opcional. Conservaremos el mismo usuario y su carrito.' : 'Conservamos tu cuenta, tus pedidos y tu carrito.'}</p>
    <form onSubmit={handleLogin} className="w-full max-w-md bg-white shadow-lg rounded-xl px-8 pt-8 pb-6">
      <div className="mb-4"><label htmlFor="access-email" className="block text-gray-700 text-sm font-medium mb-1">Correo electrónico</label><input id="access-email" type="email" value={email} required autoComplete="email" disabled={busy} onChange={event => setEmail(event.target.value)} className="w-full border border-gray-300 px-4 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-black" /></div>
      <div className="mb-6"><label htmlFor="access-password" className="block text-gray-700 text-sm font-medium mb-1">Contraseña</label><input id="access-password" type="password" value={password} required autoComplete={register ? 'new-password' : 'current-password'} disabled={busy} onChange={event => setPassword(event.target.value)} className="w-full border border-gray-300 px-4 py-2 rounded-md focus:outline-none focus:ring-2 focus:ring-black" /></div>
      <button disabled={busy} type="submit" className="w-full bg-black text-white py-2 px-4 rounded-md font-semibold hover:bg-gray-900 disabled:opacity-50">{busy ? 'Comprobando…' : register ? 'Guardar mi cuenta' : 'Ingresar'}</button>
      {!register && <button type="button" disabled={busy} onClick={() => void recover()} className="mt-4 underline text-gray-800 disabled:opacity-50">Recuperar mi acceso por correo</button>}
      {credentialAccess === 'active' && !auth.currentUser?.email && auth.currentUser?.providerData.length === 0 && !nonce && <button type="button" disabled={busy} onClick={() => { setRegister(!register); setMessage(null); }} className="mt-4 block underline text-gray-800">{register ? 'Ya tengo una cuenta' : 'Quiero guardar mi cuenta de invitado'}</button>}
      {message && <p role="status" className="mt-4 text-sm text-gray-800">{message}</p>}
    </form>
    <Link to="/carrito" className="mt-6 text-gray-700 underline">Volver a mi carrito</Link>
  </div>;
}
