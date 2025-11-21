// src/components/admin/CreateProductForm.tsx

import React, { useState, useEffect, useRef } from "react";
import { handleImageUpload } from "../../utils/handleImageUpload";
import { TIPOS } from "../../constants/tipos";
import ImageUploader from "./ImageUploader";
import TiptapEditor from "./TiptapEditor";
import { useForm, Controller, SubmitHandler } from "react-hook-form";
import { useNavigate, useParams } from "react-router-dom";
import { Product } from "../../data/types";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { fetchSubcategories, fetchCategories, importProductFromCJ } from "../../firebaseUtils";
import { createProduct } from "@/firebase/products";
import { auth } from "../../firebase";

// --- UI helpers (solo estilos, sin lógica) ---
const UI = {
  section: "bg-white rounded-xl border border-gray-200 shadow-sm p-5",
  sectionTitle: "text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3",
  label: "block text-sm font-medium text-gray-700 mb-1",
  input: "w-full p-2.5 rounded-lg border border-gray-300 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#FF2D55] focus:border-[#FF2D55]",
  select: "w-full p-2.5 rounded-lg border border-gray-300 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-[#FF2D55] focus:border-[#FF2D55]",
};

// --- Minimal Headless Select (no deps, only UI) ---
type Option = { value: string; label: string };

