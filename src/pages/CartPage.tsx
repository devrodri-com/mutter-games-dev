// src/pages/CartPage.tsx

import { CartFormData } from "@/data/types";
import EmptyCart from "@/components/cart/EmptyCart";
import { useCart } from "../context/CartContext";
import { Link, useNavigate } from "react-router-dom";
import { useState, Fragment, useRef, useEffect } from "react";
import { Listbox, Transition } from '@headlessui/react';
import { CheckIcon, ChevronUpDownIcon } from '@heroicons/react/20/solid';

const departamentos = [
  "Artigas", "Canelones", "Cerro Largo", "Colonia", "Durazno", "Flores", "Florida",
  "Lavalleja", "Maldonado", "Montevideo", "Paysandú", "Río Negro", "Rivera",
  "Rocha", "Salto", "San José", "Soriano", "Tacuarembó", "Treinta y Tres",
];
import { createPreference } from "../utils/createPreference";
import RelatedProducts from "../components/RelatedProducts";
import { CartItem } from "../data/types";
import { ShippingInfo } from "../data/types";
import { Trash2, Minus, Plus } from "lucide-react";
import Footer from "../components/Footer";
import { auth } from "../firebaseConfig";

import { serverTimestamp } from "firebase/firestore";

import { useLanguage } from '../hooks/useLanguage';
import CartNavbar from "../components/CartNavbar";
import { toast } from "react-hot-toast";
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { validateCartForm } from "../utils/formValidation";
import { registerClient, saveClientToFirebase, upsertClientFromCheckout } from "../firebaseUtils";
import { saveOrderToFirebase } from "@/firebase/orders";
import { saveCartToFirebase } from "@/firebase/cart";
import { extractStateFromAddress, extractAddressComponents } from "@/utils/locationUtils";
import { prepareInitialOrderData } from '../utils/orderUtils';
import { calculateTotal, calculateCartBreakdown, getShippingInfoByDepartment } from '../utils/cartUtils';

// Importá la función para buscar ciudad y estado por ZIP
import { getCityAndStateFromZip } from "../utils/getCityAndStateFromZip";

// === DEBUG iOS CART =======================================================
const isIOS =
  typeof navigator !== "undefined" &&
  /iP(ad|hone|od)/.test(navigator.userAgent || "");

const IOS_CART_DEBUG_SIMPLE = false; // modo carrito mínimo DESACTIVADO
// ==========================================================================

const createOrder = () => {
  console.log("📝 createOrder llamada (placeholder)");
};

