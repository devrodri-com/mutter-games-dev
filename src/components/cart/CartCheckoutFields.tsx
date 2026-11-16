import { useState, type Dispatch, type SetStateAction, type FormEvent } from 'react';
import type { ShippingData } from '../../context/CartContext';
import CheckoutAccountOption from './CheckoutAccountOption';

const departments = [
  'Artigas', 'Canelones', 'Cerro Largo', 'Colonia', 'Durazno', 'Flores', 'Florida',
  'Lavalleja', 'Maldonado', 'Montevideo', 'Paysandú', 'Río Negro', 'Rivera',
  'Rocha', 'Salto', 'San José', 'Soriano', 'Tacuarembó', 'Treinta y Tres',
];

type Props = {
  shippingInfo: ShippingData;
  setShippingInfo: Dispatch<SetStateAction<ShippingData>>;
  pickup: boolean;
  setPickup: Dispatch<SetStateAction<boolean>>;
  onReview: () => void;
  accountBlocked: boolean;
  checkoutBusy: boolean;
  isCheckoutBusy: () => boolean;
  onAccountBusyChange: (busy: boolean) => void;
  onAccountBlockedChange: (blocked: boolean) => void;
};

export default function CartCheckoutFields({ shippingInfo, setShippingInfo, pickup, setPickup, onReview, accountBlocked, onAccountBusyChange, onAccountBlockedChange, checkoutBusy, isCheckoutBusy }: Props) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const update = (key: keyof ShippingData, value: string) => {
    setShippingInfo(previous => ({ ...previous, [key]: value }));
    setErrors(previous => ({ ...previous, [key]: '' }));
  };
  const input = (key: 'name' | 'email' | 'phone' | 'address' | 'address2' | 'city' | 'postalCode', label: string,
    options: { type?: string; placeholder?: string; autoComplete?: string; required?: boolean; full?: boolean } = {}) => {
    const error = errors[key];
    const postalHint = key === 'postalCode' && shippingInfo.postalCode.length > 0 && shippingInfo.postalCode.length < 5;
    return <div className={`cart-field${options.full ? ' cart-field-full' : ''}`}>
      <label htmlFor={key}>{label}</label>
      <input id={key} name={key} type={options.type ?? 'text'} value={shippingInfo[key] ?? ''}
        placeholder={options.placeholder} autoComplete={options.autoComplete} required={options.required}
        inputMode={key === 'phone' ? 'numeric' : undefined} pattern={key === 'phone' ? '[0-9]*' : undefined}
        maxLength={key === 'postalCode' ? 5 : undefined}
        aria-invalid={Boolean(error || postalHint)} aria-describedby={error || postalHint ? `${key}-error` : undefined}
        onChange={event => update(key, key === 'phone' ? event.target.value.replace(/[^0-9]/g, '') : event.target.value)}
        onBlur={event => {
          // Native field feedback only; server checkout validation remains authoritative.
          const message = event.currentTarget.validity.valid ? '' : event.currentTarget.validity.valueMissing
            ? `Completá ${label.toLowerCase()}.` : 'Revisá el formato de este dato.';
          setErrors(previous => ({ ...previous, [key]: message }));
        }} />
      {(error || postalHint) && <p id={`${key}-error`} className="cart-field-error">{error || 'El código postal debe tener 5 dígitos.'}</p>}
    </div>;
  };
  const submit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); if (!accountBlocked) onReview(); };
  return <form id="cart-checkout" className="cart-details" noValidate onSubmit={submit}>
    <section className="cart-form-card" aria-labelledby="cart-contact-heading">
      <div className="cart-section-heading"><h2 id="cart-contact-heading">Tus datos</h2><p>Contacto para tu pedido.</p></div>
      <div className="cart-contact-fields">
        {input('name', 'Nombre completo', { placeholder: 'Nombre y apellido', autoComplete: 'name', required: true, full: true })}
        {input('email', 'Correo electrónico', { type: 'email', placeholder: 'nombre@correo.com', autoComplete: 'email', required: true })}
        {input('phone', 'Teléfono', { type: 'tel', placeholder: 'Número de contacto', autoComplete: 'tel', required: true })}
      </div>
    </section>
    <section className="cart-form-card" aria-labelledby="cart-delivery-heading">
      <div className="cart-section-heading"><h2 id="cart-delivery-heading">¿Dónde lo recibís?</h2></div>
      <div className="cart-delivery-fields">
        {input('address', 'Dirección', { placeholder: 'Calle y número', autoComplete: 'address-line1', required: true, full: true })}
        {input('address2', 'Apartamento, piso, etc. (opcional)', { autoComplete: 'address-line2', full: true })}
        {input('city', 'Ciudad o barrio', { placeholder: 'Ciudad o barrio', autoComplete: 'address-level2' })}
        <div className="cart-field"><label htmlFor="state">Departamento</label>
          <select id="state" name="state" autoComplete="address-level1" value={shippingInfo.state}
            onChange={event => update('state', event.target.value)}>
            <option value="">Seleccioná un departamento</option>
            {departments.map(department => <option key={department}>{department}</option>)}
          </select>
        </div>
        {input('postalCode', 'Código postal', { placeholder: '5 dígitos', autoComplete: 'postal-code' })}
        <div className="cart-field"><label htmlFor="country">País</label><input id="country" value="Uruguay" disabled /></div>
      </div>
      <label className="cart-pickup" htmlFor="pickup"><input type="checkbox" id="pickup" checked={pickup} onChange={event => setPickup(event.target.checked)} />
        <span><strong>Retirar en Zona La Teja</strong><small>Coordinar por WhatsApp · sin costo de envío</small></span>
      </label>
      <div className="cart-account"><CheckoutAccountOption checkoutBusy={checkoutBusy} isCheckoutBusy={isCheckoutBusy} onBusyChange={onAccountBusyChange} onCheckoutBlockedChange={onAccountBlockedChange} /></div>
    </section>
  </form>;
}

