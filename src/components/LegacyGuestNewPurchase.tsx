import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function LegacyGuestNewPurchase() {
  const { newPurchaseOffer, purchaseStarting, startNewPurchase, credentialError } = useAuth();
  if (!newPurchaseOffer) return null;
  return <section aria-label="Compra nueva como invitado" aria-busy={purchaseStarting} className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-6 mb-6">
    <p className="text-gray-800 mb-4">Podés empezar una compra nueva como invitado. El carrito y el historial anteriores no se trasladan. Si tenés una consulta sobre una compra anterior, contactá a Mutter.</p>
    <button type="button" disabled={purchaseStarting} onClick={() => void startNewPurchase()} className="w-full rounded-md bg-black px-4 py-3 font-semibold text-white hover:bg-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black disabled:opacity-50">
      {purchaseStarting ? 'Preparando compra nueva…' : 'Empezar compra nueva'}
    </button>
    {!purchaseStarting && <Link to="/" className="mt-4 inline-block text-gray-700 underline">Seguir viendo la tienda</Link>}
    {credentialError && <p role="status" className="mt-4 text-sm text-gray-800">{credentialError}</p>}
  </section>;
}