export default function CartPage() {
  // --- DEBUG iOS: versión mínima de carrito sin lógica pesada ------------
  if (isIOS && IOS_CART_DEBUG_SIMPLE) {
    return (
      <div className="p-10">
        <h1>CartPage iOS DEBUG</h1>
        <p>Si esta pantalla NO se rompe en tu iPhone, el problema está en la lógica/UX real del carrito.</p>
      </div>
    );
  }
  // -----------------------------------------------------------------------

  // Always call hooks at the top level, never conditionally
  const { shippingInfo, setShippingInfo } = useCart();
  const { items, updateItem, clearCart, removeItem, setShippingData, shippingData, validateShippingData } = useCart();
  const { language } = useLanguage() as { language: 'en' | 'es' };
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const [pickup, setPickup] = useState(false);


  // Estado de errores por campo y error de dirección base
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [addressError, setAddressError] = useState(false);
  // --- EJEMPLO DE handleSubmit MODIFICADO ---
  // function handleSubmit, ejemplo:
  /*
  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormErrors({});
    // Validación de ubicación eliminada
    // resto de la lógica...
  }
  */

  // Refs para inputs para scroll a errores
  const nameRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const cityRef = useRef<HTMLInputElement>(null);
  const stateRef = useRef<HTMLDivElement>(null); // Listbox wrapper
  const postalCodeRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);


  // Poblar automáticamente los campos del formulario si hay datos guardados en shippingData
  useEffect(() => {
    if (shippingData?.name)
      setShippingInfo((prev) => ({ ...prev, name: shippingData.name || "" }));
    if (shippingData?.address) setShippingInfo((prev) => ({ ...prev, address: shippingData.address }));
    if (shippingData?.city) setShippingInfo((prev) => ({ ...prev, city: shippingData.city }));
    if (shippingData?.state) setShippingInfo((prev) => ({ ...prev, state: shippingData.state }));
    if (shippingData?.postalCode)
      setShippingInfo((prev) => ({ ...prev, postalCode: shippingData.postalCode || "" }));
    if (shippingData?.phone) setShippingInfo((prev) => ({ ...prev, phone: shippingData.phone }));
    if (shippingData?.email) setShippingInfo((prev) => ({ ...prev, email: shippingData.email }));
  }, []);

  // Validación de información de envío
  // (No longer used: validateShippingInfo)

  // Nueva función modular para crear un pedido seguro (sin undefined, sin ll)
  const crearPedido = () => {
    return {
      cliente: shippingInfo.name || '',
      telefono: shippingInfo.phone || '',
      email: shippingInfo.email || '',
      ciudad: shippingInfo.city || '',
      estado: shippingInfo.state || '',
      zip: shippingInfo.postalCode || '',
      pais: "USA",
      direccion: shippingInfo.address || '',
      carrito: items.map(item => ({
        id: item.id,
        nombre: item.name,
        precio: item.priceUSD,
        cantidad: item.quantity,
        variantTitle: item.variantTitle || "Variante",
        variantValue: item.variantLabel,
        customName: item.customName || "",
        customNumber: item.customNumber || "",
      })),
      total: items.reduce((sum, item) => sum + item.priceUSD * item.quantity, 0),
      moneda: "USD",
      fecha: new Date().toISOString(),
    };
  };



