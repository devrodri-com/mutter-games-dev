import { Listbox } from '@headlessui/react';
import { Check, ChevronDown, Search, SlidersHorizontal } from 'lucide-react';
import type { ShopSort } from '../../domain/shopSelection';

interface ShopCatalogControlsProps {
  title: string;
  countDescription: string;
  searchTerm: string;
  onSearch: (value: string) => void;
  onClear: () => void;
  sortOption: ShopSort;
  onSort: (value: ShopSort) => void;
  isMobileView: boolean;
  onMobileSort: (value: string) => void;
  filtersExpanded: boolean;
  onToggleFilters: () => void;
}

const sortOptions: { value: ShopSort; label: string }[] = [
  { value: '', label: 'Ordenar por' },
  { value: 'priceAsc', label: 'Precio: Menor a Mayor' },
  { value: 'priceDesc', label: 'Precio: Mayor a Menor' },
  { value: 'az', label: 'Nombre: A-Z' },
  { value: 'za', label: 'Nombre: Z-A' },
];

export default function ShopCatalogControls({ title, countDescription, searchTerm, onSearch,
  onClear, sortOption, onSort, isMobileView, onMobileSort, filtersExpanded,
  onToggleFilters }: ShopCatalogControlsProps) {
  const visibleOptions = isMobileView ? sortOptions.filter(option => option.value !== '') : sortOptions;
  const selectedLabel = sortOptions.find(option => option.value === sortOption)?.label ?? 'Ordenar por';

  function changeSort(value: ShopSort) {
    if (isMobileView) onMobileSort(value === 'priceAsc' ? 'asc' : value === 'priceDesc' ? 'desc' : value);
    else onSort(value);
  }

  return (
    <header className="shop-catalog-header">
      <div className="shop-search-field">
        <label htmlFor="shop-search">Buscar en el catálogo</label>
        <div className="shop-search-input">
          <Search size={19} aria-hidden="true" />
          <input id="shop-search" type="search" value={searchTerm}
            placeholder="Juegos, consolas, coleccionables…"
            onChange={event => onSearch(event.target.value)} />
        </div>
      </div>

      <div className="shop-catalog-toolbar">
        <div className="shop-catalog-heading">
          <h1>{title}</h1>
          <p aria-live="polite">{countDescription}</p>
          {searchTerm && <button type="button" className="shop-clear-filters" onClick={onClear}>Quitar filtros</button>}
        </div>
        <div className="shop-catalog-actions">
          <button type="button" className="shop-filter-toggle" onClick={onToggleFilters}
            aria-expanded={filtersExpanded} aria-controls="shop-mobile-filters">
            <SlidersHorizontal size={17} aria-hidden="true" /> Filtros
          </button>
          <Listbox value={sortOption} onChange={changeSort}>
            <div className="shop-sort">
              <Listbox.Button className="shop-sort-button" aria-label="Ordenar productos" aria-describedby="shop-sort-value">
                <span id="shop-sort-value">{selectedLabel}</span>
                <ChevronDown size={17} aria-hidden="true" />
              </Listbox.Button>
                <Listbox.Options className="shop-sort-options">
                  {visibleOptions.map(option => (
                    <Listbox.Option key={option.value} value={option.value}
                      className={({ active, selected }) => `shop-sort-option${active ? ' is-active' : ''}${selected ? ' is-selected' : ''}`}>
                      {({ selected }) => <><span>{option.label}</span>{selected && <Check size={17} aria-hidden="true" />}</>}
                    </Listbox.Option>
                  ))}
                </Listbox.Options>
            </div>
          </Listbox>
        </div>
      </div>
    </header>
  );
}
