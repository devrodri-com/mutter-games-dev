// src/pages/Shop.tsx

import React, { Suspense } from "react";
import { useTranslation } from "react-i18next";
import { Helmet } from "react-helmet-async";
import ProductCard from "../components/ProductCard";
import ShopNavbar from "../components/ShopNavbar";
import { Product, Category as BaseCategory } from "../data/types";
import type { Category } from "../data/types";

import { FiFilter } from "react-icons/fi";
import { FaFutbol, FaBasketballBall } from "react-icons/fa";
import { IoGameControllerOutline } from "react-icons/io5";
import { Gamepad } from "lucide-react";
import { TIPOS } from "@/constants/tipos";
import { motion } from "framer-motion";
import { ArrowUp } from "lucide-react";
import { Listbox } from "@headlessui/react";
import { ChevronDownIcon, CheckIcon } from "@heroicons/react/20/solid";
import { Fragment } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence } from "framer-motion";
import { Rocket } from "lucide-react";
import ProductSkeleton from "../components/ProductSkeleton";
import SidebarFilter from "../components/SidebarFilter";
import MobileFilterDrawer from "../components/MobileFilterDrawer";
import Footer from "../components/Footer";
import { useShopProducts } from "../hooks/useShopProducts";

// ============================================================================
// === TIPOS LOCALES ==========================================================
// ============================================================================
// Define un tipo para productos locales
type LocalProduct = Product & {
  active?: boolean;
  category?: {
    id: string;
    name: string;
  };
  subcategory?: {
    id: string;
    name: string;
  };
  tipo?: string | string[];
  price?: number;
};

type SortOption = "" | "priceAsc" | "priceDesc" | "az" | "za";