function CustomSelect({
  value,
  onChange,
  options,
  placeholder = "Seleccionar...",
  disabled = false,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Option[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value)?.label ?? "";

  return (
    <div ref={ref} className={`relative ${disabled ? "opacity-60 pointer-events-none" : ""}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full p-2.5 pr-10 rounded-lg border border-gray-300 bg-white shadow-sm text-left focus:outline-none focus:ring-2 focus:ring-[#FF2D55] focus:border-[#FF2D55]"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={selected ? "text-gray-900" : "text-gray-400"}>
          {selected || placeholder}
        </span>
        <svg
          className="absolute right-2 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400 pointer-events-none"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="M7 7l3 3 3-3 1.4 1.4L10 12.8 5.6 8.4z" />
        </svg>
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute z-50 mt-1 w-full max-h-60 overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg"
        >
          {options.length === 0 ? (
            <div className="px-3 py-2 text-sm text-gray-500">Sin opciones</div>
          ) : (
            options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={opt.value === value}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 ${
                  opt.value === value ? "bg-gray-50 font-medium" : ""
                }`}
              >
                {opt.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}


// Interfaz para nuestro formulario
interface FormData {
  title: string;
  cjProductId: string;
  defaultDescriptionType: "none" | "camiseta";
  extraDescriptionTop: string;
  extraDescriptionBottom: string;
  descriptionPosition: "top" | "bottom";
  active: boolean;
  customizable: boolean;
}


// Función para generar un slug limpio (sin timestamp ni random)
const generateCleanSlug = (title: string): string => {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
};

async function createProductAdminAPI(newProduct: Partial<Product>) {
  const current = auth.currentUser;
  if (!current) {
    throw new Error("No hay usuario autenticado");
  }

  const idToken = await current.getIdToken();

  const response = await fetch("/api/admin/products", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(newProduct),
  });

  if (!response.ok) {
    let errorMessage = "Error creando producto";
    try {
      const error = await response.json();
      errorMessage = error?.error || errorMessage;
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(errorMessage);
  }

  const { id } = await response.json();
  return id;
}

// Componente para imagen arrastrable
function SortableImageItem({ id, url, onRemove, onMoveLeft, onMoveRight }: {
  id: string;
  url: string;
  onRemove: () => void;
  onMoveLeft: () => void;
  onMoveRight: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative cursor-move group" {...attributes} {...listeners}>
      <img src={url} alt="Vista previa" className="w-full h-40 object-cover rounded border" />
      <button
        type="button"
        onClick={onRemove}
        className="absolute top-1 right-1 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600 transition"
      >
        ×
      </button>
      <div className="absolute bottom-1 left-1 right-1 flex justify-between opacity-0 group-hover:opacity-100 transition">
        <button type="button" onClick={(e) => { e.stopPropagation(); onMoveLeft(); }} className="bg-black/70 text-white rounded-full w-7 h-7 flex items-center justify-center hover:bg-black/90">
          ←
        </button>
        <button type="button" onClick={(e) => { e.stopPropagation(); onMoveRight(); }} className="bg-black/70 text-white rounded-full w-7 h-7 flex items-center justify-center hover:bg-black/90">
          →
        </button>
      </div>
    </div>
  );
}

// 🔥 ACA recién empieza el componente:
export default function CreateProductForm() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    name: "",
    title: "",
    category: "",
    subcategory: "",
    tipo: "", // Nuevo campo para distinguir si es Juego, Consola, Accesorio o Merch
    priceUSD: 0,
    images: [],
    active: true,
    customizable: true,
    sku: "",
    stockTotal: 0,
    description: "", // <--- Aseguramos que description esté presente
  });

  // Estados para campos en inglés
  const [titleEn, setTitleEn] = useState("");

  const [cjProductId, setCjProductId] = useState('');

  // Estado para mensaje de éxito visual
  const [successMessage, setSuccessMessage] = useState("");

  // Estados principales
const [loading, setLoading] = useState(false);
const [error, setError] = useState("");
const [images, setImages] = useState<string[]>([]);
type Category = {
  id: string;
  name: string | { es?: string; en?: string };
};

const [categories, setCategories] = useState<{ id: string; name: string | { es?: string; en?: string } }[]>([]);
const [subcategories, setSubcategories] = useState<{ id: string; name: string | { es?: string; en?: string }; categoryId: string }[]>([]);
const [uploadingImages, setUploadingImages] = useState(false);
const fileInputRef = useRef<HTMLInputElement>(null);
const [selectedCategory, setSelectedCategory] = useState("");
const [selectedSubcategory, setSelectedSubcategory] = useState("");
// Extensiones locales para permitir name multilingüe en category y subcategory
type MultilingualName = string | { es?: string; en?: string };

interface LocalCategory {
  id: string;
  name: MultilingualName;
}

interface LocalSubcategory {
  id: string;
  name: MultilingualName;
}

interface LocalProduct extends Omit<Product, "category" | "subcategory"> {
  category: LocalCategory;
  subcategory: LocalSubcategory;
}

const [product, setProduct] = useState<Partial<LocalProduct>>({});
const [customizable, setCustomizable] = useState(true);

  // Simular idioma activo (en producción vendrá del contexto)
  const language = "es"; // o "en"

  // Options for headless selects
  const categoryOptions: Option[] = categories.map((cat) => ({
    value: cat.id,
    label:
      typeof cat.name === "string"
        ? cat.name
        : (cat.name?.[language] || (cat.name as any)?.es || ""),
  }));

  const subcategoryOptions: Option[] = subcategories
    .filter((sub) => sub.categoryId === selectedCategory)
    .map((sub) => ({
      value: sub.id,
      label:
        typeof sub.name === "string"
          ? sub.name
          : (sub.name?.[language] || (sub.name as any)?.es || ""),
    }));

  const tipoOptions: Option[] = TIPOS.map((t) => ({ value: t, label: t }));

useEffect(() => {
  const loadAllData = async () => {
    try {
      const fetchedCategories = await fetchCategories();
      setCategories(fetchedCategories);

      // Nuevo: cargar subcategorías según la categoría seleccionada
      if (selectedCategory) {
        const fetchedSubcategories = await fetchSubcategories(selectedCategory);
        setSubcategories(
          fetchedSubcategories.map((sub) => ({
            ...sub,
            categoryId: selectedCategory,
          }))
        );
      }

    } catch (error) {
      console.error("[CreateProductForm] Error cargando categorías:", error);
    }
  };

  loadAllData();
}, []);

// Nuevo useEffect: escuchar cambios en selectedCategory y cargar subcategorías dinámicamente
useEffect(() => {
  const loadSubcategories = async () => {
    if (!selectedCategory) return;
    try {
      const fetched = await fetchSubcategories(selectedCategory);
      setSubcategories(
        fetched.map((sub) => ({
          ...sub,
          categoryId: selectedCategory,
        }))
      );
    } catch (error) {
      console.error("Error cargando subcategorías dinámicamente:", error);
    }
  };
  loadSubcategories();
}, [selectedCategory]);

// 🔥 Mantener formData sincronizado con las selecciones
useEffect(() => {
  setFormData((prev) => ({
    ...prev,
    category: selectedCategory,
  }));
}, [selectedCategory]);

useEffect(() => {
  setSelectedSubcategory("");
}, [selectedCategory]);

useEffect(() => {
  setFormData((prev) => ({
    ...prev,
    subcategory: selectedSubcategory,
  }));
}, [selectedSubcategory]);

// 🧹 Luego sigue tu código normal
  // Configuración mejorada de sensores para drag and drop
  // --- Variantes del producto con soporte multilenguaje y precios por opción ---
  const [variants, setVariants] = useState<
  {
    label: { es: string; en: string };
    options: { value: string; priceUSD: number; stock: number }[];
  }[]
>([]);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // puedes ajustar esta distancia si quieres
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  
  
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    control,
    formState: { errors },
  } = useForm<FormData>({
    defaultValues: {
      title: "",
      cjProductId: "",
      defaultDescriptionType: "none", // 🔥 Nuevo
      extraDescriptionTop: "",        // 🔥 Nuevo
      extraDescriptionBottom: "",     // 🔥 Nuevo
      descriptionPosition: "bottom",
      active: true,
      customizable: true,
    },
  });

  // Observar cambios en el equipo seleccionado para actualizar la liga automáticamente

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (over && active.id !== over.id) {
      setImages((items) => {
        const oldIndex = items.findIndex((item) => item === active.id);
        const newIndex = items.findIndex((item) => item === over.id);
        
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };


  // La función de carga de imágenes ahora se maneja a través de handleUpload (ver abajo en el componente ImageUploader)

  // Nueva función para manejar la subida de imágenes (más simple)
  // Siempre sobrescribe la lista de imágenes, nunca concatena
  const handleImagesUpload = (uploadedImages: string[]) => {
    setImages(uploadedImages);
  };

  const handleRemoveImage = (index: number) => {
    // Sobrescribe la lista en vez de concatenar
    setImages((prev) => prev.filter((_, i) => i !== index));
  };
  
  const handleMoveImage = (index: number, direction: "left" | "right") => {
    if (
      (direction === "left" && index === 0) ||
      (direction === "right" && index === images.length - 1)
    ) {
      return;
    }
    const newImages = [...images];
    const newIndex = direction === "left" ? index - 1 : index + 1;
    [newImages[index], newImages[newIndex]] = [newImages[newIndex], newImages[index]];
    // Sobrescribe la lista
    setImages(newImages);
  };

  const onSubmit: SubmitHandler<FormData> = async (data) => {
    if (images.length === 0) {
      setError("Debes subir al menos una imagen");
      return;
    }

    if (!selectedCategory || !selectedSubcategory) {
      setError("Debes seleccionar categoría y subcategoría");
      return;
    }

    // Validar que el campo tipo sea un string no vacío y válido
    if (typeof formData.tipo !== "string" || !formData.tipo.trim()) {
      setError("Debes seleccionar un tipo de producto");
      return;
    }
    if (!TIPOS.includes(formData.tipo)) {
      setError("El tipo de producto seleccionado no es válido");
      return;
    }

    // --- Validación de variantes ---
    if (variants.length === 0) {
      setError("Debes agregar al menos una variante");
      return;
    }

    const hasInvalidVariant = variants.some(variant =>
      !variant.label.es.trim() ||
      variant.options.length === 0 ||
      variant.options.some(opt => !opt.value.trim() || opt.priceUSD < 0 || opt.stock < 0)
    );

    if (hasInvalidVariant) {
      setError("Verifica que todas las variantes tengan nombre, opciones con valor, precio y stock válido");
      return;
    }
    // --- Fin validación variantes ---

    setLoading(true);
    setError("");

    try {
      const title = data.title.trim();
      // Nueva lógica para subcategorySlug y subcategoryName
      const subcategoryRaw = product?.subcategory?.name || "";
      const subcategorySlug = typeof subcategoryRaw === "string"
        ? subcategoryRaw
        : subcategoryRaw?.es || subcategoryRaw?.en || "";
      const subcategoryName = subcategorySlug;
      const slug = `${generateCleanSlug(title)}-${subcategorySlug.toLowerCase().replace(/\s+/g, "-")}`;

      // Verificación de duplicidad de slug (ver comentarios anteriores para implementación)

      const categoryRawName = categories.find((cat) => cat.id === selectedCategory)?.name || "";
      const categoryName = typeof categoryRawName === "string" ? categoryRawName : (categoryRawName[language] || categoryRawName.es || "");
      const subcategoryRawName = subcategories.find((sub) => sub.id === selectedSubcategory)?.name || "";
      // ✅ Ya no se redeclara subcategoryName aquí
      // Guardar los campos title, titleEn, description como string

    // --- SUBIDA DE IMÁGENES ---
    // Si las imágenes ya son URLs, puedes omitir, pero si son archivos, debes subirlas.
    // Aquí asumimos que images es un array de archivos o URLs locales a subir.
    // Si images ya son URLs definitivas, puedes dejar imageUrls = images.
    // Si images son archivos, usa handleImageUpload.
    let imageUrls: string[] = [];
    // Detectar si images son File objects o URLs
    if (images.length > 0 && typeof images[0] !== "string") {
      // images son archivos, subirlas
      for (const image of images as unknown as File[]) {
        const url = await handleImageUpload(image);
        if (url) {
          imageUrls.push(url);
        }
      }
    } else {
      // images ya son URLs
      imageUrls = images;
    }
    // --- FIN SUBIDA DE IMÁGENES ---

      const newProduct: Partial<Product> = {
        title: {
          es: data.title.trim(),
          en: titleEn.trim(),
        },
        description: formData.description,
        slug: slug,
        category: { id: selectedCategory, name: categoryName },
        subcategory: selectedSubcategory
          ? {
              id: selectedSubcategory,
              name: subcategoryName,
              categoryId: selectedCategory,
            }
          : { id: "", name: "", categoryId: selectedCategory },
        tipo: formData.tipo,
        defaultDescriptionType: data.defaultDescriptionType || "none",
        extraDescriptionTop: data.extraDescriptionTop || "",
        extraDescriptionBottom: data.extraDescriptionBottom || "",
        descriptionPosition: data.descriptionPosition || "bottom",
        active: data.active,
        images: imageUrls,
        allowCustomization: data.customizable,
        customName: "",
        customNumber: "",
        // 💲 Agregar priceUSD como el menor precio de todas las variantes
        priceUSD: Math.min(...variants.flatMap(v => v.options.map(opt => opt.priceUSD))),
        variants: variants.map((variant) => ({
          ...variant,
          title: variant.label,
        })),
        sku: formData.sku || "",
        stockTotal: variants.reduce(
          (total, variant) =>
            total + variant.options.reduce((sum, opt) => sum + (opt.stock || 0), 0),
          0
        ),
      };

      if (import.meta.env.DEV) {
        console.log("🧪 DEBUG: createProduct =", createProduct.toString());
      }

      if (import.meta.env.DEV) {
        await createProduct(newProduct);
      } else {
        await createProductAdminAPI(newProduct);
      }
      setSuccessMessage("¡Producto creado correctamente!");
      setTimeout(() => {
        setSuccessMessage("");
        navigate("/admin/productos");
      }, 2000);
    } catch (error) {
      console.error("[CreateProductForm] Error al crear producto:", error);
      setError("Error al crear el producto. Intente nuevamente.");
    } finally {
      setLoading(false);
    }
  };

  const handleFormValidation = async (data: any) => {
  
    if (!selectedCategory) {
      alert("Por favor selecciona una categoría");
      return;
    }
  
    if (!selectedSubcategory) {
      alert("Por favor selecciona una subcategoría");
      return;
    }
  
    // ✅ Si pasa validaciones
    handleSubmit(data);
  };

  return (
    <>
      {successMessage && (
  <div className="bg-green-50 border border-green-200 text-green-800 p-4 rounded-lg mb-4">
    {successMessage}
  </div>
)}
<form onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-w-4xl mx-auto pb-[calc(env(safe-area-inset-bottom)+88px)] md:pb-10">

        {/* Error general */}
        {error && (
          <div className="bg-red-50 text-red-700 p-4 rounded-lg border border-red-200">{error}</div>
        )}


        {/* BASICOS */}
<div className={UI.section}>
  <h3 className={UI.sectionTitle}>Información básica</h3>
  <div className="grid grid-cols-1 gap-4">
    <div>
      <label htmlFor="title" className={UI.label}>
        Título del producto <span className="text-red-500">*</span>
      </label>
      <input
        id="title"
        type="text"
        {...register("title", { required: "El título es obligatorio" })}
        className={UI.input}
        placeholder="Ej: Omega 3 Ultra"
      />
      {errors.title && (
        <span className="text-red-500 text-sm">{errors.title.message}</span>
      )}
    </div>

    <div>
      <label className={UI.label}>
        Descripción <span className="text-red-500">*</span>
      </label>
      <div className="rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
        <TiptapEditor
          content={formData.description}
          onChange={(value) =>
            setFormData((prev) => ({ ...prev, description: value }))
          }
        />
      </div>
    </div>
  </div>
</div>

      {/* CLASIFICACIÓN */}
<div className={UI.section}>
  <h3 className={UI.sectionTitle}>Clasificación</h3>

  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
    {/* Categoría */}
    <div className="md:col-span-1">
      <label className={UI.label}>Categoría</label>
      <CustomSelect
        value={selectedCategory}
        onChange={(value) => {
          setSelectedCategory(value);
          const categoryName = categories.find((cat) => cat.id === value)?.name || "";
          setProduct((prev) => ({ ...prev, category: { id: value, name: categoryName } }));
        }}
        options={categoryOptions}
        placeholder="Categoría"
      />
    </div>

    {/* Subcategoría */}
    <div className="md:col-span-1">
      <label className={UI.label}>Subcategoría</label>
      <CustomSelect
        value={selectedSubcategory}
        onChange={(value) => {
          setSelectedSubcategory(value);
          const subcategoryName = subcategories.find((sub) => sub.id === value)?.name || "";
          setProduct((prev) => ({ ...prev, subcategory: { id: value, name: subcategoryName } }));
        }}
        options={subcategoryOptions}
        placeholder="Subcategoría"
        disabled={!selectedCategory}
      />
    </div>

    {/* Tipo */}
    <div className="md:col-span-1">
      <label className={UI.label}>
        Tipo <span className="text-red-500">*</span>
      </label>
      <CustomSelect
        value={formData.tipo || ""}
        onChange={(value) =>
          setFormData((prev) => ({ ...prev, tipo: value }))
        }
        options={tipoOptions}
        placeholder="Seleccionar tipo"
      />
    </div>
  </div>
</div>

        {/* Precios */}



      {/* ESTADO */}
<div className={UI.section}>
  <h3 className={UI.sectionTitle}>Estado</h3>
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        {...register("active")}
        className="text-[#FF2D55] rounded focus:ring-[#FF2D55] h-5 w-5"
      />
      <span>Producto activo (visible para clientes)</span>
    </label>

    <div>
      <label className={UI.label}>Stock disponible</label>
      <input
        type="number"
        readOnly
        value={variants.reduce(
          (total, variant) =>
            total + variant.options.reduce((sum, opt) => sum + (opt.stock || 0), 0),
          0
        )}
        className="block w-full rounded-lg border-gray-200 bg-gray-100 shadow-sm focus:outline-none cursor-not-allowed p-2.5"
      />
    </div>
  </div>
</div>

      {/* IMÁGENES */}
<div className={UI.section}>
  <h3 className={UI.sectionTitle}>Imágenes</h3>

  <div className="flex justify-between items-center">
    <label className={UI.label}>
      Imágenes <span className="text-red-500">*</span>
    </label>
    <ImageUploader onChange={handleImagesUpload} images={images} />
  </div>

  {images.length > 0 ? (
    <div className="mt-4">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          <SortableContext items={images} strategy={verticalListSortingStrategy}>
            {images.map((url, index) => (
              <SortableImageItem
                key={url}
                id={url}
                url={url}
                onRemove={() => handleRemoveImage(index)}
                onMoveLeft={() => handleMoveImage(index, "left")}
                onMoveRight={() => handleMoveImage(index, "right")}
              />
            ))}
          </SortableContext>
        </div>
      </DndContext>
    </div>
  ) : (
    <div className="mt-4 border-2 border-dashed border-gray-300 rounded-md p-6 text-center text-gray-500">
      No hay imágenes cargadas
    </div>
  )}
</div>

        {/* VARIANTES */}
<div className={UI.section}>
  <h3 className={UI.sectionTitle}>Variantes del producto</h3>

  {variants.map((variant, vIndex) => (
    <div key={vIndex} className="mb-4 border border-gray-200 p-4 rounded-lg bg-gray-50">
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Nombre de la variante</label>
        <input
          type="text"
          className={UI.input}
          placeholder="Ej: Tamaño"
          value={variant.label.es}
          onChange={(e) => {
            const updated = [...variants];
            updated[vIndex].label.es = e.target.value;
            setVariants(updated);
          }}
        />
      </div>

      {variant.options.map((option, oIndex) => (
        <div key={oIndex} className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-2">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Valor</label>
            <input
              type="text"
              className={UI.input}
              placeholder="Ej: Joystick Original"
              value={option.value}
              onChange={(e) => {
                const updated = [...variants];
                updated[vIndex].options[oIndex].value = e.target.value;
                setVariants(updated);
              }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Precio</label>
            <input
              type="number"
              step="0.01"
              min={0}
              className={UI.input}
              value={option.priceUSD}
              onChange={(e) => {
                const updated = [...variants];
                updated[vIndex].options[oIndex].priceUSD = parseFloat(e.target.value || "0");
                setVariants(updated);
              }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Stock</label>
            <input
              type="number"
              min={0}
              className={UI.input}
              value={option.stock || 0}
              onChange={(e) => {
                const updated = [...variants];
                updated[vIndex].options[oIndex].stock = parseInt(e.target.value || "0");
                setVariants(updated);
              }}
            />
          </div>

          <div className="md:col-span-3 flex justify-end">
            <button
              type="button"
              className="text-red-600 text-xs mt-1"
              onClick={() => {
                const updated = [...variants];
                updated[vIndex].options.splice(oIndex, 1);
                setVariants(updated);
              }}
            >
              Eliminar esta opción
            </button>
          </div>
        </div>
      ))}

      <div className="flex items-center gap-4 mt-2">
        <button
          type="button"
          className="text-[#FF2D55] text-sm"
          onClick={() => {
            const updated = [...variants];
            updated[vIndex].options.push({ value: "", priceUSD: 0, stock: 0 });
            setVariants(updated);
          }}
        >
          + Agregar opción
        </button>

        <button
          type="button"
          className="text-red-600 text-sm"
          onClick={() => {
            const updated = [...variants];
            updated.splice(vIndex, 1);
            setVariants(updated);
          }}
        >
          🗑️ Eliminar variante
        </button>
      </div>
    </div>
  ))}

  <button
    type="button"
    className="text-[#FF2D55] mt-2"
    onClick={() => {
      setVariants([
        ...variants,
        { label: { es: "", en: "" }, options: [{ value: "", priceUSD: 0, stock: 0 }] },
      ]);
    }}
  >
    + Agregar variante
  </button>
</div>
        {/* Botón de envío */}
        <div className="pt-4 hidden md:block">
          <button
            type="submit"
            disabled={loading || uploadingImages}
            className={`w-full py-3 px-4 rounded-md font-medium transition-colors ${
              loading || uploadingImages
                ? "bg-gray-400 text-white cursor-not-allowed"
                : "bg-[#FF2D55] hover:bg-[#CC1E44] text-white"
            }`}
          >
            {loading ? (
              <div className="flex items-center justify-center">
                <svg className="animate-spin -ml-1 mr-2 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Guardando...
              </div>
            ) : (
              "Crear publicación"
            )}
          </button>
        </div>
        {/* Sticky actions on mobile */}
        <div className="md:hidden fixed bottom-0 left-0 right-0 border-t bg-white/95 backdrop-blur z-50 shadow-[0_-8px_14px_rgba(0,0,0,0.08)]" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          <div className="max-w-4xl mx-auto px-4 py-3 flex gap-3">
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="flex-1 h-12 rounded-md border border-gray-300 text-gray-700"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={loading || uploadingImages}
              className={`flex-1 h-12 rounded-md font-medium ${
                loading || uploadingImages
                  ? "bg-gray-400 text-white"
                  : "bg-[#FF2D55] text-white hover:bg-[#CC1E44] shadow-sm"
              }`}
            >
              {loading ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}