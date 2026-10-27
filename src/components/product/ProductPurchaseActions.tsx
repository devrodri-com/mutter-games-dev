import { Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useCart } from '../../context/CartContext';

interface ProductPurchaseActionsProps {
  placement: 'main' | 'sticky';
  lang: 'es' | 'en';
  priceUSD: number;
  isOutOfStock: boolean;
  isAdding: boolean;
  onBuy: () => Promise<void>;
}

/** Both responsive purchase controls share the same admission and cart readiness. */
export function ProductPurchaseActions({ placement, lang, priceUSD, isOutOfStock, isAdding, onBuy }: ProductPurchaseActionsProps) {
  const { credentialAccess, credentialError } = useAuth();
  const { cartReady, cartError } = useCart();
  const ready = credentialAccess === 'active' && cartReady && !cartError;
  const disabled = isOutOfStock || isAdding || !ready;
  const label = isOutOfStock ? (lang === 'en' ? 'OUT OF STOCK' : 'SIN STOCK')
    : placement === 'main' ? (lang === 'en' ? 'Add to cart' : 'Agregar al carrito')
      : (lang === 'en' ? 'Buy now' : 'Comprar ahora');
  const button = <button
    type="button"
    disabled={disabled}
    aria-label={label}
    aria-busy={isAdding}
    aria-describedby={!ready && !isOutOfStock ? 'product-purchase-access' : undefined}
    onClick={onBuy}
    className={placement === 'main'
      ? `h-12 rounded-lg shadow hover:shadow-md tracking-wide transition flex items-center justify-center gap-2 border font-semibold disabled:opacity-50 disabled:cursor-not-allowed ${isOutOfStock ? 'bg-gray-300 text-white cursor-not-allowed' : 'bg-black text-white border-black hover:bg-white hover:text-black'}`
      : 'flex-1 h-11 rounded-lg bg-black text-white font-semibold tracking-wide shadow hover:bg-white hover:text-black border border-black transition disabled:opacity-50 disabled:cursor-not-allowed'}
  >
    {isAdding && !isOutOfStock ? <svg aria-hidden="true" className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
    </svg> : <>{placement === 'main' && !isOutOfStock && <Check size={18} aria-hidden="true" />}{label}</>}
  </button>;

  if (placement === 'main') return <div id="buy-block" className="grid md:grid-cols-2 gap-6 mt-6 mb-8">
    {button}
    {!ready && !isOutOfStock && <div id="product-purchase-access" className="md:col-span-2">
      <p role="status" className="text-sm text-gray-700">
        {credentialAccess === 'loading' ? (lang === 'en' ? 'Checking access to your cart…' : 'Comprobando el acceso a tu carrito…')
          : credentialAccess === 'pending' ? (lang === 'en' ? 'Your account and cart are preserved. Sign in or contact Mutter to recover access.' : 'Conservamos tu cuenta y tu carrito. Entrá con tu cuenta o contactá a Mutter para recuperar el acceso.')
            : credentialAccess === 'unavailable' ? credentialError || (lang === 'en' ? 'We could not verify access to your cart.' : 'No pudimos comprobar el acceso a tu carrito.')
              : cartError || (lang === 'en' ? 'Preparing your cart…' : 'Preparando tu carrito…')}
        {(credentialAccess === 'pending' || credentialAccess === 'unavailable') && <> <Link className="underline" to="/login?return=cart">{lang === 'en' ? 'Sign in or recover access' : 'Entrar con mi cuenta o recuperar el acceso'}</Link></>}
        {credentialAccess === 'active' && cartError && <> <Link className="underline" to="/carrito">{lang === 'en' ? 'Review my cart' : 'Revisar mi carrito'}</Link></>}
      </p>
    </div>}
  </div>;

  const formattedPrice = `${Math.floor(priceUSD).toLocaleString('es-AR')},${priceUSD.toFixed(2).split('.')[1]}`;
  return <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-gray-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 shadow-[0_-6px_20px_rgba(0,0,0,0.08)]">
    <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3" style={{ paddingBottom: 'calc(12px + env(safe-area-inset-bottom, 0px))' }}>
      <div className="flex flex-col leading-tight">
        <div className="flex items-end gap-1">
          <span className="text-xl font-extrabold leading-none">${formattedPrice.split(',')[0]}</span>
          <sup className="text-xs font-semibold align-[0.1em]">{formattedPrice.split(',')[1]}</sup>
        </div>
        <span className="text-[11px] text-gray-600 mt-0.5">Cuotas con MP</span>
      </div>
      {button}
    </div>
  </div>;
}
