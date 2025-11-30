// src/components/admin/CreateProductForm.tsx

import React from "react";
import { useNavigate } from "react-router-dom";
import { TIPOS } from "../../constants/tipos";
import ImageUploader from "./ImageUploader";
import TiptapEditor from "./TiptapEditor";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useProductForm } from "../../hooks/useProductForm";

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
  const navigate = useNavigate();

  // Usar el hook para toda la lógica
  const form = useProductForm({
    mode: "create",
    onSuccess: () => {
      setTimeout(() => {
        navigate("/admin/productos");
      }, 2000);
    },
  });

  // Configuración de sensores para drag and drop
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Options for headless selects
  const language = "es";
  const categoryOptions: Option[] = form.categories.map((cat) => ({
    value: cat.id,
    label:
      typeof cat.name === "string"
        ? cat.name
        : (cat.name?.[language] || (cat.name as any)?.es || ""),
  }));

  const subcategoryOptions: Option[] = form.subcategories
    .filter((sub) => sub.categoryId === form.selectedCategory)
    .map((sub) => ({
      value: sub.id,
      label:
        typeof sub.name === "string"
          ? sub.name
          : (sub.name?.[language] || (sub.name as any)?.es || ""),
    }));

  const tipoOptions: Option[] = TIPOS.map((t) => ({ value: t, label: t }));

  // Helper para mover imagen (left/right)
  const handleMoveImage = (index: number, direction: "left" | "right") => {
    if (
      (direction === "left" && index === 0) ||
      (direction === "right" && index === form.images.length - 1)
    ) {
      return;
    }
    const newIndex = direction === "left" ? index - 1 : index + 1;
    form.handleImageReorder(index, newIndex);
  };

  return (
    <>
      {form.successMessage && (
        <div className="bg-green-50 border border-green-200 text-green-800 p-4 rounded-lg mb-4">
          {form.successMessage}
        </div>
      )}
      <form onSubmit={form.handleSubmit} className="space-y-6 max-w-4xl mx-auto pb-[calc(env(safe-area-inset-bottom)+88px)] md:pb-10">

        {/* Error general */}
        {form.error && (
          <div className="bg-red-50 text-red-700 p-4 rounded-lg border border-red-200">{form.error}</div>
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
          {...form.register("title", { required: "El título es obligatorio" })}
          className={UI.input}
          placeholder="Ej: Omega 3 Ultra"
        />
        {form.errors.title && (
          <span className="text-red-500 text-sm">{form.errors.title.message}</span>
        )}
      </div>

      <div>
        <label className={UI.label}>
          Descripción <span className="text-red-500">*</span>
        </label>
        <div className="rounded-lg border border-gray-200 bg-white p-2 shadow-sm">
          <TiptapEditor
            content={form.description}
            onChange={form.setDescription}
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
        value={form.selectedCategory}
        onChange={form.setSelectedCategory}
        options={categoryOptions}
        placeholder="Categoría"
      />
    </div>

    {/* Subcategoría */}
    <div className="md:col-span-1">
      <label className={UI.label}>Subcategoría</label>
      <CustomSelect
        value={form.selectedSubcategory}
        onChange={form.setSelectedSubcategory}
        options={subcategoryOptions}
        placeholder="Subcategoría"
        disabled={!form.selectedCategory}
      />
    </div>

    {/* Tipo */}
    <div className="md:col-span-1">
      <label className={UI.label}>
        Tipo <span className="text-red-500">*</span>
      </label>
      <CustomSelect
        value={form.formData.tipo || ""}
        onChange={(value) => form.setFormField("tipo", value)}
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
        {...form.register("active")}
        className="text-[#FF2D55] rounded focus:ring-[#FF2D55] h-5 w-5"
      />
      <span>Producto activo (visible para clientes)</span>
    </label>

    <div>
      <label className={UI.label}>Stock disponible</label>
      <input
        type="number"
        readOnly
        value={form.calculatedStockTotal}
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
    <ImageUploader onChange={form.handleImagesUpload} images={form.images} />
  </div>

  {form.images.length > 0 ? (
    <div className="mt-4">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={form.handleDragEnd}
      >
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          <SortableContext items={form.images} strategy={verticalListSortingStrategy}>
            {form.images.map((url, index) => (
              <SortableImageItem
                key={url}
                id={url}
                url={url}
                onRemove={() => form.handleImageRemove(index)}
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

  {form.variants.map((variant, vIndex) => (
    <div key={vIndex} className="mb-4 border border-gray-200 p-4 rounded-lg bg-gray-50">
      <div className="mb-3">
        <label className="block text-xs font-medium text-gray-600 mb-1">Nombre de la variante</label>
        <input
          type="text"
          className={UI.input}
          placeholder="Ej: Tamaño"
          value={variant.label.es}
          onChange={(e) => {
            form.handleVariantChange(vIndex, "label", {
              ...variant.label,
              es: e.target.value,
              en: e.target.value,
            });
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
                form.handleOptionChange(vIndex, oIndex, "value", e.target.value);
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
                form.handleOptionChange(vIndex, oIndex, "priceUSD", parseFloat(e.target.value || "0"));
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
                form.handleOptionChange(vIndex, oIndex, "stock", parseInt(e.target.value || "0"));
              }}
            />
          </div>

          <div className="md:col-span-3 flex justify-end">
            <button
              type="button"
              className="text-red-600 text-xs mt-1"
              onClick={() => {
                form.handleOptionRemove(vIndex, oIndex);
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
            form.handleOptionAdd(vIndex);
          }}
        >
          + Agregar opción
        </button>

        <button
          type="button"
          className="text-red-600 text-sm"
          onClick={() => {
            form.handleVariantRemove(vIndex);
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
    onClick={form.handleVariantAdd}
  >
    + Agregar variante
  </button>
</div>
        {/* Botón de envío */}
        <div className="pt-4 hidden md:block">
          <button
            type="submit"
            disabled={form.loading || form.uploadingImages}
            className={`w-full py-3 px-4 rounded-md font-medium transition-colors ${
              form.loading || form.uploadingImages
                ? "bg-gray-400 text-white cursor-not-allowed"
                : "bg-[#FF2D55] hover:bg-[#CC1E44] text-white"
            }`}
          >
            {form.loading ? (
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
              disabled={form.loading || form.uploadingImages}
              className={`flex-1 h-12 rounded-md font-medium ${
                form.loading || form.uploadingImages
                  ? "bg-gray-400 text-white"
                  : "bg-[#FF2D55] text-white hover:bg-[#CC1E44] shadow-sm"
              }`}
            >
              {form.loading ? "Guardando..." : "Guardar"}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}