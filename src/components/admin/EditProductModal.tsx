// src/components/admin/EditProductModal.tsx

import React, { useState, useRef } from "react";
import { Product } from "../../data/types";
import TiptapEditor from "./TiptapEditor";
import { TIPOS } from "../../constants/tipos";
import { useProductForm } from "../../hooks/useProductForm";

interface Props {
  product: Product;
  onSave: (updatedProduct: Product) => void;
  onClose: () => void;
  subcategories: {
    id: string;
    name: string | { es?: string; en?: string };
    categoryId: string;
  }[];
  open: boolean;
}

export default function EditProductModal({
  product,
  onSave,
  onClose,
  subcategories,
  open,
}: Props) {
  // Usar el hook para toda la lógica
  const form = useProductForm({
    mode: "edit",
    initialProduct: product,
    subcategories: subcategories,
    onSuccess: (updatedProduct) => {
      onSave(updatedProduct);
    },
  });

  // UI: dropdowns custom (solo visual)
  const [isCatOpen, setIsCatOpen] = useState(false);
  const [isSubOpen, setIsSubOpen] = useState(false);
  const [isTipoOpen, setIsTipoOpen] = useState(false);

  const catRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const tipoRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragFromIndex = useRef<number | null>(null);
  const [lastFileName, setLastFileName] = useState<string>("");

  const getCatName = (c: any) =>
    typeof c?.name === "string" ? c.name : c?.name?.es || c?.name?.en || "";

  const getSubName = (s: any) =>
    typeof s?.name === "string" ? s.name : s?.name?.es || s?.name?.en || "";

  // Cerrar dropdowns al click fuera o con ESC (solo UI)
  React.useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (isCatOpen && catRef.current && !catRef.current.contains(t)) setIsCatOpen(false);
      if (isSubOpen && subRef.current && !subRef.current.contains(t)) setIsSubOpen(false);
      if (isTipoOpen && tipoRef.current && !tipoRef.current.contains(t)) setIsTipoOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsCatOpen(false);
        setIsSubOpen(false);
        setIsTipoOpen(false);
      }
    };
    document.addEventListener("mousedown", handleDown);
    window.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDown);
      window.removeEventListener("keydown", handleKey);
    };
  }, [isCatOpen, isSubOpen, isTipoOpen]);

  // --- Reordenar imágenes (Drag & Drop nativo) ---
  const handleDragStart = (idx: number) => {
    dragFromIndex.current = idx;
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (idx: number) => {
    const from = dragFromIndex.current;
    if (from === null || from === idx) return;
    form.handleImageReorder(from, idx);
    dragFromIndex.current = null;
  };

  // Guardar producto usando el hook
  const handleSave = async () => {
    // Usar el método submit directo del hook
    await form.submit();
  };

  if (!product) {
    return (
      <div className="fixed inset-0 z-50 bg-white bg-opacity-75 flex items-center justify-center">
        <span className="text-gray-600">Cargando datos del producto...</span>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="modal-title" role="dialog" aria-modal="true">
      <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 bg-black/60 transition-opacity" aria-hidden="true" onClick={onClose}></div>
        <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
        <div className="inline-block align-bottom bg-white rounded-2xl text-left overflow-hidden shadow-2xl ring-1 ring-black/5 transform transition-all sm:my-12 sm:align-middle sm:max-w-5xl w-full">
          <div className="absolute top-0 right-0 pt-4 pr-4">
            <button
              type="button"
              onClick={onClose}
              className="bg-white/90 rounded-full text-gray-500 hover:text-gray-700 hover:bg-white focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#FF2D55]"
              aria-label="Cerrar"
            >
              <span className="sr-only">Cerrar</span>
              <svg className="h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <h3 className="text-2xl md:text-3xl font-bold tracking-tight text-gray-900 mb-6 border-b border-gray-200 pb-3" id="modal-title">
              Editar producto
            </h3>
            {form.error && (
              <div className="mb-4 p-2 bg-red-100 border border-red-400 text-red-700 rounded">{form.error}</div>
            )}
            <div className="space-y-8 divide-y divide-gray-100 max-h-[70vh] overflow-y-auto px-2 py-4">
              <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="lg:col-span-4">
                    <div className="mb-4">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Título del producto</label>
                      <input
                        type="text"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 placeholder-gray-400 focus:ring-[#FF2D55] focus:border-[#FF2D55]"
                        value={form.formData.title || ""}
                        placeholder="Título del producto"
                        onChange={(e) => {
                          form.setFormField("title", e.target.value);
                          form.setValue("title", e.target.value);
                        }}
                      />
                    </div>
                  </div>
                  <div className="lg:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Categoría</label>
                    <div className="relative" ref={catRef} onMouseLeave={() => setIsCatOpen(false)}>
                      <button
                        type="button"
                        onClick={() => setIsCatOpen((v) => !v)}
                        aria-haspopup="listbox"
                        aria-expanded={isCatOpen}
                        className="w-full flex items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm focus:outline-none focus:ring-2 focus:ring-[#FF2D55] focus:border-[#FF2D55]"
                      >
                        <span className={form.selectedCategory ? "text-gray-900" : "text-gray-400"}>
                          {form.selectedCategory
                            ? getCatName(form.categories.find((c) => c.id === form.selectedCategory))
                            : "Seleccionar Categoría"}
                        </span>
                        <svg className={`h-4 w-4 transition ${isCatOpen ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" clipRule="evenodd" />
                        </svg>
                      </button>

                      {isCatOpen && (
                        <ul
                          role="listbox"
                          className="absolute z-50 mt-1 w-full max-h-56 overflow-auto rounded-lg border border-gray-200 bg-white shadow-xl"
                        >
                          {form.categories.map((cat) => {
                            const active = form.selectedCategory === cat.id;
                            return (
                              <li
                                role="option"
                                aria-selected={active}
                                key={cat.id}
                                onClick={() => {
                                  form.setSelectedCategory(cat.id);
                                  setIsCatOpen(false);
                                }}
                                className={`px-3 py-2 cursor-pointer text-sm hover:bg-gray-50 flex items-center justify-between ${
                                  active ? "bg-gray-50" : ""
                                }`}
                              >
                                <span>{getCatName(cat)}</span>
                                {active && (
                                  <svg className="h-4 w-4 text-[#FF2D55]" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-7.25 7.25a1 1 0 01-1.414 0l-3.25-3.25a1 1 0 111.414-1.414l2.543 2.543 6.543-6.543a1 1 0 011.414 0z" clipRule="evenodd" />
                                  </svg>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </div>
                  <div className="lg:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Subcategoría</label>
                    <div className="relative" ref={subRef} onMouseLeave={() => setIsSubOpen(false)}>
                      <button
                        type="button"
                        onClick={() => setIsSubOpen((v) => !v)}
                        aria-haspopup="listbox"
                        aria-expanded={isSubOpen}
                        className="w-full flex items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm focus:outline-none focus:ring-2 focus:ring-[#FF2D55] focus:border-[#FF2D55]"
                      >
                        <span className={form.selectedSubcategory ? "text-gray-900" : "text-gray-400"}>
                          {form.selectedSubcategory
                            ? getSubName(form.subcategories.find((s) => s.id === form.selectedSubcategory))
                            : "Seleccionar subcategoría"}
                        </span>
                        <svg className={`h-4 w-4 transition ${isSubOpen ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" clipRule="evenodd" />
                        </svg>
                      </button>

                      {isSubOpen && (
                        <ul
                          role="listbox"
                          className="absolute z-50 mt-1 w-full max-h-56 overflow-auto rounded-lg border border-gray-200 bg-white shadow-xl"
                        >
                          {form.subcategories
                            .filter((sub) => sub.categoryId === form.selectedCategory)
                            .map((sub) => {
                              const active = form.selectedSubcategory === sub.id;
                              return (
                                <li
                                  role="option"
                                  aria-selected={active}
                                  key={sub.id}
                                  onClick={() => {
                                    form.setSelectedSubcategory(sub.id);
                                    setIsSubOpen(false);
                                  }}
                                  className={`px-3 py-2 cursor-pointer text-sm hover:bg-gray-50 flex items-center justify-between ${
                                    active ? "bg-gray-50" : ""
                                  }`}
                                >
                                  <span>{getSubName(sub)}</span>
                                  {active && (
                                    <svg className="h-4 w-4 text-[#FF2D55]" viewBox="0 0 20 20" fill="currentColor">
                                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-7.25 7.25a1 1 0 01-1.414 0l-3.25-3.25a1 1 0 111.414-1.414l2.543 2.543 6.543-6.543a1 1 0 011.414 0z" clipRule="evenodd" />
                                    </svg>
                                  )}
                                </li>
                              );
                            })}
                          {form.selectedCategory && form.subcategories.filter((s) => s.categoryId === form.selectedCategory).length === 0 && (
                            <li className="px-3 py-2 text-sm text-gray-500">No hay subcategorías para esta categoría.</li>
                          )}
                        </ul>
                      )}
                    </div>
                  </div>
                  <div className="lg:col-span-2">
                    <div className="mb-4">
                      <label className="block text-sm font-medium text-gray-700 mb-1">Tipo de producto</label>
                      <div className="relative" ref={tipoRef} onMouseLeave={() => setIsTipoOpen(false)}>
                        <button
                          type="button"
                          onClick={() => setIsTipoOpen((v) => !v)}
                          aria-haspopup="listbox"
                          aria-expanded={isTipoOpen}
                          className="w-full flex items-center justify-between rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm focus:outline-none focus:ring-2 focus:ring-[#FF2D55] focus:border-[#FF2D55]"
                        >
                          <span className={form.formData.tipo ? "text-gray-900" : "text-gray-400"}>
                            {form.formData.tipo || "Seleccionar tipo"}
                          </span>
                          <svg className={`h-4 w-4 transition ${isTipoOpen ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" clipRule="evenodd" />
                          </svg>
                        </button>

                        {isTipoOpen && (
                          <ul
                            role="listbox"
                            className="absolute z-50 mt-1 w-full max-h-56 overflow-auto rounded-lg border border-gray-200 bg-white shadow-xl"
                          >
                            <li
                              role="option"
                              aria-selected={!form.formData.tipo}
                              onClick={() => {
                                form.setFormField("tipo", "");
                                setIsTipoOpen(false);
                              }}
                              className="px-3 py-2 cursor-pointer text-sm hover:bg-gray-50 text-gray-500"
                            >
                              Seleccionar tipo
                            </li>
                            {TIPOS.map((tipo) => {
                              const active = form.formData.tipo === tipo;
                              return (
                                <li
                                  role="option"
                                  aria-selected={active}
                                  key={tipo}
                                  onClick={() => {
                                    form.setFormField("tipo", tipo);
                                    setIsTipoOpen(false);
                                  }}
                                  className={`px-3 py-2 cursor-pointer text-sm hover:bg-gray-50 flex items-center justify-between ${
                                    active ? "bg-gray-50" : ""
                                  }`}
                                >
                                  <span>{tipo}</span>
                                  {active && (
                                    <svg className="h-4 w-4 text-[#FF2D55]" viewBox="0 0 20 20" fill="currentColor">
                                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-7.25 7.25a1 1 0 01-1.414 0l-3.25-3.25a1 1 0 111.414-1.414l2.543 2.543 6.543-6.543a1 1 0 011.414 0z" clipRule="evenodd" />
                                    </svg>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="pt-6">
                <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
                <TiptapEditor content={form.description} onChange={form.setDescription} withDefaultStyles={true} />
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm mt-6">
                <label className="block text-sm font-medium text-gray-700 mb-1">Variantes del producto</label>
                {form.variants.map((variant, vIdx) => (
                  <div key={vIdx} className="mb-4 border p-3 rounded-lg bg-white">
                    <div className="flex gap-4 mb-2">
                      <input
                        type="text"
                        className="w-1/2 border border-gray-300 rounded-lg p-2 focus:ring-[#FF2D55] focus:border-[#FF2D55] placeholder-gray-400"
                        placeholder="Nombre en español"
                        value={variant.label.es}
                        onChange={(e) =>
                          form.handleVariantChange(vIdx, "label", {
                            ...variant.label,
                            es: e.target.value,
                            en: e.target.value,
                          })
                        }
                      />
                      <input
                        type="text"
                        className="w-1/2 border border-gray-300 rounded-lg p-2 focus:ring-[#FF2D55] focus:border-[#FF2D55] placeholder-gray-400"
                        placeholder="Nombre en inglés"
                        value={variant.label.en}
                        onChange={(e) =>
                          form.handleVariantChange(vIdx, "label", {
                            ...variant.label,
                            es: e.target.value,
                            en: e.target.value,
                          })
                        }
                      />
                    </div>
                    {variant.options.map((option: any, oIdx: number) => (
                      <div key={oIdx} className="grid grid-cols-3 gap-2 mb-1 items-end">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Valor</label>
                          <input
                            type="text"
                            className="border border-gray-300 rounded-lg p-2 w-full focus:ring-[#FF2D55] focus:border-[#FF2D55] placeholder-gray-400"
                            placeholder="Ej: 60 cápsulas"
                            value={option.value}
                            onChange={(e) =>
                              form.handleOptionChange(vIdx, oIdx, "value", e.target.value)
                            }
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">Precio</label>
                          <input
                            type="number"
                            step="0.01"
                            min={0}
                            className="border border-gray-300 rounded-lg p-2 w-full focus:ring-[#FF2D55] focus:border-[#FF2D55] placeholder-gray-400"
                            placeholder="Ej: 19.99"
                            value={option.priceUSD}
                            onChange={(e) =>
                              form.handleOptionChange(vIdx, oIdx, "priceUSD", parseFloat(e.target.value))
                            }
                          />
                        </div>
                        <div className="flex gap-1 items-end">
                          <div className="w-full">
                            <label className="block text-xs font-medium text-gray-700 mb-1">Stock</label>
                            <input
                              type="number"
                              min={0}
                              className="border border-gray-300 rounded-lg p-2 w-full focus:ring-[#FF2D55] focus:border-[#FF2D55] placeholder-gray-400"
                              placeholder="Ej: 10"
                              value={option.stock || 0}
                              onChange={(e) =>
                                form.handleOptionChange(vIdx, oIdx, "stock", parseInt(e.target.value))
                              }
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => form.handleOptionRemove(vIdx, oIdx)}
                            className="ml-1 px-2 py-1 text-xs bg-red-500 text-white rounded-md hover:bg-red-600"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="text-blue-600 text-sm mt-2"
                      onClick={() => form.handleOptionAdd(vIdx)}
                    >
                      + Agregar opción
                    </button>
                    <button
                      type="button"
                      onClick={() => form.handleVariantRemove(vIdx)}
                      className="bg-red-500 text-white px-3 py-1.5 rounded-md mt-2 ml-2 hover:bg-red-600"
                    >
                      Eliminar
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="text-blue-600 mt-2"
                  onClick={form.handleVariantAdd}
                >
                  + Agregar variante
                </button>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm mt-6">
                <label className="block text-sm font-medium text-gray-700 mb-1">Imágenes</label>
                <div className="flex flex-wrap gap-2">
                  {form.images.map((url, idx) => (
                    <div
                      key={idx}
                      draggable
                      onDragStart={() => handleDragStart(idx)}
                      onDragOver={handleDragOver}
                      onDrop={() => handleDrop(idx)}
                      title="Arrastrá para reordenar"
                      className="relative w-24 h-24 border border-gray-200 rounded-lg overflow-hidden shadow-sm cursor-move"
                    >
                      <img src={url} alt={`imagen-${idx}`} className="object-cover w-full h-full" />
                      <div className="absolute left-0 top-0 bg-white/70 px-1.5 py-0.5 text-[10px] text-gray-700 rounded-br-md select-none">
                        ⇅
                      </div>
                      <button
                        type="button"
                        onClick={() => form.handleImageRemove(idx)}
                        className="absolute top-0 right-0 bg-red-600/90 text-white rounded-bl-md px-1.5 py-0.5 text-[10px] hover:bg-red-600"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
                <div className="mt-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Agregar nueva imagen</label>
                  <div className="flex items-center gap-3">
                    <input
                      id="imageUpload"
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={async (e) => {
                        const input = e.target as HTMLInputElement;
                        const file = input.files?.[0];
                        if (file) {
                          setLastFileName(file.name);
                          await form.handleImageUpload(file);
                        }
                        if (fileInputRef.current) {
                          fileInputRef.current.value = "";
                          fileInputRef.current.blur();
                        }
                      }}
                    />
                    <label
                      htmlFor="imageUpload"
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 text-gray-800 hover:bg-gray-50 cursor-pointer focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#FF2D55]"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path d="M10 5a1 1 0 011 1v3h3a1 1 0 010 2h-3v3a1 1 0 01-2 0v-3H6a1 1 0 010-2h3V6a1 1 0 011-1z" />
                      </svg>
                      <span>Seleccionar imagen</span>
                    </label>
                    <span className="text-xs text-gray-500 truncate max-w-[60%]">
                      {lastFileName || "PNG, JPG o WEBP"}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div className="bg-white border-t border-gray-200 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
            <button
              type="button"
              onClick={handleSave}
              disabled={form.loading}
              className="w-full inline-flex justify-center rounded-lg border border-transparent shadow-sm px-4 py-2 bg-[#FF2D55] text-white hover:bg-[#e0264c] text-base font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#FF2D55] sm:ml-3 sm:w-auto sm:text-sm disabled:bg-gray-400"
            >
              {form.loading ? "Guardando..." : "Guardar Cambios"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="mt-3 w-full inline-flex justify-center rounded-lg border border-gray-300 shadow-sm px-4 py-2 bg-white text-gray-800 hover:bg-gray-50 text-base font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-300 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}