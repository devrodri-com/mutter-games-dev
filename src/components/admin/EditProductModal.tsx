// src/components/admin/EditProductModal.tsx

// Versión funcional anterior de EditProductModal (restaurada)
import React, { useState, useEffect, useRef } from "react";
import { Product } from "../../data/types";
import { fetchCategories } from "@/firebase/categories";
import { updateProduct } from "@/firebase/products";
import { generateSlug } from "../../utils/generateSlug";
import { uploadImageToImageKit } from "../../utils/imagekitUtils";
import { auth } from "../../firebase";
import TiptapEditor from "./TiptapEditor";
import { TIPOS } from "../../constants/tipos";

async function updateProductAdminAPI(id: string, data: Partial<Product>) {
  const current = auth.currentUser;
  if (!current) {
    throw new Error("No hay usuario autenticado");
  }
  const idToken = await current.getIdToken();

  const response = await fetch(`/api/admin/products/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Error actualizando producto");
  }

  return true;
}

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
  const [categories, setCategories] = useState<
    { id: string; name: string | { es?: string; en?: string } }[]
  >([]);
  const [form, setForm] = useState<Product | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [variants, setVariants] = useState<any[]>([]);
  const dragFromIndex = useRef<number | null>(null);
  const [lastFileName, setLastFileName] = useState<string>("");
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [selectedSubcategory, setSelectedSubcategory] = useState<string>("");
  const [description, setDescription] = useState<string>("");

  // UI: dropdowns custom (solo visual)
  const [isCatOpen, setIsCatOpen] = useState(false);
  const [isSubOpen, setIsSubOpen] = useState(false);
  const [isTipoOpen, setIsTipoOpen] = useState(false);

  const catRef = useRef<HTMLDivElement>(null);
  const subRef = useRef<HTMLDivElement>(null);
  const tipoRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getCatName = (c: any) =>
    typeof c?.name === "string" ? c.name : c?.name?.es || c?.name?.en || "";

  const getSubName = (s: any) =>
    typeof s?.name === "string" ? s.name : s?.name?.es || s?.name?.en || "";

  // Cargar categorías
  useEffect(() => {
    fetchCategories().then(setCategories);
  }, []);

  // Inicializar form al abrir
  useEffect(() => {
    if (product) {
      console.log("🧪 Producto recibido en modal:", product);
      // Normalizamos el título para que siempre tenga { es, en }
      const normalizedTitle =
        typeof product.title === "string"
          ? { es: product.title, en: product.title }
          : {
              es: (product.title?.es as string) || (product.title?.en as string) || "",
              en: (product.title?.en as string) || (product.title?.es as string) || "",
            };

      setForm({
        ...product,
        title: normalizedTitle,
        tipo: product.tipo || "",
        category: product.category || { id: "", name: "" },
        subcategory: product.subcategory || { id: "", name: "" },
        description: product.description || "",
        extraDescriptionTop: product.extraDescriptionTop || "",
        extraDescriptionBottom: product.extraDescriptionBottom || "",
      });
      console.log("🧪 formData seteado al abrir modal:", {
        ...product,
        tipo: product.tipo || "",
      });
      setImages(product.images || []);
      setVariants(product.variants || []);
      setSelectedCategory(product.category?.id || "");
      setSelectedSubcategory(product.subcategory?.id || "");
      setDescription(product.description || "");
    }
  }, [product, open]);

  // Sincronizar imágenes y variantes con form
  useEffect(() => {
    setForm((prev) => (prev ? { ...prev, images, variants } : prev));
    // eslint-disable-next-line
  }, [images, variants]);

  // Sincronizar descripción
  useEffect(() => {
    setForm((prev) => (prev ? { ...prev, description } : prev));
  }, [description]);

  // Cerrar dropdowns al click fuera o con ESC (solo UI)
  useEffect(() => {
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

  // Handlers de inputs
  const handleChange = (key: keyof Product, value: any) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const handleVariantChange = (vIdx: number, key: string, value: any) => {
    setVariants((prev) =>
      prev.map((v, i) =>
        i === vIdx ? { ...v, [key]: value } : v
      )
    );
  };

  const handleOptionChange = (vIdx: number, oIdx: number, key: string, value: any) => {
    setVariants((prev) =>
      prev.map((v, i) =>
        i === vIdx
          ? {
              ...v,
              options: v.options.map((o: any, j: number) =>
                j === oIdx ? { ...o, [key]: value } : o
              ),
            }
          : v
      )
    );
  };

  const addVariant = () => {
    setVariants((prev) => [
      ...prev,
      { label: { es: "", en: "" }, options: [{ value: "", priceUSD: 0, stock: 0 }] },
    ]);
  };
  const removeVariant = (idx: number) => {
    setVariants((prev) => prev.filter((_, i) => i !== idx));
  };
  const addOption = (vIdx: number) => {
    setVariants((prev) =>
      prev.map((v, i) =>
        i === vIdx
          ? {
              ...v,
              options: [...v.options, { value: "", priceUSD: 0, stock: 0 }],
            }
          : v
      )
    );
  };
  const removeOption = (vIdx: number, oIdx: number) => {
    setVariants((prev) =>
      prev.map((v, i) =>
        i === vIdx
          ? { ...v, options: v.options.filter((_: any, j: number) => j !== oIdx) }
          : v
      )
    );
  };

  const handleImageUpload = async (file: File) => {
    try {
      const url = await uploadImageToImageKit(file);
      if (url) {
        setImages((prev) => [...prev, url]);
      }
    } catch (e) {
      alert("Error subiendo imagen");
    }
  };
  const removeImage = (idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  };

  // --- Reordenar imágenes (Drag & Drop nativo) ---
  const handleDragStart = (idx: number) => {
    dragFromIndex.current = idx;
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); // necesario para permitir el drop
  };

  const handleDrop = (idx: number) => {
    const from = dragFromIndex.current;
    if (from === null || from === idx) return;

    setImages((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(idx, 0, moved);
      return next;
    });

    dragFromIndex.current = null;
  };

  // Guardar producto
  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      if (!form) throw new Error("Faltan datos");

      // Aseguramos que el título tenga siempre `en` (fallback a `es`)
      const titleEn =
        typeof form.title === "string"
          ? form.title
          : (form.title?.en as string) || (form.title?.es as string) || "";

      if (!titleEn.trim()) throw new Error("El nombre es obligatorio");
      if (!selectedCategory || !selectedSubcategory)
        throw new Error("Debe seleccionar categoría y subcategoría");
      if (!images.length) throw new Error("Debe subir al menos una imagen");

      // Calcular stockTotal y priceUSD
      const stockTotal = variants.reduce(
        (total, v) =>
          total +
          (v.options
            ? v.options.reduce((s: number, o: any) => s + (o.stock || 0), 0)
            : 0),
        0
      );
      const priceUSD = Math.min(
        ...variants.flatMap((v) => v.options.map((o: any) => o.priceUSD))
      );

      // Slug
      const subcatObj = subcategories.find((s) => s.id === selectedSubcategory);
      const subcatName =
        typeof subcatObj?.name === "string"
          ? subcatObj?.name
          : subcatObj?.name?.es || subcatObj?.name?.en || "";

      const slug = `${generateSlug(titleEn || "")}-${(subcatName || "")
        .toLowerCase()
        .replace(/\s+/g, "-")}`;

      // Eliminar size del objeto actualizado si existe
      const { size, ...formWithoutSize } = form as any;

      const updated: Product = {
        ...formWithoutSize,
        // Normalizamos el título para que siempre sea coherente
        title:
          typeof form.title === "string"
            ? { es: form.title, en: form.title }
            : {
                es: (form.title?.es as string) || titleEn,
                en: titleEn,
              },
        id: form.id,
        images,
        variants,
        stockTotal,
        priceUSD,
        slug,
        category: {
          id: selectedCategory,
          name:
            typeof categories.find((c) => c.id === selectedCategory)?.name ===
            "string"
              ? (categories.find((c) => c.id === selectedCategory)?.name as string)
              : (categories.find((c) => c.id === selectedCategory)?.name as any)?.es ||
                (categories.find((c) => c.id === selectedCategory)?.name as any)?.en ||
                "",
        },
        subcategory: {
          id: selectedSubcategory,
          name: subcatName,
          categoryId: subcatObj?.categoryId || "",
        },
        description: description,
      };

      await updateProduct(form.id, updated);
      onSave(updated);
    } catch (e: any) {
      setError(e.message || "Error al guardar");
    } finally {
      setSaving(false);
    }
  };

  if (!form) {
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
            {error && (
              <div className="mb-4 p-2 bg-red-100 border border-red-400 text-red-700 rounded">{error}</div>
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
                        value={form.title?.es || ""}
                        placeholder="Título del producto"
                        onChange={(e) =>
                          setForm({
                            ...form,
                            title: {
                              es: e.target.value,
                              en: e.target.value,
                            },
                          })
                        }
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
                        <span className={selectedCategory ? "text-gray-900" : "text-gray-400"}>
                          {selectedCategory
                            ? getCatName(categories.find((c) => c.id === selectedCategory))
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
                          {categories.map((cat) => {
                            const active = selectedCategory === cat.id;
                            return (
                              <li
                                role="option"
                                aria-selected={active}
                                key={cat.id}
                                onClick={() => {
                                  setSelectedCategory(cat.id);
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
                        <span className={selectedSubcategory ? "text-gray-900" : "text-gray-400"}>
                          {selectedSubcategory
                            ? getSubName(subcategories.find((s) => s.id === selectedSubcategory))
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
                          {subcategories
                            .filter((sub) => sub.categoryId === selectedCategory)
                            .map((sub) => {
                              const active = selectedSubcategory === sub.id;
                              return (
                                <li
                                  role="option"
                                  aria-selected={active}
                                  key={sub.id}
                                  onClick={() => {
                                    setSelectedSubcategory(sub.id);
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
                          {selectedCategory && subcategories.filter((s) => s.categoryId === selectedCategory).length === 0 && (
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
                          <span className={form.tipo ? "text-gray-900" : "text-gray-400"}>
                            {form.tipo || "Seleccionar tipo"}
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
                              aria-selected={!form.tipo}
                              onClick={() => {
                                setForm((prev) => (prev ? { ...prev, tipo: "" } : prev));
                                setIsTipoOpen(false);
                              }}
                              className="px-3 py-2 cursor-pointer text-sm hover:bg-gray-50 text-gray-500"
                            >
                              Seleccionar tipo
                            </li>
                            {TIPOS.map((tipo) => {
                              const active = form.tipo === tipo;
                              return (
                                <li
                                  role="option"
                                  aria-selected={active}
                                  key={tipo}
                                  onClick={() => {
                                    setForm((prev) => (prev ? { ...prev, tipo } : prev));
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
                <TiptapEditor content={description} onChange={setDescription} withDefaultStyles={true} />
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm mt-6">
                <label className="block text-sm font-medium text-gray-700 mb-1">Variantes del producto</label>
                {variants.map((variant, vIdx) => (
                  <div key={vIdx} className="mb-4 border p-3 rounded-lg bg-white">
                    <div className="flex gap-4 mb-2">
                      <input
                        type="text"
                        className="w-1/2 border border-gray-300 rounded-lg p-2 focus:ring-[#FF2D55] focus:border-[#FF2D55] placeholder-gray-400"
                        placeholder="Nombre en español"
                        value={variant.label.es}
                        onChange={(e) =>
                          handleVariantChange(vIdx, "label", {
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
                          handleVariantChange(vIdx, "label", {
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
                              handleOptionChange(vIdx, oIdx, "value", e.target.value)
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
                              handleOptionChange(vIdx, oIdx, "priceUSD", parseFloat(e.target.value))
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
                                handleOptionChange(vIdx, oIdx, "stock", parseInt(e.target.value))
                              }
                            />
                          </div>
                          <button
                            type="button"
                            onClick={() => removeOption(vIdx, oIdx)}
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
                      onClick={() => addOption(vIdx)}
                    >
                      + Agregar opción
                    </button>
                    <button
                      type="button"
                      onClick={() => removeVariant(vIdx)}
                      className="bg-red-500 text-white px-3 py-1.5 rounded-md mt-2 ml-2 hover:bg-red-600"
                    >
                      Eliminar
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="text-blue-600 mt-2"
                  onClick={addVariant}
                >
                  + Agregar variante
                </button>
              </div>
              <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm mt-6">
                <label className="block text-sm font-medium text-gray-700 mb-1">Imágenes</label>
                <div className="flex flex-wrap gap-2">
                  {images.map((url, idx) => (
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
                        onClick={() => removeImage(idx)}
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
                          await handleImageUpload(file);
                        }
                        if (fileInputRef.current) {
                          // reset so the same filename can be selected again and avoid scroll/focus jumps
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
              disabled={saving}
              className="w-full inline-flex justify-center rounded-lg border border-transparent shadow-sm px-4 py-2 bg-[#FF2D55] text-white hover:bg-[#e0264c] text-base font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#FF2D55] sm:ml-3 sm:w-auto sm:text-sm disabled:bg-gray-400"
            >
              {saving ? "Guardando..." : "Guardar Cambios"}
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