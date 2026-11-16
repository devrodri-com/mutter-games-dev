import { Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { CartItem } from '../../data/types';
import { cartItemTitle, cartText, formatCartAmount } from '../../utils/cartPresentation';
import { cartVariantDescription } from '../../domain/cartVariantPresentation';

type Props = {
  items: CartItem[];
  language: 'es' | 'en';
  onRemove: (item: CartItem) => void;
};

export default function CartItems({ items, language, onRemove }: Props) {
  return <ul className="cart-items">
    {items.map((item, index) => {
      const title = cartItemTitle(item, language);
      const variantDescription = cartVariantDescription(item, language);
      return <li key={`${item.id}-${item.variantId ?? ''}-${index}`} className="cart-product">
        <Link className="cart-product-image" to={`/producto/${item.slug}`} tabIndex={-1} aria-hidden="true">
          <img src={item.image} alt="" />
        </Link>
        <div className="cart-product-copy">
          <Link className="cart-product-title" to={`/producto/${item.slug}`}>{title}</Link>
          {item.availability !== 'available' && <p role="status" className="cart-item-notice">{item.availability === 'unavailable' ? 'No disponible para compra' : 'Pendiente de verificar'}</p>}
          {item.priceChanged && <p role="status" className="cart-item-notice">El precio cambió. Revisá el importe actualizado.</p>}
          {variantDescription && <p className="cart-variant">{variantDescription}</p>}
          <p className="cart-unit-price">{formatCartAmount(item.priceUSD)} c/u</p>
          <p className="cart-quantity">Cantidad <strong>{item.quantity}</strong></p>
          {item.customName && item.customNumber && <p className="cart-variant">Personalizado: {cartText(item.customName, language, 'Sin nombre')} #{item.customNumber}</p>}
        </div>
        <div className="cart-product-end">
          <strong>{formatCartAmount(item.priceUSD * item.quantity)}</strong>
          <button type="button" className="cart-remove" onClick={() => onRemove(item)} aria-label={`Quitar ${title}`} title="Quitar">
            <Trash2 size={17} aria-hidden="true" /><span>Quitar</span>
          </button>
        </div>
      </li>;
    })}
  </ul>;
}

