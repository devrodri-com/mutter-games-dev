// src/components/SidebarFilter.tsx

import { useEffect, useState } from "react";
import { JSX } from "react/jsx-runtime";
import { useTranslation } from "react-i18next";
import { Category, Subcategory as BaseSubcategory } from "../data/types";
import { ChevronDown } from "lucide-react";

interface ExtendedCategory extends Category {
  orden?: number;
}

interface Subcategory extends BaseSubcategory {
  orden?: number;
}

interface SidebarFilterProps {
  categories: ExtendedCategory[];
  selectedCategory: string;
  setSelectedCategory: React.Dispatch<React.SetStateAction<string>>;
  selectedSubcategory: string;
  setSelectedSubcategory: React.Dispatch<React.SetStateAction<string>>;
  renderCategoryName?: (category: Category) => React.ReactNode;
  isMobile?: boolean; // <-- Add this line
}

export default function SidebarFilter({
  categories,
  selectedCategory,
  setSelectedCategory,
  selectedSubcategory,
  setSelectedSubcategory,
  renderCategoryName,
}: SidebarFilterProps) {
  const { t } = useTranslation();
  const { i18n } = useTranslation();
  const language = i18n.language || "es";

  const [expandedCategoryId, setExpandedCategoryId] = useState<string | null>(null);

  if (!categories || categories.length === 0) {
    return (
      <aside className="mb-10 md:mb-0 md:mr-8">
        <div className="sticky top-[90px]">
          <h3 className="text-lg font-bold mb-4">Filtrar por</h3>
          <p className="text-sm text-gray-500">No hay categorías disponibles.</p>
        </div>
      </aside>
    );
  }

  return (
    <aside className="mb-10 md:mb-0 md:mr-8 md:-ml-2 lg:-ml-4 pr-0 w-full md:w-[248px] lg:w-[264px] shrink-0">
      <div className="sticky top-[90px]">
        <h3 className="text-lg font-bold mb-4">Filtrar por</h3>
        <ul className="space-y-2 text-sm">
          {[...categories]
            .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
            .map((category) => (
              <li key={category.id}>
                <button
                  onClick={() => {
                    setExpandedCategoryId(expandedCategoryId === category.id ? null : category.id);
                    setSelectedCategory(category.id);
                    setSelectedSubcategory('');
                  }}
                  className={`group relative flex w-full items-center gap-2 rounded-md px-3 pr-9 py-2 text-left transition
      ${expandedCategoryId === category.id || selectedCategory === category.id
        ? 'bg-white/90 text-gray-900 border border-gray-200 shadow-sm before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:bg-[#FF2D55]'
        : 'text-gray-800 hover:bg-[#fff5f7] hover:text-gray-900'}
      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF2D55]/40`}
                  aria-expanded={expandedCategoryId === category.id}
                >
                  <span className="font-semibold tracking-wide flex-1">
                    {renderCategoryName ? (
                      renderCategoryName(category)
                    ) : (
                      <span className="font-bold">
                        {typeof category.name === 'object' ? category.name[language] : category.name || ''}
                      </span>
                    )}
                  </span>
                  <ChevronDown
                    className={`pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 transition-transform duration-200 ${expandedCategoryId === category.id ? 'rotate-180 text-gray-900' : 'text-gray-400 group-hover:text-gray-600'}`}
                    aria-hidden
                  />
                </button>
                {expandedCategoryId === category.id &&
                  Array.isArray(category.subcategories) &&
                  category.subcategories.length > 0 && (
                    <div className="ml-2 pl-3 border-l border-gray-200">
                      <ul className="mt-1 space-y-1 text-sm text-gray-600">
                        {([...(category.subcategories as Subcategory[])])
                          .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
                          .map((sub) => (
                            <li key={sub.id}>
                              <button
                                onClick={() => {
                                  setSelectedSubcategory(sub.id);
                                  setSelectedCategory('');
                                }}
                                className={`group relative block w-full rounded-md px-3 pr-6 py-1.5 text-left transition
                ${selectedSubcategory === sub.id
                  ? 'bg-white text-gray-900 border border-gray-200 shadow-sm before:absolute before:left-0 before:top-2 before:bottom-2 before:w-0.5 before:bg-[#FF2D55]'
                  : 'text-gray-600 hover:bg-[#fff5f7] hover:text-gray-900'}
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF2D55]/40`}
                              >
                                {sub.name && typeof sub.name === 'object' ? (sub.name[language] || sub.name['es'] || '') : (sub.name || '')}
                              </button>
                            </li>
                          ))}
                      </ul>
                    </div>
                  )}
              </li>
            ))}
        </ul>

        {/* Botones de control */}
        <div className="mt-5 space-y-2">
          <button
            onClick={() => {
              setSelectedCategory('');
              setSelectedSubcategory('');
            }}
            className="w-full text-[13px] md:text-sm rounded-md py-2 md:py-2 px-3 md:px-4 transition shadow-sm border border-gray-200 bg-[#0F0F0F] text-white hover:bg-[#1a1a1a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF2D55]/40"
          >
            Limpiar filtros
          </button>
          <button
            onClick={() => {
              setSelectedCategory('');
              setSelectedSubcategory('');
            }}
            className="w-full text-[13px] md:text-sm rounded-md py-2 md:py-2 px-3 md:px-4 transition shadow-sm bg-[#FF2D55] text-white hover:bg-[#e0264b] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF2D55]/40"
          >
            Mostrar todo
          </button>
          <div className="my-4 h-px bg-gray-200/60" aria-hidden />
        </div>
      </div>
    </aside>
  );
}