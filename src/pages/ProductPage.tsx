import { ProductReservationNotice } from '../components/product/ProductReservationNotice';
import { ProductPurchaseActions } from '../components/product/ProductPurchaseActions';
//src/pages/ProductPage.tsx

import { useParams, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import ProductPageNavbar from "../components/ProductPageNavbar";
import PublicGuestPurchase from "../components/PublicGuestPurchase";
import { usePublishedProduct } from "../hooks/usePublishedProduct";
import { useCart } from "../context/CartContext";
import { ChevronLeft, ArrowUp, CreditCard, Truck, Store } from "lucide-react";
import { FiMinus, FiPlus } from "react-icons/fi";
import RelatedProducts from "../components/RelatedProducts";
import Footer from "../components/Footer";
import { useTranslation } from "react-i18next";
import { HiExclamationCircle } from "react-icons/hi";
import { toast } from "react-hot-toast";
import ProductGallery from "../components/product/ProductGallery";
import ProductDescription from "../components/product/ProductDescription";
import { selectProductDescription, productDescriptionText } from "../domain/productDescription";
import "./product-detail.css";
import "./product-shop.css";

// Preserve the existing WebKit protection for the mobile purchase observer.
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
  const [quantity, setQuantity] = useState(1);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const { addToCart, items } = useCart();
  const [showToast, setShowToast] = useState(false);
  const [stockMessage, setStockMessage] = useState<string>('');
  const [isAdding, setIsAdding] = useState(false);
  const [showStickyCTA, setShowStickyCTA] = useState(true);

  const { i18n } = useTranslation();
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

  const productDescription = selectProductDescription(product.description, lang);
  const descriptionSummary = productDescriptionText(productDescription);
  const totalStock = typeof product.stockTotal === 'number' ? product.stockTotal : 0;
  const isOutOfStock = product.active !== true || (selectedOption ? (selectedOption.stock ?? 0) <= 0 : totalStock <= 0);
  const title = product.title?.[lang] || product.title?.es || product.name;
  const displayPrice = selectedOption?.priceUSD ?? product.variants?.[0]?.options?.[0]?.priceUSD ?? product.priceUSD;
  const formattedPrice = displayPrice.toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="product-detail-page">
      <Helmet>
        <title>{title} | Mutter Games</title>
        <meta name="description" content={descriptionSummary || 'Producto original disponible en Mutter Games.'} />
        <meta property="og:title" content={`${title} | Mutter Games`} />
        <meta property="og:description" content={descriptionSummary || 'Producto original disponible en Mutter Games.'} />
        <meta property="og:type" content="product" />
        <meta property="og:image" content={product.images?.[0] || "/seo-image.jpg"} />
        <meta property="og:url" content={typeof window !== "undefined" ? window.location.href : ""} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={`${title} | Mutter Games`} />
        <meta name="twitter:description" content={descriptionSummary || 'Producto original disponible en Mutter Games.'} />
        <meta name="twitter:image" content={product.images?.[0] || "/seo-image.jpg"} />
        {!isIOS && <script type="application/ld+json">{JSON.stringify({
          "@context": "https://schema.org", "@type": "Product", name: title,
          description: descriptionSummary || "Producto original disponible en Mutter Games.",
          image: product.images?.length ? product.images : ["/seo-image.jpg"],
          sku: String(product.id || product.slug || ""), brand: { "@type": "Brand", name: "Mutter Games" },
          category: product.category?.name || "Coleccionables",
          url: typeof window !== "undefined" ? window.location.href : "",
          offers: { "@type": "Offer", priceCurrency: "UYU", price: displayPrice || 0,
            availability: totalStock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
            url: typeof window !== "undefined" ? window.location.href : "" }
        })}</script>}
      </Helmet>
      <ProductPageNavbar />
      <PublicGuestPurchase inLayout />

      <main className="product-detail-main">
        <nav className="product-detail-breadcrumb" aria-label="Ubicación">
          <Link to="/shop"><ChevronLeft size={16} aria-hidden="true" /> Volver al catálogo</Link>
        </nav>

        <div className="product-detail-overview">
          <header className="product-detail-heading">
            {product.category?.name && <p className="product-detail-category">{product.category.name}</p>}
            <h1>{title}</h1>
            {product.subtitle && <p className="product-detail-subtitle">{product.subtitle}</p>}
          </header>

          <ProductGallery key={product.id} images={product.images} title={title} />

          <div className="product-detail-purchase">
            <p className="product-detail-price">${formattedPrice}</p>

            {Array.isArray(product.variants) && product.variants.length > 0 && (
              options.length === 1
                ? <p className="product-detail-single-option">{options[0].value}</p>
                : <div className="product-detail-variants">
                  {product.variants.map((variant, vIndex) => (
                    <fieldset key={vIndex}>
                      <legend>{variant.label?.[lang] || "Opción"}</legend>
                      <div className="product-detail-options">
                        {variant.options.map((option, oIndex) => (
                          <button key={oIndex} type="button"
                            aria-pressed={selectedOption?.variantId === (option.variantId || `${variant.label.es || variant.label.en}-${option.value}`)}
                            onClick={() => setSelectedVariant({ productId: product.id, id: option.variantId || `${variant.label.es || variant.label.en}-${option.value}` })}>
                            {option.value}
                          </button>
                        ))}
                      </div>
                    </fieldset>
                  ))}
                </div>
            )}

            <ProductReservationNotice hasReservations={product.hasWebReservations === true} />
            <p className={`product-detail-availability ${isOutOfStock ? 'is-unavailable' : ''}`} role="status">
              <span aria-hidden="true" />
              {isOutOfStock ? (lang === 'en' ? 'Out of stock' : 'Sin stock')
                : selectedOption && typeof selectedOption.stock === 'number'
                  ? `En stock: ${selectedOption.stock} unidad${selectedOption.stock > 1 ? 'es' : ''}`
                  : (lang === 'en' ? 'In stock' : 'En stock')}
            </p>

            <div className="product-detail-quantity">
              <span id="product-quantity-label">Cantidad</span>
              <div role="group" aria-labelledby="product-quantity-label">
                <button type="button" aria-label="Restar una unidad" disabled={quantity <= 1}
                  onClick={() => quantity > 1 && setQuantity(quantity - 1)}><FiMinus aria-hidden="true" /></button>
                <output aria-live="polite" aria-label="Cantidad seleccionada">{quantity}</output>
                <button type="button" aria-label="Sumar una unidad"
                  onClick={() => setQuantity(quantity + 1)}><FiPlus aria-hidden="true" /></button>
              </div>
            </div>

            <ProductPurchaseActions placement="main" lang={lang} priceUSD={selectedOption?.priceUSD ?? product.priceUSD}
              isOutOfStock={isOutOfStock} isAdding={isAdding} onBuy={handleQuickBuy} />

            <ul className="product-detail-delivery" aria-label="Pago y entrega">
              <li><CreditCard size={18} aria-hidden="true" /><span>Cuotas con Mercado Pago</span></li>
              <li><Truck size={18} aria-hidden="true" /><span>Montevideo $169 · Interior por DAC</span></li>
              <li><Store size={18} aria-hidden="true" /><span>Retiro disponible</span></li>
            </ul>

            <a className="product-detail-trust"
              href="https://www.mercadolibre.com.uy/pagina/lilipres?utm_source=web_mutter&amp;utm_medium=referral&amp;utm_campaign=badge_ml_pdp"
              target="_blank" rel="noopener noreferrer">
              <span className="product-detail-trust__mark" aria-hidden="true">ML</span>
              <span className="product-detail-trust__copy">
                <strong>Somos los de Mercado Libre</strong>
                <span>Conocé nuestro perfil y reputación.</span>
                <span className="product-detail-trust__link">Ver perfil <span aria-hidden="true">↗</span>
                  <span className="sr-only"> (se abre en otra pestaña)</span>
                </span>
              </span>
            </a>
          </div>
        </div>

        <ProductDescription description={productDescription} />
        <div className="product-detail-related">
          <RelatedProducts excludeSlugs={[product.slug || ""]} categoryName={product.category?.name}
            title="También te podría interesar" cardPresentation="catalog" />
        </div>

        {showScrollTop && <button onClick={scrollToTop} aria-label="Volver arriba"
          className="product-detail-scroll-top"><ArrowUp size={22} aria-hidden="true" /></button>}
        {showToast && <div role="alert" className="product-detail-toast">
          <HiExclamationCircle aria-hidden="true" />{stockMessage}
        </div>}
      </main>

      {showStickyCTA && !isOutOfStock && (
        <ProductPurchaseActions placement="sticky" lang={lang}
          priceUSD={selectedOption?.priceUSD ?? product.variants?.[0]?.options?.[0]?.priceUSD ?? product.priceUSD}
          isOutOfStock={isOutOfStock} isAdding={isAdding} onBuy={handleQuickBuy} />
      )}
      <Footer variant="light" />
    </div>
  );
}
