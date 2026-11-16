// src/components/ProductCard.tsx

import { Link } from "react-router-dom";
import { Product } from "../data/types";
import { getCatalogDisplayPrice } from "../domain/shopSelection";
import { formatCartAmount } from "../utils/cartPresentation";

import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";

type ProductCardProps = {
  product: Product;
  className?: string;
  imgClassName?: string;
  presentation?: "default" | "catalog";
};

export default function ProductCard({ product, className, imgClassName, presentation = "default" }: ProductCardProps) {
  // Asegurarnos de que tenemos un slug limpio y válido
  const safeSlug = product.slug ? encodeURIComponent(product.slug) : `product-${product.id}`;

  // Construir la ruta al detalle del producto con el ID para evitar problemas de coincidencia de slug
  const productDetailUrl = `/producto/${safeSlug}`;

  // Obtener la imagen principal, asegurando que existe
  const productImage = (product.images && product.images.length > 0 ? product.images[0] : "");

  const { i18n } = useTranslation();
  const language = i18n.language as "en" | "es";

  const productName = typeof product.title === "string"
    ? product.title
    : product.title?.[language] || product.name || "Sin título";

  const productSubtitle = (typeof product.subtitle === "string")
    ? product.subtitle
    : (typeof product.subtitle === "object" && product.subtitle !== null)
      ? product.subtitle[language] || ""
      : "";

  const productPriceUSD = getCatalogDisplayPrice(product);

  if (presentation === "catalog") {
    return (
      <article className={`shop-product-card ${className || ""}`}>
        <Link to={productDetailUrl} className="shop-product-link">
          <div className="shop-product-image">
            <img
              src={productImage}
              alt={productName}
              className={imgClassName}
              loading="lazy"
              decoding="async"
              onError={(event) => {
                const image = event.currentTarget;
                const fallback = new URL("/images/placeholder.jpg", image.ownerDocument.baseURI).href;
                if (image.src !== fallback) image.src = "/images/placeholder.jpg";
              }}
            />
          </div>
          <div className="shop-product-copy">
            {productSubtitle && <p className="shop-product-subtitle">{productSubtitle}</p>}
            <h3 className="shop-product-title">{productName}</h3>
            <p className="shop-product-price">{formatCartAmount(productPriceUSD)}</p>
          </div>
        </Link>
      </article>
    );
  }

  const [wholePrice, fractionPrice = "00"] = productPriceUSD.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).split(".");

  const categoryBorderColors: { [key: string]: string } = {
    PURE: "ring-[#1D4ED8]",          // azul
    FUXION: "ring-[#0ea5e9]",        // celeste
    "DOUBLE WOODS": "ring-[#15803d]" // verde
  };
  const borderColor = categoryBorderColors[product.category?.name?.toUpperCase() || ""] || "ring-transparent";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      key={`product-card-${product.id}-${safeSlug}`} // Key único para evitar problemas de renderizado
      className={`relative ring-2 ring-offset-2 ${borderColor} rounded-2xl shadow transition-transform duration-300 hover:translate-y-[1px] ${className || ""}`}
    >
      <Link
        to={productDetailUrl}
        className="h-full flex flex-col justify-between group bg-white rounded-2xl overflow-hidden shadow-sm hover:shadow transition-shadow duration-300 relative"
      >
        <div className="aspect-[3/4] overflow-hidden flex items-center justify-center">
          <img
            src={productImage}
            alt={productName}
            className={`${imgClassName || "w-full h-full object-contain transition-transform duration-300 ease-out group-hover:scale-105"}`}
            loading="lazy"
            onError={(e) => {
              // Fallback para imágenes que no cargan
              e.currentTarget.src = "/images/placeholder.jpg";
            }}
          />
        </div>
        <div className="p-4">
          {productSubtitle && (
            <div className="text-sm text-gray-600 mb-1">{productSubtitle}</div>
          )}
          <div className="h-[48px] overflow-hidden">
            <h3 className="text-lg font-bold text-black leading-snug group-hover:text-black/80 transition line-clamp-2">
              {productName}
            </h3>
          </div>
          <div className="mt-2.5 flex items-baseline text-[1.15rem] md:text-lg font-semibold tracking-tight whitespace-nowrap">
            <span className="text-base font-medium">$</span>
            <span className="ml-0.5 font-mono tabular-nums">
              {wholePrice}
            </span>
            <span className="text-[0.7rem] relative -top-1.5 ml-0.5">
              {fractionPrice}
            </span>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
