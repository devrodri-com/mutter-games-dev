import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import { ArrowUp, Gamepad } from 'lucide-react';
import ShopNavbar from '../components/ShopNavbar';
import ShopResults from '../components/ShopResults';
import ShopCatalogControls from '../components/shop/ShopCatalogControls';
import SidebarFilter from '../components/SidebarFilter';
import MobileFilterDrawer from '../components/MobileFilterDrawer';
import Footer from '../components/Footer';
import { TIPOS } from '../constants/tipos';
import { useShopProducts } from '../hooks/useShopProducts';
import './Shop.css';

export default function Shop() {
  const { t } = useTranslation();
  const {
    isInitialLoad, loading, hasMore,
    catalogPending, catalogComplete, catalogError, countDescription, retryCatalog,
    searchTerm, setSearchTerm,
    selectedCategory, setSelectedCategory, selectedSubcategory, setSelectedSubcategory,
    selectedType, setSelectedType, sortOption, setSortOption, handleOrderChangeMobile,
    sortedProducts, sortedProductsMobile, availableTypes, categories, loadMore,
    isMobileView, showScrollTop, isFilterOpen, setIsFilterOpen,
    showMobileFilter, setShowMobileFilter, filterParam, isIOS, scrollToTop, setSearchParams,
  } = useShopProducts();

  function clearAllFilters() {
    setSearchTerm('');
    setSelectedCategory('');
    setSelectedSubcategory('');
    setSelectedType('Todos');
    setSortOption('az');
    if (!isIOS) setSearchParams({}, { replace: true });
  }

  const title = searchTerm
    ? t('shop.resultsFor', { search: searchTerm, defaultValue: 'Resultados para "{{search}}"', searchTerm })
    : filterParam === 'NBA' ? t('shop.nba', 'NBA')
    : filterParam === 'FUTBOL' ? t('shop.soccer', 'Fútbol')
    : 'Productos disponibles';

  const categoryFilters = <SidebarFilter
    categories={categories}
    selectedCategory={selectedCategory} setSelectedCategory={setSelectedCategory}
    selectedSubcategory={selectedSubcategory} setSelectedSubcategory={setSelectedSubcategory}
    renderCategoryName={category => <span>{category.name}</span>}
  />;

  return (
    <section className="shop-page">
      <ShopNavbar />
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
      <div className="shop-shell">
        <ShopCatalogControls
          title={isInitialLoad && loading ? 'Cargando productos…' : title}
          countDescription={countDescription}
          searchTerm={searchTerm} onSearch={setSearchTerm} onClear={clearAllFilters}
          sortOption={sortOption} onSort={setSortOption}
          isMobileView={isMobileView} onMobileSort={handleOrderChangeMobile}
          filtersExpanded={showMobileFilter}
          onToggleFilters={() => setShowMobileFilter(!showMobileFilter)}
        />

        <div className="shop-layout">
          <aside className="shop-sidebar" aria-label="Filtros del catálogo">
            <div className="shop-categories">{categoryFilters}</div>
            <div className="shop-type-filter">
              <h2><Gamepad size={16} aria-hidden="true" />Tipo de producto</h2>
              <div className="shop-type-options">
                <button type="button" className="shop-type-option"
                  aria-pressed={selectedType === '' || selectedType === 'Todos'}
                  onClick={() => setSelectedType('Todos')}>Todos</button>
                {TIPOS.map(type => <button type="button" key={type} className="shop-type-option"
                  aria-pressed={selectedType === type} onClick={() => setSelectedType(type)}>{type}</button>)}
              </div>
            </div>
          </aside>

          <main className="shop-main" aria-label="Productos del catálogo">
            {showMobileFilter && <div id="shop-mobile-filters" className="shop-mobile-filters">
              <div className="shop-categories">{categoryFilters}</div>
              {availableTypes.length > 0 && <fieldset className="shop-mobile-types">
                <legend>Tipo de producto</legend>
                {availableTypes.map(type => type && <label key={type}>
                  <input type="radio" name="product-type" value={type}
                    checked={selectedType === type} onChange={() => setSelectedType(type)} />
                  <span>{type}</span>
                </label>)}
                <label><input type="radio" name="product-type" value="Todos"
                  checked={selectedType === 'Todos'} onChange={() => setSelectedType('Todos')} /><span>Todos</span></label>
              </fieldset>}
            </div>}
            <ShopResults
              products={isMobileView ? sortedProductsMobile : sortedProducts}
              pending={catalogPending} complete={catalogComplete} error={catalogError}
              hasMore={hasMore} onLoadMore={loadMore} onRetry={retryCatalog} onClear={clearAllFilters}
            />
          </main>
        </div>
      </div>

      {showScrollTop && <button type="button" onClick={scrollToTop}
        className="shop-scroll-top" aria-label={t('shop.scrollToTop', 'Volver arriba')}>
        <ArrowUp size={20} aria-hidden="true" />
      </button>}
      <MobileFilterDrawer isOpen={isFilterOpen} onClose={() => setIsFilterOpen(false)}
        categories={categories} selectedCategory={selectedCategory} setSelectedCategory={setSelectedCategory}
        selectedSubcategory={selectedSubcategory} setSelectedSubcategory={setSelectedSubcategory} />
      <Footer variant="light" />
    </section>
  );
}
