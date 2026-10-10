import { Link } from 'react-router-dom';
import { auth } from '../../firebase';
import { useAuth } from '../../context/AuthContext';
export default function CheckoutAccountOption() {
  const { credentialAccess } = useAuth();
  if (auth.currentUser?.email) return null;
  return <p className="mt-2 text-sm text-gray-700">Podés comprar como invitado. {credentialAccess === 'active' ? <Link className="underline" to="/login?return=cart">Si querés guardar tu cuenta, hacelo aquí antes de continuar.</Link> : 'Tu carrito se conserva mientras comprobamos o recuperamos el acceso.'}</p>;
}