// Utilidad para validar email con regex profesional
const isValidEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};


  console.log("🧾 items en CartPage:", items);
  // Envío dinámico según departamento
  const department = shippingInfo?.state || "";
  const { label: shippingText, cost: shippingCost } = getShippingInfoByDepartment(department);
  // Subtotal
  const breakdown = calculateCartBreakdown(items);
  // Total con envío
  const total = breakdown.subtotal + (typeof shippingCost === "number" ? shippingCost : 0);

  const handleQuantityChange = (item: CartItem, newQty: number) => {
    if (newQty >= 1 && newQty <= 99) {
      updateItem(Number(item.id), item.variantLabel ?? "-", { quantity: newQty });
    }
  };

  const handleRemoveItem = (item: CartItem) => {
    if (!removeItem) return;
    removeItem(item.id, item.variantLabel ?? "-");
  };


  // Agregá la función handlePay justo antes del return
  const handlePay = async () => {
    try {
      // Asegurar que haya un usuario autenticado (anónimo o normal)
      const uid = auth.currentUser?.uid;
      if (!uid) {
        toast.error("Inicializando sesión segura... intentá de nuevo en unos segundos.");
        return;
      }

      // Calcular totales en USD (como usa el sitio)
      const subtotal = items.reduce((sum, item) => sum + Number(item.priceUSD || 0) * Number(item.quantity || 0), 0);
      const shippingCostNumber = typeof shippingCost === "number" ? shippingCost : 0;
      const totalNumber = Number((subtotal + shippingCostNumber).toFixed(2));

      // Preparar estructura de envío según reglas
      const shipping = {
        name: shippingInfo?.name || "",
        address: [shippingInfo?.address, shippingInfo?.address2].filter(Boolean).join(", "),
        city: shippingInfo?.city || "",
        state: shippingInfo?.state || "",
        postalCode: shippingInfo?.postalCode || "",
        phone: shippingInfo?.phone || "",
        email: shippingInfo?.email || "",
        cost: pickup ? 0 : shippingCostNumber,
      };

      // Reducir items a lo esencial (multilenguaje seguro)
      const orderItems = items.map((it) => {
        // Normalizar nombre del producto (acepta string u objeto multilenguaje)
        const normalizedTitle = (() => {
          if (typeof it.title === "object" && it.title) {
            const t = it.title as Record<string, string>;
            return t[language] ?? Object.values(t)[0] ?? "Producto";
          }
          return (it as any).title || (it as any).name || "Producto";
        })();

        // Normalizar customName (string u objeto multilenguaje)
        const normalizedCustomName = (() => {
          const cn: unknown = (it as any).customName;
          if (cn && typeof cn === "object") {
            const t = cn as Record<string, string>;
            return t[language] ?? Object.values(t)[0] ?? "";
          }
          return (typeof cn === "string" ? cn : "");
        })();

        return {
          id: it.id,
          slug: it.slug,
          name: normalizedTitle,
          priceUSD: Number((it as any).priceUSD ?? (it as any).price ?? 0),
          quantity: Number((it as any).quantity ?? 1),
          variantLabel: (it as any).variantLabel ?? null,
          variantId: (it as any).variantId ?? null,
          customName: normalizedCustomName,
          customNumber: (it as any).customNumber ?? "",
        };
      });

      // **Cumplir reglas de Firestore /orders**:
      // Debe contener: uid, createdAt, items, shipping, total
      const orderPayload = {
        uid,
        createdAt: serverTimestamp(),
        items: orderItems,
        shipping,
        total: totalNumber,
      };

      // Guardar orden en Firestore antes de ir a Mercado Pago, usando helper centralizado
      const orderId = await saveOrderToFirebase({
        items: orderPayload.items,
        shipping: {
          name: shippingInfo?.name || "",
          email: shippingInfo?.email || "",
          phone: shippingInfo?.phone || "",
          address: shipping.address,
          country: "UY",
          cost: shipping.cost,
        },
        total: orderPayload.total,
        createdAt: orderPayload.createdAt,
      });

      localStorage.setItem("lastOrderId", orderId);

      if (import.meta.env.DEV) {
        console.log("🧾 Orden creada en Firebase:", { id: orderId, ...orderPayload });
      }

      // Si el usuario eligió registrarse, crear/actualizar la ficha de cliente
      try {
        if (shippingInfo?.wantsToRegister) {
          await upsertClientFromCheckout({
            uid: auth.currentUser?.uid ?? null,
            name: shippingInfo?.name || "",
            email: shippingInfo?.email || "",
            phone: shippingInfo?.phone || "",
            address: shippingInfo?.address || "",
            address2: shippingInfo?.address2 || "",
            city: shippingInfo?.city || "",
            department: shippingInfo?.state || "",
            postalCode: shippingInfo?.postalCode || "",
            country: "UY",
            source: "checkout",
          });
          console.log("👤 Cliente upserted desde checkout");
        }
      } catch (e) {
        console.warn("[clientes] no se pudo registrar el cliente:", e);
      }

      // Luego crear preferencia de Mercado Pago y redirigir
      const url = await createPreference(items, {
        ...shippingInfo,
        department: shippingInfo.state || "",
        wantsToRegister: shippingInfo.wantsToRegister ?? false,
        password: shippingInfo.password || "",
        confirmPassword: shippingInfo.confirmPassword || "",
        shippingCost: shippingCostNumber,
      });

      if (url) {
        window.location.href = url;
      } else {
        toast.error("No se pudo generar la orden de pago.");
      }
    } catch (error) {
      console.error("❌ Error creando la orden:", error);
      toast.error("No se pudo guardar la orden. Revisá los datos e intentá de nuevo.");
    }
  };

  return (
    <>
      <CartNavbar />
      {/* Título principal del carrito, inmediatamente después del navbar */}
      <div>
        <section className="bg-white text-black min-h-screen flex flex-col pt-24">
          <main className="flex-grow">
            <div className="max-w-5xl mx-auto px-6 pt-2 pb-10">
              <h1 className="text-3xl font-bold text-gray-900 mb-4">Tu carrito</h1>

              {items.length === 0 ? (
                <div>
                  <EmptyCart />
                  {/* Minimalist categories line */}
                  <div className="mt-4 text-sm text-gray-600 text-center">
                    Productos originales de gaming y coleccionables
                  </div>
                  {/* Minimalist trust/benefits line */}
                  <div className="mt-3 text-sm text-gray-600 text-center">
                    Pago protegido con Mercado Pago · Envío a todo el país
                  </div>
                </div>
              ) : (
                <>
                  {/* contenido actual del carrito cuando hay productos */}
                  {/* Formulario de envío */}
                  <div className="space-y-4 mb-10">
                    {/* Fila 1: Nombre (50%) + Dirección (50%) */}
                    <div className="flex flex-row gap-4">
                      <div className="flex flex-col gap-1 w-1/2">
                        <label className="text-sm font-medium">Nombre completo</label>
                        <input
                          id="name"
                          ref={nameRef}
                          type="text"
                          placeholder="Nombre completo"
                          value={shippingInfo.name}
                          onChange={(e) => {
                            setShippingInfo({ ...shippingInfo, name: e.target.value });
                            if (formErrors.name) setFormErrors((prev) => ({ ...prev, name: "" }));
                          }}
                          required
                          className={`w-full px-4 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 ${formErrors.name ? 'border-red-600' : ''}`}
                        />
                      </div>
                      <div className="flex flex-col gap-1 w-1/2">
                        <label className="text-sm font-medium">Dirección</label>
                        <input
                          type="text"
                          value={shippingInfo.address}
                          onChange={(e) =>
                            setShippingInfo({ ...shippingInfo, address: e.target.value })
                          }
                          required
                          className="w-full border px-3 py-2 rounded-md"
                        />
                      </div>
                    </div>

                    {/* Fila 2: NUEVA estructura */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <input
                        type="text"
                        placeholder="Apartamento, piso, etc."
                        value={shippingInfo.address2}
                        onChange={(e) => setShippingInfo({ ...shippingInfo, address2: e.target.value })}
                        className={`w-full border border-gray-300 px-4 py-2 rounded-md col-span-2 ${formErrors.address2 ? 'border-red-600' : ''}`}
                      />
                      {/* Email */}
<input
  id="email"
  ref={emailRef}
  type="email"
  placeholder="Correo electrónico"
  value={shippingInfo.email}
  onChange={(e) => {
    setShippingInfo({ ...shippingInfo, email: e.target.value });
    if (formErrors.email) setFormErrors((prev) => ({ ...prev, email: "" }));
  }}
  pattern="^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$"
  required
  className={`w-full border px-4 py-2 rounded-md border-gray-300 ${formErrors.email ? 'border-red-500' : ''}`}
/>

{/* Teléfono */}
<input
  id="phone"
  ref={phoneRef}
  type="tel"
  inputMode="numeric"
  pattern="[0-9]*"
  placeholder="Teléfono"
  value={shippingInfo.phone}
  onChange={(e) => {
    const value = e.target.value.replace(/[^0-9]/g, ""); // solo números
    setShippingInfo({ ...shippingInfo, phone: value });
    if (formErrors.phone) {
      setFormErrors((prev) => ({ ...prev, phone: "" }));
    }
  }}
  required
  className={`w-full border px-4 py-2 rounded-md border-gray-300 ${formErrors.phone ? 'border-red-500' : ''}`}
/>
                    </div>

                    {/* Fila 3: NUEVA fila de ciudad, estado, zip, país */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <input
                        id="city"
                        ref={cityRef}
                        type="text"
                        placeholder="Ciudad o Barrio"
                        value={shippingInfo.city}
                        onChange={(e) => {
                          setShippingInfo({ ...shippingInfo, city: e.target.value });
                          if (formErrors.city) setFormErrors((prev) => ({ ...prev, city: "" }));
                        }}
                        className={`w-full border px-4 py-2 rounded-md border-gray-300 ${formErrors.city ? 'border-red-500' : ''}`}
                      />
                      {/* Departamento (Listbox) */}
                      <div className="relative">
                        <Listbox value={shippingInfo.state} onChange={(value) => setShippingInfo({ ...shippingInfo, state: value })}>
                          <div className="relative">
                            <Listbox.Button className="w-full border border-gray-300 px-4 py-2 rounded-md bg-white text-left focus:outline-none focus:ring-2 focus:ring-[#FF2D55] focus:border-[#FF2D55]">
                              <span className="block truncate">{shippingInfo.state || "Seleccioná un departamento"}</span>
                              <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
                                <ChevronUpDownIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
                              </span>
                            </Listbox.Button>
                            <Transition
                              as={Fragment}
                              leave="transition ease-in duration-100"
                              leaveFrom="opacity-100"
                              leaveTo="opacity-0"
                            >
                              <Listbox.Options className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm">
                                {departamentos.map((dep) => (
                                  <Listbox.Option
                                    key={dep}
                                    className={({ active }) =>
                                      `relative cursor-pointer select-none py-2 pl-10 pr-4 ${
                                        active ? 'bg-[#FF2D55]/10 text-[#FF2D55]' : 'text-gray-900'
                                      }`
                                    }
                                    value={dep}
                                  >
                                    {({ selected }) => (
                                      <>
                                        <span className={`block truncate ${selected ? 'font-medium' : 'font-normal'}`}>
                                          {dep}
                                        </span>
                                        {selected ? (
                                          <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-[#FF2D55]">
                                            <CheckIcon className="h-5 w-5" aria-hidden="true" />
                                          </span>
                                        ) : null}
                                      </>
                                    )}
                                  </Listbox.Option>
                                ))}
                              </Listbox.Options>
                            </Transition>
                          </div>
                        </Listbox>
                      </div>
                      <input
                        id="postalCode"
                        ref={postalCodeRef}
                        type="text"
                        placeholder="Código postal"
                        value={shippingInfo.postalCode}
                        onChange={(e) => {
                          setShippingInfo({ ...shippingInfo, postalCode: e.target.value });
                          if (formErrors.postalCode) setFormErrors((prev) => ({ ...prev, postalCode: "" }));
                        }}
                        maxLength={5}
                        className={`w-full border px-4 py-2 rounded-md border-gray-300 ${formErrors.postalCode ? 'border-red-500' : ''}`}
                      />
                      {shippingInfo.postalCode.length > 0 && shippingInfo.postalCode.length < 5 && (
                        <p className="text-red-600 text-sm mt-1">El código ZIP debe tener 5 dígitos.</p>
                      )}
                      <input
                        type="text"
                        value="Uruguay"
                        disabled
                        className="w-full border border-gray-300 px-4 py-2 rounded-md bg-gray-100 text-gray-500"
                      />
                    </div>

{/* Checkbox Retiro en Zona La Teja */}
<div className="flex items-center gap-2 mt-2">
  <input
    type="checkbox"
    id="pickup"
    checked={pickup}
    onChange={(e) => setPickup(e.target.checked)}
  />
  <label htmlFor="pickup" className="text-sm text-gray-700">
    Retirar en Zona La Teja (coordinar por WhatsApp, sin costo de envío)
  </label>
</div>

                    {/* Checkbox Registrarme */}
                    <div className="flex items-center gap-2 mt-2">
                      <input
                        type="checkbox"
                        id="wantsToRegister"
                        checked={shippingInfo.wantsToRegister}
                        onChange={(e) =>
                          setShippingInfo({ ...shippingInfo, wantsToRegister: e.target.checked })
                        }
                      />
                      <label htmlFor="wantsToRegister" className="text-sm text-gray-700">
                        Registrarme
                      </label>
                    </div>

                    {/* Campos condicionales de contraseña */}
                    {shippingInfo.wantsToRegister && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <input
                          type="password"
                          placeholder="Contraseña"
                          value={shippingInfo.password}
                          onChange={(e) =>
                            setShippingInfo({ ...shippingInfo, password: e.target.value })
                          }
                          className="w-full border border-gray-300 px-4 py-2 rounded-md"
                          required
                        />
                        <input
                          type="password"
                          placeholder="Confirmar contraseña"
                          value={shippingInfo.confirmPassword}
                          onChange={(e) =>
                            setShippingInfo({ ...shippingInfo, confirmPassword: e.target.value })
                          }
                          className="w-full border border-gray-300 px-4 py-2 rounded-md"
                          required
                        />
                      </div>
                    )}
                  </div>

                  <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-semibold">Resumen de tu pedido</h2>
                  </div>

                  {/* Render listado de items del carrito */}
                  <ul className="divide-y divide-gray-200 mb-6">
                    {items.map((item, index) => {
                      // Estandarizar title como objeto multilenguaje
                      if (typeof item.title === "string") {
                        item.title = { es: item.title, en: item.title };
                      } else if (!item.title) {
                        item.title = { es: "Sin título", en: "Untitled" };
                      }
                      // Estandarizar variantTitle como objeto multilenguaje
                      if (typeof item.variantTitle === "string") {
                        item.variantTitle = { es: item.variantTitle, en: item.variantTitle };
                      }
                      // --- Nueva lógica para título y variante (prioriza language, luego fallback) ---
                      const localizedTitle =
                        typeof item.title === "object"
                          ? item.title[language] || Object.values(item.title)[0]
                          : item.title || "Sin título";

                      const finalVariantLabel =
                        item.variantTitle && typeof item.variantTitle === "object"
                          ? item.variantTitle[language] || Object.values(item.variantTitle)[0]
                          : typeof item.variantTitle === "string"
                            ? item.variantTitle
                            : "Variante";
                      const price = item.priceUSD;
                      const totalItem = price * item.quantity;
                      return (
                        <li key={`${item.id}-${item.variantLabel}`} className="py-4 flex gap-4 items-start sm:items-center">
                          <Link to={`/producto/${item.slug}`}>
                            <img
                              src={item.image}
                              alt={localizedTitle}
                              className="w-20 h-20 object-cover rounded-md border"
                            />
                          </Link>
                          <div className="flex-1">
                            <Link to={`/producto/${item.slug}`}>
                              <p className="font-semibold text-sm mb-1 hover:underline">
                                {localizedTitle}
                              </p>
                            </Link>
                            <p className="text-sm text-gray-500 mb-1">
                              {`$${item.priceUSD.toFixed(2)} c/u`}
                            </p>
                            <div className="text-sm text-gray-500 flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center gap-1 sm:gap-3">
                              {item.variantLabel && item.variantId && (
                                <p className="text-gray-500 text-sm">
                                  {item.variantLabel}: {item.variantId}
                                </p>
                              )}
                              <span>
                                Cantidad:{" "}
                                <span className="inline-block border border-gray-300 px-2 py-0.5 rounded-md bg-gray-50 text-gray-800">
                                  {item.quantity}
                                </span>
                              </span>
                            </div>
                            {item.customName && item.customNumber && (
                              <p className="text-sm text-gray-500">
                                Personalizado: {typeof item.customName === "object"
                                  ? ((item.customName as Record<'en' | 'es', string>)?.[language] || "Sin nombre")
                                  : item.customName} #{item.customNumber}
                              </p>
                            )}
                          </div>
                          <div className="text-right flex flex-col justify-between items-end">
                            <span className="text-sm font-semibold">{`$${totalItem.toFixed(2)}`}</span>
                            <button
                              onClick={() => handleRemoveItem(item)}
                              className="mt-2 text-red-500 hover:text-red-700 transition"
                              title="Quitar"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>

                  <div className="bg-gray-100 p-6 rounded-2xl shadow-inner mt-10">
                    {/* Dirección de envío resumen: ciudad, departamento, código postal */}
                    <div className="mb-4 text-sm text-gray-700">
                      <div>
                        <span className="font-medium">Envío a:</span>{" "}
                        {shippingInfo?.address}
                        {shippingInfo?.address2 ? `, ${shippingInfo.address2}` : ""}
                        {shippingInfo?.city ? `, ${shippingInfo.city}` : ""}
                        {shippingInfo?.state ? (
                          <>
                            {", "}
                            {shippingInfo.state.replace(/^Departamento de\s+/i, "")}
                          </>
                        ) : ""}
                        {shippingInfo?.postalCode ? `, ${shippingInfo.postalCode}` : ""}
                        {shippingInfo?.country ? `, ${shippingInfo.country}` : ""}
                      </div>
                    </div>
                    <div className="space-y-2 text-gray-700 text-sm">
                      <div className="flex justify-between">
                        <span>Subtotal</span>
                        <span>{`$${breakdown.subtotal.toFixed(2)}`}</span>
                      </div>
                      <div className="flex justify-between">
  <span>Envío</span>
  <span>{pickup ? "Retiro en Zona La Teja (sin costo)" : shippingText}</span>
</div>
                      <div className="flex justify-between text-lg font-semibold border-t pt-2">
                        <span>Total</span>
                        <span>
                          {typeof shippingCost === "number"
                            ? `$${total.toFixed(2)}`
                            : `$${breakdown.subtotal.toFixed(2)}`}
                        </span>
                      </div>
                    </div>

                    {/* Micro-confianza justo antes del botón de finalizar compra */}
                    <p className="text-sm text-gray-500 mb-2">
                      Compra segura con garantía de satisfacción y productos verificados.
                    </p>
                    {/* Botón de checkout funcional Mercado Pago */}
                    <button
                      onClick={handlePay}
                      className="bg-[#FF2D55] hover:bg-[#e0264a] text-white px-6 py-2 rounded transition font-semibold w-full mt-2"
                    >
                      Finalizar compra
                    </button>
                  </div>

                  {items.length > 0 && !isIOS && (
                    <div className="mt-10 bg-white">
                      <div className="pb-20">
                        <h3 className="text-xl font-semibold">
                          También te podría interesar
                        </h3>
                        <RelatedProducts
                          excludeSlugs={items.map((i) => i.slug)}
                          categoryName="Fútbol"
                        />
                      </div>
                    </div>
                  )}
                </>
              )}

          </div>
        </main>
        <Footer variant="light" />
        <ToastContainer position="top-center" autoClose={3000} hideProgressBar />
      </section>
      </div>
    </>
  );
}
import { Order } from '@/data/types';
// Alternativamente, podés inyectar el script de Google Maps desde React con este efecto:

// Asegurarse que shippingData contiene las propiedades direccion y departamento
// Si no existen, inicializarlas aquí (esto es solo un recordatorio para el desarrollador: la inicialización real de shippingData debería hacerse en el contexto o donde corresponda)
// --- MÉTODO DE ENTREGA (ejemplo de cambio de opción de envío) ---
// Si tenés un select para el método de entrega, asegurate de usar este bloque:
/*
<select
  value={shippingData.metodo}
  onChange={(e) => {
    const selectedOption = e.target.value;
    let shippingCost = 0;
    if (selectedOption === 'Montevideo') shippingCost = 169;
    else if (selectedOption === 'Interior') shippingCost = 249;
    setShippingData({
      ...shippingData,
      metodo: selectedOption,
      shippingCost,
    });
  }}
>
  <option value="Montevideo">Montevideo</option>
  <option value="Interior">Interior</option>
</select>
*/

// Si existía el bloque:
// setShippingData({ ...shippingData, metodo: selectedOption });
// Reemplazalo por el bloque anterior.