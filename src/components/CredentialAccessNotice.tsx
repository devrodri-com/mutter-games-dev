import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { auth } from '../firebase';
export default function CredentialAccessNotice() {
  const { credentialAccess, credentialError } = useAuth();
  const location = useLocation();
  if (location.pathname !== '/carrito') return null;
  if (credentialAccess === 'active') return (!auth.currentUser?.email && auth.currentUser?.providerData.length === 0) ? <p className="px-4 py-2 text-white text-sm">Podés continuar como invitado o <Link className="underline" to="/login?return=cart">entrar con tu cuenta</Link>.</p> : null;
  if (credentialAccess === 'loading') return <p role="status" className="px-4 py-2 text-white">Comprobando el acceso a tu carrito…</p>;
  return <div role="status" className="px-4 py-3 text-white"><p>{credentialAccess === 'pending' && !auth.currentUser?.email ? 'Conservamos tu carrito y tu cuenta. Contactá a Mutter para recuperar el acceso.' : credentialError}</p><Link className="underline" to="/login?return=cart">Entrar con mi cuenta o recuperar el acceso</Link></div>;
}
