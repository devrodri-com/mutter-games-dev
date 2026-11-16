import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { auth } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';
import { linkCheckoutAccount } from '../../utils/checkoutAccount';
import { CredentialAccessError } from '../../utils/credentialAccess';

type Props = {
  checkoutBusy: boolean;
  isCheckoutBusy?: () => boolean;
  onBusyChange?: (busy: boolean) => void;
  onCheckoutBlockedChange?: (blocked: boolean) => void;
};
function accountError(error: unknown): string {
  if (error instanceof CredentialAccessError) return error.message;
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  if (code === 'auth/email-already-in-use' || code === 'auth/credential-already-in-use')
    return 'Ese correo ya tiene una cuenta. Ingresá a esa cuenta para continuar; usarás su carrito.';
  if (code === 'auth/weak-password') return 'Elegí una contraseña de al menos 6 caracteres.';
  if (code === 'auth/invalid-email') return 'Revisá el correo de la cuenta.';
  return 'No pudimos confirmar la cuenta. Revisá los datos o ingresá a tu cuenta para comprobar el acceso.';
}

export default function CheckoutAccountOption({ checkoutBusy, isCheckoutBusy, onBusyChange, onCheckoutBlockedChange }: Props) {
  const { credentialAccess, credentialScope, refreshAccess } = useAuth();
  const { shippingInfo } = useCart();
  const [chosen, setChosen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [savedUid, setSavedUid] = useState<string | null>(null);
  const [unconfirmedUid, setUnconfirmedUid] = useState<string | null>(null);
  const active = useRef(false);
  const mounted = useRef(true);
  const callbacks = useRef({ onBusyChange, onCheckoutBlockedChange });
  callbacks.current = { onBusyChange, onCheckoutBlockedChange };
  const id = useId();
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (active.current) callbacks.current.onBusyChange?.(false);
      callbacks.current.onCheckoutBlockedChange?.(false);
    };
  }, []);
  const current = auth.currentUser;
  const buyer = credentialAccess === 'active' && credentialScope === 'BUYER_POST_CUTOVER_V1';
  const registered = Boolean(current?.email || current?.phoneNumber || current?.providerData.length);
  const canCreate = buyer && Boolean(current) && !registered;
  const saved = savedUid !== null && savedUid === current?.uid && buyer;
  const checkoutLocked = () => checkoutBusy || isCheckoutBusy?.() === true;
  const controlsBusy = busy || checkoutBusy;
  const save = async () => {
    if (active.current || checkoutLocked() || !canCreate || !current) return;
    const normalized = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) { setMessage('Escribí un correo válido para la cuenta.'); return; }
    if (password.length < 6) { setMessage('Elegí una contraseña de al menos 6 caracteres.'); return; }
    active.current = true; setBusy(true); setMessage(null); callbacks.current.onBusyChange?.(true);
    try {
      await linkCheckoutAccount({ uid: current.uid, email: normalized, password, refreshAccess });
      if (mounted.current) {
        setSavedUid(current.uid); setUnconfirmedUid(null); setChosen(false); setEmail(''); callbacks.current.onCheckoutBlockedChange?.(false);
      }
    } catch (error: unknown) {
      if (mounted.current) {
        setMessage(accountError(error));
        if (auth.currentUser?.uid === current.uid && auth.currentUser.email) setUnconfirmedUid(current.uid);
      }
    } finally {
      active.current = false;
      if (mounted.current) { setPassword(''); setBusy(false); }
      callbacks.current.onBusyChange?.(false);
    }
  };
  const enterAccount = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') { event.preventDefault(); void save(); }
  };
  const guardLoginNavigation = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    if (active.current || checkoutLocked()) event.preventDefault();
  };
  return <div className="mt-2 space-y-3 text-sm text-gray-700" aria-busy={controlsBusy}>
    {saved ? <p role="status">Tu cuenta está lista. Conservás este carrito.</p>
      : unconfirmedUid === current?.uid ? <p role="status">Ingresá a tu cuenta para comprobar que el acceso quedó listo.</p>
        : registered && buyer && !message ? <p>Estás comprando con tu cuenta.</p>
        : <p>Comprás como invitado. Crear una cuenta es opcional.</p>}
    {!saved && (!registered || chosen) && <>
      <label className="flex items-center gap-2" htmlFor={`${id}-choose`}>
        <input id={`${id}-choose`} type="checkbox" checked={chosen} disabled={controlsBusy || !canCreate && !chosen}
          onClick={event => { if (active.current || checkoutLocked()) event.preventDefault(); }}
          onChange={event => {
            if (active.current || checkoutLocked()) { event.preventDefault(); return; }
            setChosen(event.target.checked); setMessage(null); setPassword('');
            callbacks.current.onCheckoutBlockedChange?.(event.target.checked);
            if (event.target.checked && !email) setEmail(shippingInfo.email);
            if (!event.target.checked) setEmail('');
          }} />
        Crear una cuenta
      </label>
      {chosen && <div className="space-y-3">
        <div className="cart-field"><label htmlFor={`${id}-email`}>Correo de la cuenta</label>
          <input id={`${id}-email`} type="email" autoComplete="email" value={email} disabled={controlsBusy}
            onKeyDown={enterAccount} onChange={event => { if (!active.current && !checkoutLocked()) setEmail(event.target.value); }} /></div>
        <div className="cart-field"><label htmlFor={`${id}-password`}>Contraseña de la cuenta</label>
          <input id={`${id}-password`} type="password" autoComplete="new-password" minLength={6} value={password} disabled={controlsBusy}
            onKeyDown={enterAccount} onChange={event => { if (!active.current && !checkoutLocked()) setPassword(event.target.value); }} />
          <small>Usá al menos 6 caracteres.</small></div>
        <button type="button" className="underline disabled:opacity-50" disabled={controlsBusy || !canCreate} onClick={() => void save()}>
          {busy ? 'Guardando cuenta…' : 'Crear mi cuenta'}
        </button>
        <p>Creá la cuenta o desmarcá esta opción para seguir como invitado.</p>
      </div>}
      {!buyer && <p role="status">Comprobamos el acceso antes de guardar una cuenta.</p>}
    </>}
    {checkoutBusy && <p role="status">Estamos preparando tu pago. Esperá para cambiar la cuenta.</p>}
    {message && <p role="status">{message}</p>}
    {!saved && <p>{controlsBusy
      ? <span role="link" aria-disabled="true" tabIndex={-1} className="cursor-not-allowed text-gray-500">Ya tengo cuenta: ingresar</span>
      : <Link className="underline" to="/login?return=cart" aria-disabled={false}
        onClick={guardLoginNavigation} onAuxClick={guardLoginNavigation} onContextMenu={guardLoginNavigation}>Ya tengo cuenta: ingresar</Link>}
      <span className="block">Al ingresar usarás el carrito de esa cuenta.</span></p>}
  </div>;
}
