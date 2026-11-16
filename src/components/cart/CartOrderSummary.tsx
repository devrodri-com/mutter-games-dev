import { ArrowRight } from 'lucide-react';
import type { ShippingData } from '../../context/CartContext';
import type { useCatalogCheckout } from '../../hooks/useCatalogCheckout';
import { formatCartAmount } from '../../utils/cartPresentation';

type Props = {
  subtotal: number;
  total: number;
  pickup: boolean;
  shippingText: string;
  shippingInfo: ShippingData;
  checkout: ReturnType<typeof useCatalogCheckout>;
  cartReady: boolean;
  cartError: string | null;
  onRefresh: () => void;
};

export default function CartOrderSummary({ subtotal, total, pickup, shippingText, shippingInfo, checkout, cartReady, cartError, onRefresh }: Props) {
  const address = [shippingInfo.address, shippingInfo.address2, shippingInfo.city,
    shippingInfo.state.replace(/^Departamento de\s+/i, ''), shippingInfo.postalCode, shippingInfo.country].filter(Boolean).join(', ');
  const quote = checkout.quote;
  const shippingLabel = pickup ? 'Retiro en Zona La Teja (sin costo)' : shippingText;
  const shippingExplanation = shippingLabel.replace(/\s*-\s*\$\d[\d.,]*\s*$/, '');
  return <div className="cart-order-closing">
    <h2 className="cart-mobile-summary-heading">Resumen de tu pedido</h2>
    {shippingInfo.address && <p className="cart-address-summary"><strong>Envío a:</strong> {address}</p>}
    <div className="cart-totals">
      <div className="cart-total-row"><span>Subtotal</span><strong>{formatCartAmount(quote ? quote.total - quote.shippingCost : subtotal)}</strong></div>
      <div className="cart-shipping-row"><div className="cart-total-row"><span>Envío</span></div>
        <p>{quote ? <>{formatCartAmount(quote.shippingCost)} {quote.currency}{quote.shippingCost === 0 && ` · ${shippingExplanation}`}</> : shippingLabel}</p>
      </div>
      <div className="cart-grand-total"><span>Total</span><strong>{formatCartAmount(quote ? quote.total : total)}</strong></div>
    </div>
    {quote && <div role="status" className="cart-checkout-notice">
      <p>Total actualizado: {formatCartAmount(quote.total)} {quote.currency}. Revisá los importes y confirmá para ir a Mercado Pago.</p>
      <p>Envío actualizado: {formatCartAmount(quote.shippingCost)} {quote.currency}.</p>
      <ul>{quote.items.map((item, index) => <li key={`${item.id}-${item.variantId}-${index}`}>
        {item.title}: {formatCartAmount(item.unitPrice)} × {item.quantity}
      </li>)}</ul>
    </div>}
    {checkout.recovery && <p role="alert" className="cart-checkout-notice">Existe un intento que requiere verificación. Podés reintentar la misma compra; no generes otra intención de pago.</p>}
    {cartError && <div role="alert" className="cart-checkout-notice">{cartError}<button type="button" onClick={onRefresh} className="cart-retry">Reintentar</button></div>}
    <button type="submit" form="cart-checkout" className="cart-review" disabled={checkout.loading || !cartReady || Boolean(cartError)} aria-busy={checkout.loading}>
      {checkout.loading ? 'Verificando…' : 'Confirmar y pagar'}
      <ArrowRight size={18} aria-hidden="true" />
    </button>
    <p className="cart-review-help">Revisá los datos y el total antes de continuar.</p>
  </div>;
}