// ============================================================================
// === COMPONENTE PRINCIPAL: SHOP ============================================
// ============================================================================
export default function Shop() {
  const { t } = useTranslation();

  // ========================================================================
  // === HOOK PRINCIPAL: ESTADO Y DATOS DE SHOP ============================
  // ========================================================================
  // Usar hook para toda la lógica de estado y datos
  const {
    // Estado de paginación
    hasMore,
    isInitialLoad,
    isLoadingPage,
    loading,
    isSearchMode,

    // Filtros
    searchTerm,
    setSearchTerm,
    selectedCategory,
    setSelectedCategory,
    selectedSubcategory,
    setSelectedSubcategory,
    selectedType,
    setSelectedType,

    // Orden
    sortOption,
    setSortOption,
    selectedOrderMobile,
    showOrderMenuMobile,
    setShowOrderMenuMobile,
    handleOrderChangeMobile,

    // Productos procesados
    sortedProducts,
    sortedProductsMobile,
    productsToDisplay,
    availableTypes,

    // Categorías
    categories,
    handleCategoryClick,
    handleSubcategoryClick,

    // Funciones
    loadMore,

    // UI state
    isMobileView,
    showScrollTop,
    setShowScrollTop,
    isFilterOpen,
    setIsFilterOpen,
    showMobileFilter,
    setShowMobileFilter,

    // Legacy/helpers
    filterParam,
    isIOS,
    scrollToTop,
    handleFilterByType,
    setSearchParams,
  } = useShopProducts();

  // ========================================================================
  // === OPCIONES DE ORDEN Y HANDLERS ======================================
  // ========================================================================
  // Para el nuevo Listbox de mobile
  const sortOptions = [
    { value: "az", label: "Nombre: A-Z" },
    { value: "za", label: "Nombre: Z-A" },
    { value: "priceAsc", label: "Precio: Menor a Mayor" },
    { value: "priceDesc", label: "Precio: Mayor a Menor" },
  ];
  const selectedSort = sortOptions.find((o) => o.value === sortOption) || sortOptions[0];

  const handleSortChange = (option: { value: string; label: string }) => {
    setSortOption(option.value as SortOption);
  };

  const handleOpenFilters = () => setIsFilterOpen(true);

  // Banner dinámico según filtro (normalizando a mayúsculas)
  const normalizedFilter = filterParam.toUpperCase();

  // ========================================================================
  // === SKELETON INICIAL (CARGA) ==========================================
  // ========================================================================
  // Mostrar skeletons solo en carga inicial
  if (isInitialLoad && loading) {
    return (
      <section
        className="bg-[#f3f3f3] text-black min-h-screen flex flex-col"
        aria-busy="true"
        aria-live="polite"
      >
        <ShopNavbar />
        <div className="max-w-7xl mx-auto px-4 md:px-6 pt-[90px] md:pt-[110px] pb-10">
          {/* Mensaje de feedback claro */}
          <div className="mb-4">
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
              Cargando productos…
            </h1>
            <p className="text-sm text-gray-600 mt-1">
              Esto puede tardar un poco más la primera vez que abrís la tienda,
              dependiendo de la conexión y del navegador.
            </p>
          </div>

          {/* Grid de skeletons bien visible */}
          <div
            className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-6 sm:gap-8 mt-4 animate-pulse min-h-[60vh]"
            role="status"
          >
            {Array.from({ length: 24 }).map((_, index) => (
              <ProductSkeleton key={index} />
            ))}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-[#f9f9f9] text-black flex flex-col min-h-screen pt-[90px] md:pt-[110px]">
      <ShopNavbar />
      {/* ================================================================== */}
      {/* === SEO / METADATOS (HELMET) ==================================== */}
      {/* ================================================================== */}
      <Helmet>
        <title>Mutter Games – Tienda de videojuegos y coleccionables</title>
        <meta
          name="description"
          content="Juegos, consolas, retro y coleccionables. Productos originales, pago protegido con Mercado Pago y envíos a todo Uruguay."
        />
        <meta name="keywords" content="videojuegos, consolas, retro, coleccionables, PlayStation, Xbox, Nintendo, Uruguay" />
        <link rel="canonical" href="/shop" />

        <meta property="og:title" content="Mutter Games – Tienda de videojuegos y coleccionables" />
        <meta
          property="og:description"
          content="Juegos, consolas, retro y coleccionables. Productos originales, pago protegido con Mercado Pago y envíos a todo Uruguay."
        />
        <meta property="og:image" content="/seo-image.jpg" />
        <meta property="og:url" content="/shop" />
        <meta property="og:type" content="website" />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Mutter Games – Tienda de videojuegos y coleccionables" />
        <meta
          name="twitter:description"
          content="Juegos, consolas, retro y coleccionables. Productos originales, pago protegido con Mercado Pago y envíos a todo Uruguay."
        />
        <meta name="twitter:image" content="/seo-image.jpg" />
      </Helmet>

      <div className="md:grid md:grid-cols-[250px_1fr] max-w-7xl mx-auto px-4 md:px-6 gap-8 overflow-x-hidden">
        {/* ================================================================== */}
        {/* === SIDEBAR (DESKTOP) ========================================== */}
        {/* ================================================================== */}
        {/* Sidebar */}
        <motion.aside
          className="hidden md:block space-y-6 pr-6 border-r border-gray-200"
          initial={{ x: -20, opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          transition={{ duration: 0.5 }}
        >
          <div>
            <label className="block font-semibold text-sm mb-2" htmlFor="search">
              Buscar por nombre
            </label>
            <input
              id="search"
              type="text"
              placeholder={t("shop.searchPlaceholder", "Ej: GTA 5")}
              className="w-full border px-3 py-2 rounded-lg text-sm text-black placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-[#FF2D55] focus:border-[#FF2D55]"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* SidebarFilter con props para filtro de categoría y subcategoría */}
          <SidebarFilter
            categories={categories}
            selectedCategory={selectedCategory}
            setSelectedCategory={setSelectedCategory}
            selectedSubcategory={selectedSubcategory}
            setSelectedSubcategory={setSelectedSubcategory}
            // --- PATCH: resaltar nombre de categoría principal en SidebarFilter ---
            renderCategoryName={(category: Category) => <p className="font-bold">{category.name}</p>}
          />

          {/* Filtro por tipo (diseño estilizado) */}
          <div className="mt-6">
            <h3 className="text-sm font-bold uppercase text-black mb-2 flex items-center gap-2">
              <Gamepad className="w-4 h-4" />
              Tipo de producto
            </h3>
            <div className="flex flex-col gap-2">
              <button
                className={`px-3 py-1.5 rounded-full text-sm font-medium border border-gray-300 transition ${
                  selectedType === "" || selectedType === "Todos" ? "bg-black text-white border-black" : "bg-white text-black hover:bg-gray-50"
                }`}
                onClick={() => setSelectedType("Todos")}
              >
                Todos
              </button>
              {TIPOS.map((type) => (
                <button
                  key={type}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium border border-gray-300 transition ${
                    selectedType === type ? "bg-black text-white border-black" : "bg-white text-black hover:bg-gray-50"
                  }`}
                  onClick={() => setSelectedType(type)}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>
        </motion.aside>

        {/* Contenido principal - Productos */}
        {/* ================================================================== */}
        {/* === CONTENIDO PRINCIPAL: LISTA DE PRODUCTOS ==================== */}
        {/* ================================================================== */}
        <main>
          {/* === HEADER DESKTOP (TÍTULO, CONTADOR, QUITAR FILTROS, ORDEN) === */}
          {/* Desktop view */}
          <div className="flex items-center justify-between mb-4 hidden md:flex">
            <div>
              <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">
                {searchTerm
                  ? t("shop.resultsFor", { search: searchTerm, defaultValue: 'Resultados para "{{search}}"', searchTerm })
                  : filterParam === "NBA"
                  ? t("shop.nba", "NBA")
                  : filterParam === "FUTBOL"
                  ? t("shop.soccer", "Fútbol")
                  : "Productos disponibles"}
              </h1>
              <p className="text-sm text-gray-500 mt-1">{productsToDisplay.length} productos encontrados</p>
              {searchTerm && (
                <button
                  onClick={() => {
                    setSearchTerm("");
                    setSelectedCategory("");
                    setSelectedSubcategory("");
                    setSelectedType("Todos");
                    setSortOption("");
                    if (!isIOS) setSearchParams({}, { replace: true });
                  }}
                  className="mt-2 text-sm font-semibold text-gray-700 hover:text-black underline"
                >
                  Quitar filtros
                </button>
              )}
            </div>

            {/* Dropdown ordenar (desktop) */}
            <div className="flex justify-end items-center">
              <Listbox value={sortOption} onChange={setSortOption}>
                {({ open }) => (
                  <div className="relative w-52">
                    <Listbox.Button className="w-full cursor-pointer rounded-md border border-[#0F0F0F] bg-white py-2 pl-4 pr-10 text-left shadow-sm focus:outline-none focus:ring-1 text-sm flex justify-between items-center text-[#0F0F0F] focus:ring-[#FF2D55] focus:border-[#FF2D55]">
                      <span>
                        {{
                          "": "Ordenar por",
                          priceAsc: "Precio: Menor a Mayor",
                          priceDesc: "Precio: Mayor a Menor",
                          az: "Nombre: A-Z",
                          za: "Nombre: Z-A",
                        }[sortOption] || "Ordenar por"}
                      </span>
                      <ChevronDownIcon className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
                    </Listbox.Button>
                    <Listbox.Options className="absolute right-0 mt-1 max-w-[240px] w-full rounded-md bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none z-50 text-sm overflow-hidden whitespace-nowrap">
                      {[
                        { value: "", label: "Ordenar por" },
                        { value: "priceAsc", label: "Precio: Menor a Mayor" },
                        { value: "priceDesc", label: "Precio: Mayor a Menor" },
                        { value: "az", label: "Nombre: A-Z" },
                        { value: "za", label: "Nombre: Z-A" },
                      ].map((option) => (
                        <Listbox.Option
                          key={option.value}
                          className={({ active, selected }) =>
                            `cursor-pointer select-none relative py-2 pl-10 pr-4
                            ${selected ? "bg-[#FF2D55] text-white font-bold" : ""}
                            ${active && !selected ? "hover:bg-[#FF2D55]/90 hover:text-white" : ""}
                            ${!selected && !active ? "text-[#0F0F0F]" : ""}`
                          }
                          value={option.value}
                        >
                          {({ selected }) => (
                            <>
                              <span className={`block truncate`}>{option.label}</span>
                              {selected && (
                                <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-white">
                                  <CheckIcon className="h-4 w-4" />
                                </span>
                              )}
                            </>
                          )}
                        </Listbox.Option>
                      ))}
                    </Listbox.Options>
                  </div>
                )}
              </Listbox>
            </div>
          </div>

          {/* === HEADER MOBILE (TÍTULO + CONTADOR) ========================= */}
          {/* Mobile view */}
          <div className="block md:hidden mb-4">
            <div>
              <h1 className="text-2xl md:text-4xl font-extrabold tracking-tight">
                {searchTerm
                  ? t("shop.resultsFor", { search: searchTerm, defaultValue: 'Resultados para "{{search}}"', searchTerm })
                  : filterParam === "NBA"
                  ? t("shop.nba", "NBA")
                  : filterParam === "FUTBOL"
                  ? t("shop.soccer", "Fútbol")
                  : "Productos disponibles"}
              </h1>
              <p className="text-sm text-gray-500 mt-1">{productsToDisplay.length} productos encontrados</p>
              {searchTerm && (
                <button
                  onClick={() => {
                    setSearchTerm("");
                    setSelectedCategory("");
                    setSelectedSubcategory("");
                    setSelectedType("Todos");
                    setSortOption("");
                    if (!isIOS) setSearchParams({}, { replace: true });
                  }}
                  className="mt-2 text-sm font-semibold text-gray-700 hover:text-black underline"
                >
                  Quitar filtros
                </button>
              )}
            </div>
          </div>

          {/* === CONTROLES MOBILE: FILTROS Y ORDENAR ======================= */}
          {/* MOBILE: Filtros y ordenar */}
          <div className="flex px-2 py-2 sm:hidden sticky top-[90px] z-40 bg-[#f9f9f9]">
            <div className="w-1/2 px-1">
              <button
                onClick={() => setShowMobileFilter(!showMobileFilter)}
                className="w-full border border-[#FF2D55] text-[#FF2D55] rounded-lg py-2 font-medium hover:bg-[#FF2D55] hover:text-white transition"
              >
                Filtros
              </button>
            </div>
            <div className="w-1/2 px-1">
              <button
                onClick={() => setShowOrderMenuMobile(!showOrderMenuMobile)}
                className="w-full border border-[#FF2D55] text-[#FF2D55] rounded-lg py-2 font-medium hover:bg-[#FF2D55] hover:text-white transition"
              >
                Ordenar
              </button>
              {isMobileView && showOrderMenuMobile && (
                <>
                  <div className="fixed inset-0 bg-black/10 z-40" onClick={() => setShowOrderMenuMobile(false)} />
                  <div className="absolute left-0 right-0 mt-2 bg-white border border-gray-300 rounded-lg shadow-lg z-50">
                    <button onClick={() => handleOrderChangeMobile("asc")} className="w-full text-left px-4 py-2 hover:bg-gray-100">
                      Precio: menor a mayor
                    </button>
                    <button onClick={() => handleOrderChangeMobile("desc")} className="w-full text-left px-4 py-2 hover:bg-gray-100">
                      Precio: mayor a menor
                    </button>
                    <button onClick={() => handleOrderChangeMobile("az")} className="w-full text-left px-4 py-2 hover:bg-gray-100">
                      A-Z
                    </button>
                    <button onClick={() => handleOrderChangeMobile("za")} className="w-full text-left px-4 py-2 hover:bg-gray-100">
                      Z-A
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* === PANEL FILTROS MOBILE (SIDEBAR COLLAPSIBLE) ================ */}
          {/* MOBILE: SidebarFilter collapsible panel */}
          {showMobileFilter && (
            <div className="md:hidden mt-4">
              <SidebarFilter
                categories={categories}
                selectedCategory={selectedCategory}
                setSelectedCategory={setSelectedCategory}
                selectedSubcategory={selectedSubcategory}
                setSelectedSubcategory={setSelectedSubcategory}
                renderCategoryName={(category: Category) => <p className="font-bold">{category.name}</p>}
              />
              {/* Bloque de "Tipo de Producto" para mobile */}
              {availableTypes.length > 0 && (
                <div className="mt-4">
                  <h3 className="text-lg font-bold mb-2">Tipo de Producto</h3>
                  <div className="space-y-1">
                    {availableTypes.map((type) => {
                      if (!type) return null;
                      return (
                        <label key={type} className="flex items-center space-x-2">
                          <input
                            type="radio"
                            name="product-type"
                            value={type}
                            checked={selectedType === type}
                            onChange={() => setSelectedType(type)}
                            className="form-radio"
                          />
                          <span className="text-sm">{type}</span>
                        </label>
                      );
                    })}
                    <label className="flex items-center space-x-2">
                      <input
                        type="radio"
                        name="product-type"
                        value="Todos"
                        checked={selectedType === "Todos"}
                        onChange={() => setSelectedType("Todos")}
                        className="form-radio"
                      />
                      <span className="text-sm">Todos</span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* === GRID DE PRODUCTOS + SKELETONS ============================= */}
          {/* Grid de productos */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 mt-6">
            <Suspense
              fallback={Array.from({ length: 8 }).map((_, index) => (
                <ProductSkeleton key={index} />
              ))}
            >
              {(isMobileView ? sortedProductsMobile : sortedProducts).length > 0 ? (
                <>
                  {(isMobileView ? sortedProductsMobile : sortedProducts).map((product: LocalProduct) => (
                    <ProductCard key={product.slug ?? product.id} product={product} />
                  ))}
                  
                  {/* Skeletons mientras carga más */}
                  {isLoadingPage && (
                    <>
                      {Array.from({ length: 8 }).map((_, index) => (
                        <ProductSkeleton key={`loading-${index}`} />
                      ))}
                    </>
                  )}
                </>
              ) : (
                <div className="col-span-full py-16 min-h-[300px] text-center space-y-4">
                  <p className="text-gray-500 font-medium max-w-xl mx-auto text-center">
                    No se encontraron productos con los filtros seleccionados.
                    <br />
                    <button
                      onClick={() => {
                        setSearchTerm("");
                        setSelectedCategory("");
                        setSelectedSubcategory("");
                        setSelectedType("Todos");
                        setSortOption("");
                        if (!isIOS) setSearchParams({}, { replace: true });
                      }}
                      className="text-red-600 hover:underline font-semibold mt-2 inline-block"
                    >
                      Mostrar todos los productos
                    </button>
                  </p>
                </div>
              )}
            </Suspense>
          </div>

          {/* === BOTÓN CARGAR MÁS (PAGINACIÓN) ============================ */}
          {/* Botón "Cargar más" (oculto en modo búsqueda global) */}
          {!isSearchMode && !isInitialLoad && hasMore && !isLoadingPage && (isMobileView ? sortedProductsMobile : sortedProducts).length > 0 && (
            <div className="flex justify-center mt-8 mb-8">
              <button
                onClick={loadMore}
                disabled={isLoadingPage}
                className="px-6 py-3 bg-black text-white rounded-lg font-semibold hover:bg-gray-800 transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isLoadingPage ? "Cargando..." : "Cargar más productos"}
              </button>
            </div>
          )}
        </main>
      </div>

      {/* ================================================================== */}
      {/* === BOTÓN SCROLL TO TOP ======================================== */}
      {/* ================================================================== */}
      {showScrollTop && (
        <button
          onClick={scrollToTop}
          className="fixed bottom-6 right-6 z-30 p-3 bg-black text-white rounded-full shadow-lg hover:bg-gray-800 transition"
          aria-label={t("shop.scrollToTop", "Volver arriba")}
        >
          <ArrowUp className="h-5 w-5" />
        </button>
      )}

      {/* ================================================================== */}
      {/* === DRAWER FILTROS MOBILE ====================================== */}
      {/* ================================================================== */}
      {/* Drawer de filtros mobile */}
      <MobileFilterDrawer
        isOpen={isFilterOpen}
        onClose={() => setIsFilterOpen(false)}
        categories={categories}
        selectedCategory={selectedCategory}
        setSelectedCategory={setSelectedCategory}
        selectedSubcategory={selectedSubcategory}
        setSelectedSubcategory={setSelectedSubcategory}
      />

      {/* ================================================================== */}
      {/* === FOOTER ====================================================== */}
      {/* ================================================================== */}
      {/* Footer */}
      <Footer variant="light" />
    </section>
  );
}

// NOTE: If you see in this file:
// {showPersonalization && (
//   <>
//     {/* name and number fields */}
//   </>
// )}
// Replace with:
// {product.customizable !== false && (
//   <>
//     {/* name and number fields */}
//   </>
// )}