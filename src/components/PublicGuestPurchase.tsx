import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function PublicGuestPurchase({ inLayout = false }: { inLayout?: boolean }) {
  const { canStartGuestPurchase, purchaseStarting, startGuestPurchase, credentialError } = useAuth();
  if (!canStartGuestPurchase) return null;
  return <section aria-label="Comprar como invitado" aria-busy={purchaseStarting} className={`w-full max-w-lg rounded-xl border border-gray-200 bg-white p-6 mb-6 text-gray-900${inLayout ? ' mx-auto mt-24' : ''}`}>
    <p className="mb-4">Podés comprar sin registrarte. Esta compra empezará con un carrito vacío y no recupera ni traslada compras anteriores. Si tenés una cuenta, podés ingresar.</p>
    <button type="button" disabled={purchaseStarting} onClick={() => void startGuestPurchase()} className="w-full rounded-md bg-black px-4 py-3 font-semibold text-white hover:bg-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:opacity-50">
      {purchaseStarting ? 'Preparando compra…' : 'Empezar compra como invitado'}
    </button>
    <Link to="/login" className="mt-4 inline-block underline">Ingresar a mi cuenta</Link>
    {credentialError && <p role="status" className="mt-4 text-sm">{credentialError}</p>}
  </section>;
}
