// src/firebase/products.ts
import { collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, query, where } from "firebase/firestore";
import { Product } from "../data/types";
import { db } from "../firebaseUtils";

function mapProductData(id: string, data: any): Product {
  return {
    id,
    slug:
      data.slug ||
      `${id}-${(typeof data.title === "string" ? data.title : data.title?.es || "producto")
        .toLowerCase()
        .replace(/\s+/g, "-")}`,
    name: data.name || (typeof data.title === "string" ? data.title : data.title?.es) || "Producto sin nombre",
    title: {
      es:
        typeof data.title === "object" && typeof data.title?.es === "string"
          ? data.title.es
          : typeof data.title === "string"
          ? data.title
          : typeof data.titleEs === "string"
          ? data.titleEs
          : "Producto",
      en:
        typeof data.title === "object" && typeof data.title?.en === "string"
          ? data.title.en
          : typeof data.titleEn === "string"
          ? data.titleEn
          : "",
    },
    images: data.images || [],
    priceUSD: data.priceUSD || 0,
    category: data.category || { id: "", name: "" },
    subcategory: data.subcategory || { id: "", name: "" },
    tipo: data.tipo || "",
    subtitle: data.subtitle || "",
    description: data.description || "",
    defaultDescriptionType: data.defaultDescriptionType || "none",
    extraDescriptionTop: data.extraDescriptionTop || "",
    extraDescriptionBottom: data.extraDescriptionBottom || "",
    descriptionPosition: data.descriptionPosition || "bottom",
    active: data.active ?? true,
    customName: data.customName || "",
    customNumber: data.customNumber || "",
    allowCustomization: data.allowCustomization ?? false,
    stockTotal: data.stockTotal ?? 0,
    variants: Array.isArray(data.variants) ? data.variants : [],
  };
}

export async function fetchProductById(id: string): Promise<Product | null> {
  try {
    const ref = doc(db, "products", id);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data();
    return mapProductData(snap.id, data);
  } catch (error) {
    console.error("Error fetching product by ID:", error);
    return null;
  }
}

export async function fetchProducts(): Promise<Product[]> {
  const productsCollection = collection(db, "products");
  const productsSnapshot = await getDocs(productsCollection);

  const productsList = productsSnapshot.docs.map((docSnap) => {
    const data = docSnap.data() as any;
    const rawTitle = data.title;
    const title = {
      es:
        typeof rawTitle === "object" && typeof rawTitle?.es === "string"
          ? rawTitle.es
          : typeof rawTitle === "string"
          ? rawTitle
          : typeof data.titleEs === "string"
          ? data.titleEs
          : "Producto",
      en:
        typeof rawTitle === "object" && typeof rawTitle?.en === "string"
          ? rawTitle.en
          : typeof data.titleEn === "string"
          ? data.titleEn
          : "",
    };

    return {
      id: docSnap.id,
      slug: data.slug || `${docSnap.id}-${title.es.toLowerCase().replace(/\s+/g, "-")}`,
      name: title.es || data.name || "Producto sin nombre",
      title,
      images: data.images || [],
      priceUSD: data.priceUSD || 0,
      category: data.category || { id: "", name: "" },
      subcategory: data.subcategory || { id: "", name: "" },
      tipo: data.tipo || "",
      subtitle: data.subtitle || "",
      description: data.description || "",
      defaultDescriptionType: data.defaultDescriptionType || "none",
      extraDescriptionTop: data.extraDescriptionTop || "",
      extraDescriptionBottom: data.extraDescriptionBottom || "",
      descriptionPosition: data.descriptionPosition || "bottom",
      active: data.active ?? true,
      customName: data.customName || "",
      customNumber: data.customNumber || "",
      allowCustomization: data.allowCustomization ?? false,
      stockTotal: data.stockTotal ?? 0,
      variants: Array.isArray(data.variants) ? data.variants : [],
      orden: typeof data.orden === "number" ? data.orden : 0,
    } as Product & { orden?: number };
  }) as (Product & { orden?: number })[];

  productsList.sort((a, b) => {
    const ao = typeof (a as any).orden === "number" ? (a as any).orden : 0;
    const bo = typeof (b as any).orden === "number" ? (b as any).orden : 0;
    if (ao !== bo) return ao - bo;
    const an = (a.title?.es || a.name || "").toString();
    const bn = (b.title?.es || b.name || "").toString();
    return an.localeCompare(bn, "es");
  });

  if (import.meta?.env?.DEV) {
    console.log("🔥 DEBUG desde firebaseUtils – productos cargados (ordenados):", productsList);
  }

  return productsList.map(({ orden, ...rest }) => rest);
}

