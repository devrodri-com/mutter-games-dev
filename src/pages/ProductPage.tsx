import { ProductReservationNotice } from '../components/product/ProductReservationNotice';
import { ProductPurchaseActions } from '../components/product/ProductPurchaseActions';
//src/pages/ProductPage.tsx

import { useParams, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import ProductPageNavbar from "../components/ProductPageNavbar";
import { usePublishedProduct } from "../hooks/usePublishedProduct";
import { useCart } from "../context/CartContext";
import { ChevronLeft, ArrowUp, CreditCard, Truck, Store, MessageSquare, Lock } from "lucide-react";
import { FiMinus, FiPlus } from "react-icons/fi";
import "keen-slider/keen-slider.min.css";
import { useKeenSlider } from "keen-slider/react";
import RelatedProducts from "../components/RelatedProducts";
import Footer from "../components/Footer";
import { useTranslation } from "react-i18next";
import { HiExclamation, HiExclamationCircle } from "react-icons/hi";
import { toast } from "react-hot-toast";

// === DEBUG iOS ============================================================
const isIOS =
  typeof navigator !== "undefined" &&
  /iP(ad|hone|od)/.test(navigator.userAgent || "");

// ==========================================================================

// ============================================================================
// === COMPONENTE PRINCIPAL: PRODUCT PAGE =====================================
// ============================================================================

// Improved mobile toast for stock limit error

export default function ProductPage() {
  // ------------------------------------------------------------------------
  // ESTADO LOCAL: PRODUCTO, VARIANTE, CANTIDAD, UI Y RELACIONADOS
  // ------------------------------------------------------------------------
  const { slug } = useParams<{ slug: string }>();
  const decodedSlug = decodeURIComponent(slug || "");
  const {product, loading, error: productError, retry} = usePublishedProduct(decodedSlug);
  const [selectedVariant, setSelectedVariant] = useState<{ productId: string; id: string } | null>(null);
  const [selectedImage, setSelectedImage] = useState(0);
  const [quantity, setQuantity] = useState(1);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const { addToCart, items } = useCart();
  const [toastMessage, setToastMessage] = useState('');
  const [showToast, setShowToast] = useState(false);
  const [stockMessage, setStockMessage] = useState<string>('');
  const [isAdding, setIsAdding] = useState(false);
  const [showStickyCTA, setShowStickyCTA] = useState(true);

  // ------------------------------------------------------------------------
  // SLIDER PRINCIPAL DE IMÁGENES (KEEN-SLIDER)
  // ------------------------------------------------------------------------
  // keen-slider logic
  const [sliderRef, slider] = useKeenSlider<HTMLDivElement>({
    initial: 0,
    slideChanged(s) {
      setSelectedImage(s.track.details.rel);
    },
  });

  const { i18n, t } = useTranslation();
  const lang = i18n.language.startsWith("en") ? "en" : "es";

  // ------------------------------------------------------------------------
  // EFECTO: CARGA DEL PRODUCTO POR SLUG DESDE FIREBASE
  // ------------------------------------------------------------------------
  const options = product?.variants?.flatMap(variant => variant.options.map(option => ({
    ...option,
    variantLabel: variant.label[lang],
    variantId: option.variantId || `${variant.label.es || variant.label.en}-${option.value}`,
  }))) ?? [];
  // Keep only selection identity in state; stock always comes from the latest snapshot.
  const selectedOption = selectedVariant?.productId === product?.id
    ? options.find(option => option.variantId === selectedVariant?.id) ?? null
    : options.length === 1 ? options[0] : null;
  useEffect(() => { setQuantity(1); setSelectedVariant(null); }, [decodedSlug]);

  // ------------------------------------------------------------------------
  // EFECTO: BOTÓN SCROLL TO TOP SEGÚN POSICIÓN DE SCROLL
  // ------------------------------------------------------------------------
  useEffect(() => {
    const handleScroll = () => setShowScrollTop(window.scrollY > 500);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const scrollToTop = () => window.scrollTo({ top: 0, behavior: "smooth" });
  const scrollToBuyBlock = () => {
    const el = document.getElementById('buy-block');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleQuickBuy = async () => {
    if (!product || isOutOfStock) {
      setStockMessage('Sin stock disponible de esta opción');
      setShowToast(true);
      setTimeout(() => setShowToast(false), 2500);
      return;
    }
    // Requiere selección si existen variantes
    if (Array.isArray(product.variants) && product.variants.length > 0 && !selectedOption) {
      setStockMessage('Debes seleccionar una opción antes de continuar.');
      setShowToast(true);
      setTimeout(() => setShowToast(false), 2500);
      scrollToBuyBlock();
      return;
    }
    const availableStock = selectedOption?.stock ?? product.stockTotal ?? 0;
    const existingItem = items.find(
      (item) =>
        item.id === String(product.id) &&
        item.variantId === (selectedOption?.variantId || '')
    );
    const currentQuantityInCart = existingItem?.quantity || 0;
    const requestedTotal = currentQuantityInCart + quantity;
    if (requestedTotal > availableStock) {
      if (availableStock === 0) {
        setStockMessage('Sin stock disponible de esta opción');
      } else {
        setStockMessage(`Solo hay ${availableStock} unidades disponibles`);
      }
      setShowToast(true);
      setTimeout(() => setShowToast(false), 2500);
      return;
    }
    setIsAdding(true);
    const cartItem = {
      id: product.id,
      slug: product.slug || "",
      name: product.name,
      title: product.title,
      image: product.images?.[0] || '',
      quantity: quantity,
      priceUSD: selectedOption?.priceUSD ?? product.priceUSD,
      price: selectedOption?.priceUSD ?? product.priceUSD,
      variantLabel: selectedOption?.variantLabel,
      variantId: selectedOption?.variantId,
      stock: selectedOption?.stock,
      color: '',
    };
    const added = await addToCart(cartItem);
    if (!added) { setIsAdding(false); return; }
    toast.success(lang === 'en' ? 'Added to cart' : 'Agregado al carrito');
    scrollToTop();
    setTimeout(() => setIsAdding(false), 800);
  };
  // ------------------------------------------------------------------------
  // EFECTO: CONTROL DE STICKY CTA (MOBILE) SEGÚN VISIBILIDAD DEL BLOQUE DE COMPRA
  // ------------------------------------------------------------------------
  useEffect(() => {
    // En iOS desactivamos el observer para evitar posibles bugs de WebKit
    if (isIOS) {
      setShowStickyCTA(true); // dejamos siempre visible la barra inferior
      return;
    }

    const target = document.getElementById('buy-block');
    if (!target) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        // Hide sticky CTA when buy block is clearly visible
        setShowStickyCTA(!entry.isIntersecting || entry.intersectionRatio < 0.3);
      },
      { threshold: [0, 0.3, 1] }
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [product, selectedOption]);

  // ------------------------------------------------------------------------
  // ESTADOS DE CARGA Y PRODUCTO NO ENCONTRADO
  // ------------------------------------------------------------------------
  if (loading) return <div className="p-10">Cargando producto...</div>;
  if (productError) return <div role="alert" className="p-10">{productError}<button onClick={retry} className="underline ml-2">Reintentar</button><Link to="/shop" className="block underline">Volver a la tienda</Link></div>;
  if (!product) return (
    <div className="p-10 text-center">
      <h1 className="text-2xl font-bold mb-4">Producto no disponible</h1>
      <Link to="/shop" className="text-[#FF2D55] underline">Volver a la tienda</Link>
    </div>
  );

  const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);

  // Determine description to show
  let productDescription = typeof product.description === "object"
    ? product.description?.[lang] || ""
    : product.description || "";

  const totalStock = typeof product.stockTotal === 'number' ? product.stockTotal : 0;
  const isOutOfStock = product.active !== true || (selectedOption ? (selectedOption.stock ?? 0) <= 0 : totalStock <= 0);

  return (
    <div className="bg-gradient-to-b from-[#fafafa] to-white min-h-[100dvh] flex flex-col">
      <div className="w-full overflow-x-hidden text-black relative z-10 flex-grow">
        <ProductReservationNotice hasReservations={product.hasWebReservations === true} />
     {/* ================================================================== */}
     {/* === SEO / METADATOS DEL PRODUCTO (HELMET + JSON-LD) ============ */}
     {/* ================================================================== */}
        <Helmet>
          <title>{`${product.title?.[lang] || product.title} | Mutter Games`}</title>
          <meta
            name="description"
            content={
              typeof product.description === 'object'
                ? product.description?.[lang] || 'Producto original disponible en Mutter Games.'
                : product.description || 'Producto original disponible en Mutter Games.'
            }
          />
          <meta property="og:title" content={`${product.title?.[lang] || product.title} | Mutter Games`} />
          <meta
            property="og:description"
            content={
              typeof product.description === 'object'
                ? product.description?.[lang] || 'Producto original disponible en Mutter Games.'
                : product.description || 'Producto original disponible en Mutter Games.'
            }
          />
          <meta property="og:type" content="product" />
          <meta property="og:image" content={product.images?.[0] || "/seo-image.jpg"} />
          <meta property="og:url" content={typeof window !== "undefined" ? window.location.href : ""} />
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content={`${product.title?.[lang] || product.title} | Mutter Games`} />
          <meta
            name="twitter:description"
            content={
              typeof product.description === 'object'
                ? product.description?.[lang] || 'Producto original disponible en Mutter Games.'
                : product.description || 'Producto original disponible en Mutter Games.'
            }
          />
          <meta name="twitter:image" content={product.images?.[0] || "/seo-image.jpg"} />
          {/* JSON-LD: Product schema for SEO (desactivado en iOS por ahora) */}
          {!isIOS && (
            <script type="application/ld+json">{JSON.stringify({
              "@context": "https://schema.org",
              "@type": "Product",
              "name": (product.title?.[lang] || product.title) || "",
              "description": typeof product.description === 'object'
                ? (product.description?.[lang] || "Producto original disponible en Mutter Games.")
                : (product.description || "Producto original disponible en Mutter Games."),
              "image": Array.isArray(product.images) && product.images.length ? product.images : ["/seo-image.jpg"],
              "sku": String(product.id || product.slug || ""),
              "brand": { "@type": "Brand", "name": "Mutter Games" },
              "category": product.category?.name || "Coleccionables",
              "url": typeof window !== "undefined" ? window.location.href : "",
              "offers": {
                "@type": "Offer",
                "priceCurrency": "UYU",
                "price": (selectedOption?.priceUSD ?? product.variants?.[0]?.options?.[0]?.priceUSD ?? product.priceUSD) || 0,
                "availability": totalStock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
                "url": typeof window !== "undefined" ? window.location.href : ""
              }
            })}</script>
          )}
        </Helmet>

        {/* Barra de navegación superior específica de ProductPage */}
        <ProductPageNavbar />

    {/* ================================================================== */}
    {/* === LAYOUT PRINCIPAL: GALERÍA + DETALLES DEL PRODUCTO ========== */}
    {/* ================================================================== */}
        <div className="container mx-auto p-4 mt-20">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
    {/* ---------------------------------------------------------------- */}
    {/* COLUMNA IZQUIERDA: GALERÍA DE IMÁGENES ======================== */}
    {/* ---------------------------------------------------------------- */}
          <div className="flex flex-col gap-4">
            {product.images?.length ? (
              isIOS ? (
                // En iOS mostramos solo una imagen estática, sin slider ni miniaturas
                <div className="relative rounded-lg overflow-hidden">
                  <img
                    src={product.images[0]}
                    alt="Imagen principal"
                    className="object-contain max-h-[400px] w-full select-none"
                    draggable="false"
                  />
                </div>
              ) : (
                <>
                  <div className="relative">
                    {product.images?.length > 1 && (
                      <>
                        <button
                          onClick={() => slider.current?.prev()}
                          className="absolute top-1/2 left-2 -translate-y-1/2 z-20 bg-white/80 hover:bg-white rounded-full p-2 shadow-md md:block hidden"
                        >
                          <ChevronLeft size={24} className="text-black hover:text-[#FF2D55] transition" />
                        </button>
                        <button
                          onClick={() => slider.current?.next()}
                          className="absolute top-1/2 right-2 -translate-y-1/2 z-20 bg-white/80 hover:bg-white rounded-full p-2 shadow-md md:block hidden"
                        >
                          <ChevronLeft size={24} className="text-black hover:text-[#FF2D55] transition rotate-180" />
                        </button>
                      </>
                    )}
                    <div
                      ref={sliderRef}
                      className="keen-slider rounded-lg overflow-hidden"
                    >
                      {product.images.map((img: string, i: number) => (
                        <div key={i} className="keen-slider__slide">
                          <img
                            src={img}
                            alt={`Imagen ${i}`}
                            className="object-contain max-h-[400px] w-full select-none"
                            draggable="false"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                  {product.images.length > 1 && (
                    <div className="flex gap-2 overflow-x-auto pt-4">
                      {product.images.map((img: string, i: number) => (
                        <button
                          key={i}
                          onClick={() => slider.current?.moveToIdx(i)}
                          className={`w-20 h-20 rounded-md border ${selectedImage === i ? "border-gray-900" : "border-gray-300"} hover:ring-1 hover:ring-gray-900/20`}
                        >
                          <img src={img} alt={`Miniatura ${i}`} className="object-cover w-full h-full" />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )
            ) : (
              <div className="bg-gray-100 h-[450px] w-full rounded-lg flex flex-col items-center justify-center text-gray-400">
                <div className="text-4xl">📦</div>
                <p>No hay imagen</p>
              </div>
            )}
          </div>

    {/* ---------------------------------------------------------------- */}
    {/* COLUMNA DERECHA: DETALLES, VARIANTES Y COMPRA ================= */}
    {/* ---------------------------------------------------------------- */}
          {/* Detalles producto */}
          <div className="flex flex-col">
            {/* Categoría + título principal del producto */}
            {/* Eyebrow categoría */}
            {/* Eyebrow categoría */}
            <div className="text-xs uppercase tracking-[0.12em] text-gray-500 font-semibold mb-2">
              {product.category?.name || "Categoría"}
            </div>
            <h1 className="text-4xl md:text-5xl font-black tracking-tight leading-[1.05] mb-4">
              {product.title?.[lang]}
            </h1>
            {/* Precio principal (formateado) */}
            <div className="mt-2 sm:mt-4 mb-6">
              {(() => {
                const precio = selectedOption?.priceUSD ?? product.variants?.[0]?.options?.[0]?.priceUSD ?? product.priceUSD;
                // Formatear el precio en formato '3.700,00' (o similar)
                const entero = Math.floor(precio).toLocaleString("es-AR");
                const decimal = precio.toFixed(2).split(".")[1];
                const formattedPrice = `${entero},${decimal}`;
                return (
                  <div className="flex items-start">
                    <span className="text-4xl font-extrabold leading-none">
                      ${formattedPrice.split(',')[0]}
                    </span>
                    <sup className="text-sm font-semibold ml-0.5 align-[0.1em]">
                      {formattedPrice.split(',')[1]}
                    </sup>
                  </div>
                );
              })()}
            </div>
            {/* Badge y confianza: MercadoLibre / Mercado Pago */}
            <div className="mb-4">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-3">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center justify-center w-7 h-7 text-[11px] font-extrabold rounded bg-white text-[#323271] border border-[#323271]">ML</span>
                  <div className="text-gray-900">
                    <p className="text-sm font-semibold leading-snug">Somos los de MercadoLibre</p>
                    <div className="flex flex-col md:flex-row md:items-center md:gap-2">
                      <p className="text-xs text-gray-600 leading-snug">4.9⭐ +3.000 ventas</p>
                      <p className="text-xs text-gray-600 leading-snug flex items-center gap-1">
                        <Lock className="w-3.5 h-3.5" />
                        Compra protegida con Mercado Pago
                      </p>
                    </div>
                  </div>
                </div>
                <a
                  href="https://www.mercadolibre.com.uy/pagina/lilipres?utm_source=web_mutter&amp;utm_medium=referral&amp;utm_campaign=badge_ml_pdp"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-semibold underline underline-offset-2 hover:opacity-80"
                >
                  Ver perfil ↗
                </a>
              </div>
            </div>
            {/* Subtítulo opcional del producto */}
            {product.subtitle && <p className="text-gray-600 mb-4">{product.subtitle}</p>}

            {/* Cápsulas */}
            <div className="flex flex-col space-y-2 mt-6">
              {/* Selección de variantes (talles/ediciones/etc.) */}
              {/* Opciones de variante multilenguaje y precio */}
              {Array.isArray(product.variants) && product.variants.length > 0 && (
                <div className="mb-6">
                  {product.variants.map((variant, vIndex) => (
                    <div key={vIndex} className="mb-4">
                      <h3 className="uppercase text-sm font-semibold text-gray-800 mb-1">
                        {variant.label?.[lang] || "Opción"}
                      </h3>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {variant.options.map((option, oIndex) => (
                          <button
                            key={oIndex}
                            onClick={() => {
                              setSelectedVariant({ productId: product.id, id: option.variantId || `${variant.label.es || variant.label.en}-${option.value}` });
                            }}
                            className={`px-4 py-2 rounded-md border ${
                              selectedOption?.variantId === (option.variantId || `${variant.label.es || variant.label.en}-${option.value}`)
                                ? "bg-black text-white border-black"
                                : "bg-white text-black border-gray-300"
                            } hover:shadow-md transition`}
                          >
                            {option.value}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Selector de cantidad */}
            {/* Cantidad */}
            <div className="flex flex-col space-y-2 mt-6">
              <label className="uppercase text-sm font-semibold text-gray-800">Cantidad</label>
              <div className="flex w-fit border border-gray-200 rounded-lg overflow-hidden">
                <button onClick={() => quantity > 1 && setQuantity(quantity - 1)} className="px-3 bg-white hover:bg-gray-50">
                  <FiMinus />
                </button>
                <div className="px-4 py-2">{quantity}</div>
                <button onClick={() => setQuantity(quantity + 1)} className="px-3 bg-gray-100 hover:bg-gray-200">
                  <FiPlus />
                </button>
              </div>
            </div>

            {/* Mensaje de stock disponible por variante */}
            {selectedOption && typeof selectedOption.stock === 'number' && (
  <div className="mt-2 text-sm text-gray-600">
    {selectedOption.stock > 0 ? (
      <>🟢 En stock: {selectedOption.stock} unidad{selectedOption.stock > 1 ? 'es' : ''}</>
    ) : (
      <>🔴 Sin stock</>
    )}
  </div>
)}
            {/* Beneficios clave (cuotas, envío, retiro, WhatsApp) */}
            <hr className="my-6 border-gray-100" />
            {/* Trust row (beneficios clave) */}
            <div className="mt-3 mb-2 text-sm text-gray-900 flex flex-wrap items-center justify-start gap-3 md:gap-6">
              <div className="inline-flex items-center gap-2">
                <CreditCard className="w-4 h-4 opacity-80" />
                <span className="font-medium">Cuotas con Mercado Pago</span>
              </div>
              <span className="hidden md:block h-4 w-px bg-gray-300/80" />
              <div className="inline-flex items-center gap-2">
                <Truck className="w-4 h-4 opacity-80" />
                <span className="font-medium">Envío 24–48 h</span>
              </div>
              <span className="hidden md:block h-4 w-px bg-gray-300/80" />
              <div className="inline-flex items-center gap-2">
                <Store className="w-4 h-4 opacity-80" />
                <span className="font-medium">Retiro hoy</span>
              </div>
              <span className="hidden md:block h-4 w-px bg-gray-300/80" />
              <div className="inline-flex items-center gap-2">
                <MessageSquare className="w-4 h-4 opacity-80" />
                <span className="font-medium">WhatsApp 1–3 min</span>
              </div>
            </div>

            {/* Info de envíos (estática) */}
            <div className="mt-2 text-sm text-gray-800 flex items-center gap-2">
              <Truck className="w-4 h-4" />
              <span><strong>Entregas en Montevideo $169</strong> · Envíos al interior por DAC</span>
            </div>

            {/* Bloque de compra (CTA principal) */}
            <ProductPurchaseActions placement="main" lang={lang} priceUSD={selectedOption?.priceUSD ?? product.priceUSD}
              isOutOfStock={isOutOfStock} isAdding={isAdding} onBuy={handleQuickBuy} />


          </div>
        </div>

  {/* ================================================================== */}
  {/* === DESCRIPCIÓN DETALLADA DEL PRODUCTO ========================= */}
  {/* ================================================================== */}
        {/* Descripción del producto (al final, ancho completo) */}
        {productDescription && (
          <div
            className="prose prose-blue prose-lg max-w-none mb-8 text-gray-800 [&>p]:mb-4 [&>h2]:mt-8 [&>ul]:mb-4 [&>ul>li]:mb-2"
            dangerouslySetInnerHTML={{ __html: productDescription }}
          />
        )}

  {/* ================================================================== */}
  {/* === PRODUCTOS RELACIONADOS ===================================== */}
  {/* ================================================================== */}
        {product && (
          <RelatedProducts
            excludeSlugs={[product.slug || ""]}
            categoryName={product.category?.name}
            title="También te podría interesar"
          />
        )}

  {/* ================================================================== */}
  {/* === BOTÓN SCROLL TO TOP ======================================== */}
  {/* ================================================================== */}
        {/* Scroll top */}
        {showScrollTop && (
          <button onClick={scrollToTop} className="fixed bottom-20 right-6 p-3 bg-black text-white rounded-full shadow-lg z-50 hover:bg-[#FF2D55] transition">
            <ArrowUp size={24} />
          </button>
        )}

  {/* ================================================================== */}
  {/* === TOAST DE ERRORES DE STOCK / VALIDACIONES =================== */}
  {/* ================================================================== */}
        {/* Toast notification for stock limit and errors */}
        {showToast && (
          <div className="fixed top-4 left-1/2 transform -translate-x-1/2 bg-red-500 bg-opacity-90 text-white text-sm px-4 py-2 rounded shadow-md max-w-[90%] z-50 flex items-center gap-2">
            <HiExclamationCircle className="w-4 h-4" />
            {stockMessage}
          </div>
        )}

  {/* ================================================================== */}
  {/* === STICKY CTA (MOBILE) PARA COMPRA RÁPIDA ===================== */}
  {/* ================================================================== */}
        {/* Sticky CTA (mobile) */}
        {showStickyCTA && !isOutOfStock && (
          <ProductPurchaseActions placement="sticky" lang={lang}
            priceUSD={selectedOption?.priceUSD ?? product.variants?.[0]?.options?.[0]?.priceUSD ?? product.priceUSD}
            isOutOfStock={isOutOfStock} isAdding={isAdding} onBuy={handleQuickBuy} />
        )}
        {/* Spacer para no tapar contenido con la Sticky CTA en mobile */}
        <div className="h-16 md:hidden" />
        </div> {/* cierra container mx-auto */}

      </div>
      <Footer variant="light" />
    </div>
  );
}
