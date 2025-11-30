// src/hooks/useProductForm.ts
import { useState, useEffect, useRef } from "react";
import { useForm, SubmitHandler } from "react-hook-form";
import { Product } from "../data/types";
import { fetchCategories, fetchSubcategories } from "@/firebase/categories";
import { handleImageUpload } from "../utils/handleImageUpload";
import { uploadImageToImageKit } from "../utils/imagekitUtils";
import { generateSlug } from "../utils/generateSlug";
import { TIPOS } from "../constants/tipos";
import { adminApiFetch } from "../utils/adminApi";
import { DragEndEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";

// Tipos locales
type MultilingualName = string | { es?: string; en?: string };

interface LocalCategory {
  id: string;
  name: MultilingualName;
}

interface LocalSubcategory {
  id: string;
  name: MultilingualName;
  categoryId: string;
}

interface LocalProduct extends Omit<Product, "category" | "subcategory"> {
  category: LocalCategory;
  subcategory: LocalSubcategory;
}

export interface Variant {
  label: { es: string; en: string };
  options: { value: string; priceUSD: number; stock: number }[];
}

export interface ProductFormData {
  name: string;
  title: string;
  category: string;
  subcategory: string;
  tipo: string;
  priceUSD: number;
  images: string[];
  active: boolean;
  customizable: boolean;
  sku: string;
  stockTotal: number;
  description: string;
  defaultDescriptionType?: "none" | "camiseta";
  extraDescriptionTop?: string;
  extraDescriptionBottom?: string;
  descriptionPosition?: "top" | "bottom";
}

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

interface UseProductFormOptions {
  initialProduct?: Product;
  mode: "create" | "edit";
  onSuccess?: (product: Product) => void;
  subcategories?: LocalSubcategory[]; // Para EditProductModal que recibe subcategories como prop
}

interface ValidationResult {
  isValid: boolean;
  error?: string;
}

// Función para generar un slug limpio
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

// API helpers
async function createProductAdminAPI(newProduct: Partial<Product>) {
  const { id } = await adminApiFetch("/api/admin/products", {
    method: "POST",
    body: JSON.stringify(newProduct),
  });
  return id;
}

async function updateProductAdminAPI(id: string, data: Partial<Product>) {
  await adminApiFetch(`/api/admin/products/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
  return true;
}

export function useProductForm(options: UseProductFormOptions) {
  const { initialProduct, mode, onSuccess, subcategories: initialSubcategories } = options;

  // Estado del formulario base
  const [formData, setFormData] = useState<ProductFormData>({
    name: "",
    title: "",
    category: "",
    subcategory: "",
    tipo: "",
    priceUSD: 0,
    images: [],
    active: true,
    customizable: true,
    sku: "",
    stockTotal: 0,
    description: "",
    defaultDescriptionType: "none",
    extraDescriptionTop: "",
    extraDescriptionBottom: "",
    descriptionPosition: "bottom",
  });

  // Estados adicionales
  const [titleEn, setTitleEn] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [categories, setCategories] = useState<LocalCategory[]>([]);
  const [subcategories, setSubcategories] = useState<LocalSubcategory[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedSubcategory, setSelectedSubcategory] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [product, setProduct] = useState<Partial<LocalProduct>>({});
  const [uploadingImages, setUploadingImages] = useState(false);
  const [description, setDescription] = useState("");

  // react-hook-form
  const {
    register,
    handleSubmit: rhfHandleSubmit,
    setValue,
    watch,
    control,
    formState: { errors },
  } = useForm<FormData>({
    defaultValues: {
      title: "",
      cjProductId: "",
      defaultDescriptionType: "none",
      extraDescriptionTop: "",
      extraDescriptionBottom: "",
      descriptionPosition: "bottom",
      active: true,
      customizable: true,
    },
  });

  const language = "es"; // Idioma activo

  // Inicializar desde initialProduct (modo edit)
  useEffect(() => {
    if (mode === "edit" && initialProduct) {
      // Normalizar título
      const normalizedTitle =
        typeof initialProduct.title === "string"
          ? { es: initialProduct.title, en: initialProduct.title }
          : {
              es: (initialProduct.title?.es as string) || (initialProduct.title?.en as string) || "",
              en: (initialProduct.title?.en as string) || (initialProduct.title?.es as string) || "",
            };

      setFormData({
        name: initialProduct.name || "",
        title: normalizedTitle.es || "",
        category: initialProduct.category?.id || "",
        subcategory: initialProduct.subcategory?.id || "",
        tipo: initialProduct.tipo || "",
        priceUSD: initialProduct.priceUSD || 0,
        images: initialProduct.images || [],
        active: initialProduct.active ?? true,
        customizable: initialProduct.allowCustomization ?? true,
        sku: initialProduct.sku || "",
        stockTotal: initialProduct.stockTotal || 0,
        description: initialProduct.description || "",
        defaultDescriptionType: (initialProduct.defaultDescriptionType as "none" | "camiseta") || "none",
        extraDescriptionTop: initialProduct.extraDescriptionTop || "",
        extraDescriptionBottom: initialProduct.extraDescriptionBottom || "",
        descriptionPosition: initialProduct.descriptionPosition || "bottom",
      });

      setTitleEn(normalizedTitle.en || "");
      setImages(initialProduct.images || []);
      // Normalizar variants para asegurar que stock siempre sea number
      const normalizedVariants: Variant[] = (initialProduct.variants || []).map((v: any) => ({
        label: v.label || v.title || { es: "", en: "" },
        options: (v.options || []).map((opt: any) => ({
          value: opt.value || "",
          priceUSD: opt.priceUSD || 0,
          stock: opt.stock || 0,
        })),
      }));
      setVariants(normalizedVariants);
      setSelectedCategory(initialProduct.category?.id || "");
      setSelectedSubcategory(initialProduct.subcategory?.id || "");
      setDescription(initialProduct.description || "");

      setProduct({
        ...initialProduct,
        title: normalizedTitle,
        category: initialProduct.category || { id: "", name: "" },
        subcategory: initialProduct.subcategory || { id: "", name: "" },
      });

      // Sincronizar react-hook-form
      setValue("title", normalizedTitle.es || "");
      setValue("active", initialProduct.active ?? true);
      setValue("customizable", initialProduct.allowCustomization ?? true);
      setValue("defaultDescriptionType", (initialProduct.defaultDescriptionType as "none" | "camiseta") || "none");
      setValue("extraDescriptionTop", initialProduct.extraDescriptionTop || "");
      setValue("extraDescriptionBottom", initialProduct.extraDescriptionBottom || "");
      setValue("descriptionPosition", initialProduct.descriptionPosition || "bottom");
    }
  }, [initialProduct, mode, setValue]);

  // Cargar categorías
  useEffect(() => {
    const loadCategories = async () => {
      try {
        const fetchedCategories = await fetchCategories();
        setCategories(fetchedCategories);
      } catch (error) {
        console.error("[useProductForm] Error cargando categorías:", error);
      }
    };
    loadCategories();
  }, []);

  // Cargar subcategorías cuando cambia selectedCategory
  useEffect(() => {
    const loadSubcategories = async () => {
      if (!selectedCategory) {
        setSubcategories([]);
        return;
      }
      try {
        const fetched = await fetchSubcategories(selectedCategory);
        setSubcategories(
          fetched.map((sub) => ({
            ...sub,
            categoryId: selectedCategory,
          }))
        );
      } catch (error) {
        console.error("[useProductForm] Error cargando subcategorías:", error);
      }
    };
    loadSubcategories();
  }, [selectedCategory]);

  // Si EditProductModal pasa subcategories como prop, usarlas
  useEffect(() => {
    if (mode === "edit" && initialSubcategories && initialSubcategories.length > 0) {
      setSubcategories(initialSubcategories);
    }
  }, [mode, initialSubcategories]);

  // Sincronizar formData con selectedCategory
  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      category: selectedCategory,
    }));
  }, [selectedCategory]);

  // Resetear subcategoría cuando cambia categoría
  useEffect(() => {
    setSelectedSubcategory("");
  }, [selectedCategory]);

  // Sincronizar formData con selectedSubcategory
  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      subcategory: selectedSubcategory,
    }));
  }, [selectedSubcategory]);

  // Sincronizar description con formData
  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      description: description,
    }));
  }, [description]);

  // Sincronizar images y variants con formData
  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      images: images,
    }));
  }, [images]);

  // Handlers de imágenes
  const handleImagesUpload = (uploadedImages: string[]) => {
    setImages(uploadedImages);
  };

  const handleImageRemove = (index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  };

  const handleImageReorder = (fromIndex: number, toIndex: number) => {
    setImages((prev) => {
      const newImages = [...prev];
      const [moved] = newImages.splice(fromIndex, 1);
      newImages.splice(toIndex, 0, moved);
      return newImages;
    });
  };

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

  const handleImageUpload = async (file: File) => {
    try {
      const url = await uploadImageToImageKit(file);
      if (url) {
        setImages((prev) => [...prev, url]);
      }
    } catch (e) {
      console.error("Error subiendo imagen:", e);
      throw e;
    }
  };

  // Handlers de variantes
  const handleVariantAdd = () => {
    setVariants((prev) => [
      ...prev,
      { label: { es: "", en: "" }, options: [{ value: "", priceUSD: 0, stock: 0 }] },
    ]);
  };

  const handleVariantRemove = (index: number) => {
    setVariants((prev) => prev.filter((_, i) => i !== index));
  };

  const handleVariantChange = (vIndex: number, field: string, value: any) => {
    setVariants((prev) =>
      prev.map((v, i) => (i === vIndex ? { ...v, [field]: value } : v))
    );
  };

  const handleOptionAdd = (vIndex: number) => {
    setVariants((prev) =>
      prev.map((v, i) =>
        i === vIndex
          ? {
              ...v,
              options: [...v.options, { value: "", priceUSD: 0, stock: 0 }],
            }
          : v
      )
    );
  };

  const handleOptionRemove = (vIndex: number, oIndex: number) => {
    setVariants((prev) =>
      prev.map((v, i) =>
        i === vIndex
          ? { ...v, options: v.options.filter((_, j) => j !== oIndex) }
          : v
      )
    );
  };

  const handleOptionChange = (vIndex: number, oIndex: number, field: string, value: any) => {
    setVariants((prev) =>
      prev.map((v, i) =>
        i === vIndex
          ? {
              ...v,
              options: v.options.map((o, j) => (j === oIndex ? { ...o, [field]: value } : o)),
            }
          : v
      )
    );
  };

  // Validación
  const validate = (): ValidationResult => {
    if (images.length === 0) {
      return { isValid: false, error: "Debes subir al menos una imagen" };
    }

    if (!selectedCategory || !selectedSubcategory) {
      return { isValid: false, error: "Debes seleccionar categoría y subcategoría" };
    }

    if (typeof formData.tipo !== "string" || !formData.tipo.trim()) {
      return { isValid: false, error: "Debes seleccionar un tipo de producto" };
    }

    if (!TIPOS.includes(formData.tipo)) {
      return { isValid: false, error: "El tipo de producto seleccionado no es válido" };
    }

    if (variants.length === 0) {
      return { isValid: false, error: "Debes agregar al menos una variante" };
    }

    const hasInvalidVariant = variants.some(
      (variant) =>
        !variant.label.es.trim() ||
        variant.options.length === 0 ||
        variant.options.some((opt) => !opt.value.trim() || opt.priceUSD < 0 || opt.stock < 0)
    );

    if (hasInvalidVariant) {
      return {
        isValid: false,
        error: "Verifica que todas las variantes tengan nombre, opciones con valor, precio y stock válido",
      };
    }

    return { isValid: true };
  };

  // Submit handler
  const onSubmit: SubmitHandler<FormData> = async (data) => {
    const validation = validate();
    if (!validation.isValid) {
      setError(validation.error || "Error de validación");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const title = data.title.trim();
      const titleEnValue = titleEn.trim() || title;

      // Calcular nombres de categoría y subcategoría
      const categoryRawName = categories.find((cat) => cat.id === selectedCategory)?.name || "";
      const categoryName =
        typeof categoryRawName === "string"
          ? categoryRawName
          : (categoryRawName[language] || categoryRawName.es || "");

      const subcategoryRaw = product?.subcategory?.name || subcategories.find((sub) => sub.id === selectedSubcategory)?.name || "";
      const subcategorySlug =
        typeof subcategoryRaw === "string"
          ? subcategoryRaw
          : subcategoryRaw?.es || subcategoryRaw?.en || "";
      const subcategoryName = subcategorySlug;

      // Generar slug
      const slug =
        mode === "create"
          ? `${generateCleanSlug(title)}-${subcategorySlug.toLowerCase().replace(/\s+/g, "-")}`
          : `${generateSlug(titleEnValue || "")}-${(subcategoryName || "")
              .toLowerCase()
              .replace(/\s+/g, "-")}`;

      // Calcular stockTotal y priceUSD
      const stockTotal = variants.reduce(
        (total, variant) =>
          total + variant.options.reduce((sum, opt) => sum + (opt.stock || 0), 0),
        0
      );

      const priceUSD = Math.min(...variants.flatMap((v) => v.options.map((opt) => opt.priceUSD)));

      // Preparar producto
      const productData: Partial<Product> = {
        title: {
          es: title,
          en: titleEnValue,
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
        images: images,
        allowCustomization: data.customizable,
        customName: "",
        customNumber: "",
        priceUSD: priceUSD,
        variants: variants.map((variant) => ({
          ...variant,
          title: variant.label,
        })),
        sku: formData.sku || "",
        stockTotal: stockTotal,
      };

      if (mode === "create") {
        await createProductAdminAPI(productData);
        setSuccessMessage("¡Producto creado correctamente!");
        if (onSuccess) {
          // Para create, no tenemos el producto completo, solo el id
          setTimeout(() => {
            setSuccessMessage("");
            onSuccess(productData as Product);
          }, 2000);
        }
      } else {
        // Edit mode
        if (!initialProduct?.id) {
          throw new Error("Product ID is required for edit mode");
        }
        const updated = {
          ...initialProduct,
          ...productData,
          id: initialProduct.id,
        } as Product;
        await updateProductAdminAPI(initialProduct.id, updated);
        if (onSuccess) {
          onSuccess(updated);
        }
      }
    } catch (error: any) {
      console.error(`[useProductForm] Error al ${mode === "create" ? "crear" : "actualizar"} producto:`, error);
      setError(error.message || `Error al ${mode === "create" ? "crear" : "actualizar"} el producto. Intente nuevamente.`);
    } finally {
      setLoading(false);
    }
  };

  // Helper para setear campos del formulario
  const setFormField = (field: keyof ProductFormData, value: any) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  // Calcular stock total (read-only)
  const calculatedStockTotal = variants.reduce(
    (total, variant) =>
      total + variant.options.reduce((sum, opt) => sum + (opt.stock || 0), 0),
    0
  );

  // Método submit directo (sin react-hook-form) para EditProductModal
  const submit = async () => {
    const formValues: FormData = {
      title: formData.title,
      cjProductId: "",
      defaultDescriptionType: formData.defaultDescriptionType || "none",
      extraDescriptionTop: formData.extraDescriptionTop || "",
      extraDescriptionBottom: formData.extraDescriptionBottom || "",
      descriptionPosition: formData.descriptionPosition || "bottom",
      active: formData.active,
      customizable: formData.customizable,
    };
    await onSubmit(formValues);
  };

  return {
    // Estado
    formData,
    images,
    variants,
    categories,
    subcategories,
    selectedCategory,
    selectedSubcategory,
    loading,
    error,
    successMessage,
    titleEn,
    setTitleEn,
    description,
    setDescription,
    uploadingImages,
    calculatedStockTotal,

    // react-hook-form
    register,
    handleSubmit: rhfHandleSubmit(onSubmit),
    setValue,
    watch,
    control,
    errors,

    // Handlers
    setFormField,
    handleImagesUpload,
    handleImageRemove,
    handleImageReorder,
    handleDragEnd,
    handleImageUpload,
    handleVariantAdd,
    handleVariantRemove,
    handleVariantChange,
    handleOptionAdd,
    handleOptionRemove,
    handleOptionChange,
    setSelectedCategory,
    setSelectedSubcategory,

    // Validación
    validate,

    // Submit
    onSubmit,
    submit, // Método directo sin react-hook-form
  };
}