export async function fetchProductBySlug(slug: string): Promise<Product | null> {
  try {
    const productsCollection = collection(db, "products");

    // 1) Intentar buscar por coincidencia exacta del campo slug
    const exactQuery = query(productsCollection, where("slug", "==", slug));
    const exactSnap = await getDocs(exactQuery);

    if (!exactSnap.empty) {
      const docSnap = exactSnap.docs[0];
      const data = docSnap.data();
      return mapProductData(docSnap.id, data);
    }

    // 2) Fallback para productos antiguos sin campo slug consistente
    const productsSnapshot = await getDocs(productsCollection);
    for (const productDoc of productsSnapshot.docs) {
      const data = productDoc.data() as any;
      const baseTitle =
        typeof data.title === "string"
          ? data.title
          : data?.title?.es || data?.name || "producto";
      const computedSlug =
        data.slug ||
        `${productDoc.id}-${String(baseTitle).toLowerCase().replace(/\s+/g, "-")}`;

      if (computedSlug === slug) {
        return mapProductData(productDoc.id, data);
      }
    }

    return null;
  } catch (error) {
    console.error("Error al obtener producto por Slug:", error);
    return null;
  }
}

export async function createProduct(product: Partial<Product>) {
  try {
    if (!product.slug || typeof product.slug !== "string" || product.slug.trim() === "") {
      const rawTitle = typeof product.title === "object" ? product.title?.es || product.title?.en : product.title;
      const fallback = (rawTitle || "producto-generico").toLowerCase().replace(/\s+/g, "-");
      const subcat =
        typeof product.subcategory?.name === "string"
          ? product.subcategory.name
          : ((product.subcategory?.name as unknown) as { es?: string })?.es || "";
      product.slug = `${fallback}-${subcat.toLowerCase().replace(/\s+/g, "-")}`;
    }

    const productsCollection = collection(db, "products");
    const docRef = await addDoc(productsCollection, product);
    if (import.meta?.env?.DEV) {
      console.log("✅ Producto creado con ID:", docRef.id, "| Slug:", product.slug);
    }
    return docRef.id;
  } catch (error) {
    console.error("❌ Error creando producto:", error);
    throw error;
  }
}

export async function updateProduct(productId: string, updatedData: Partial<Product>) {
  try {
    const productRef = doc(db, "products", productId);
    if (updatedData.variants && Array.isArray(updatedData.variants)) {
      updatedData.variants = updatedData.variants.map((variant) => ({
        ...variant,
        options: variant.options.map((option) => ({
          ...option,
          priceUSD: parseFloat(String(option.priceUSD || 0)),
        })),
      }));
    }

    let updatedProduct = { ...updatedData };
    if (updatedData.subcategory && typeof updatedData.subcategory === "object") {
      const selectedSubcategory = updatedData.subcategory as any;

      let subcategoryName = "";
      if (typeof selectedSubcategory.name === "string") {
        subcategoryName = selectedSubcategory.name;
      } else if (typeof selectedSubcategory.name === "object") {
        subcategoryName = selectedSubcategory.name.es || selectedSubcategory.name.en || "";
      }

      updatedProduct.subcategory = {
        id: selectedSubcategory.id,
        name: subcategoryName,
        categoryId: selectedSubcategory.categoryId || "",
      };
    }

    await updateDoc(productRef, updatedProduct);
    if (import.meta?.env?.DEV) {
      console.log("Producto actualizado:", productId);
    }
  } catch (error) {
    console.error("Error actualizando producto:", error);
    throw error;
  }
}

export async function deleteProduct(productId: string) {
  try {
    const productRef = doc(db, "products", productId);
    await deleteDoc(productRef);
    if (import.meta?.env?.DEV) {
      console.log("Producto eliminado:", productId);
    }
  } catch (error) {
    console.error("Error eliminando producto:", error);
    throw error;
  }
}
