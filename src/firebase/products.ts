import { collection, getDocsFromServer, doc, getDocFromServer, addDoc, updateDoc, deleteDoc, query, where, limit, startAfter, QueryDocumentSnapshot } from "firebase/firestore";
import type { Product } from "../data/types";
import { db } from "../firebaseUtils";
import { isPublished, mapCatalogProduct } from "../domain/catalog";
export interface FetchProductsPageOptions { limit:number; cursor?:QueryDocumentSnapshot|null; filters?:{categoryId?:string;subcategoryId?:string} }
export interface FetchProductsPageResult { products:Product[];lastDoc:QueryDocumentSnapshot|null;hasMore:boolean }
export async function fetchProductsPage(options:FetchProductsPageOptions):Promise<FetchProductsPageResult>{
  const constraints=[where("active","==",true)];
  if(options.filters?.categoryId)constraints.push(where("category.id","==",options.filters.categoryId));
  if(options.filters?.subcategoryId)constraints.push(where("subcategory.id","==",options.filters.subcategoryId));
  const q=query(collection(db,"products"),...constraints,limit(options.limit+1),...(options.cursor?[startAfter(options.cursor)]:[]));
  const snapshot=await getDocsFromServer(q);const docs=snapshot.docs.slice(0,options.limit);
  return {products:docs.map(d=>mapCatalogProduct(d.id,d.data())),lastDoc:docs.at(-1)??null,hasMore:snapshot.docs.length>options.limit};
}
export async function fetchProductById(id:string):Promise<Product|null>{
  const snapshot=await getDocFromServer(doc(db,"products",id));
  if(!snapshot.exists()||!isPublished(snapshot.data()))return null;
  return mapCatalogProduct(snapshot.id,snapshot.data());
}
export async function fetchProducts():Promise<Product[]>{
  const products:Product[]=[];let cursor:QueryDocumentSnapshot|null=null;
  do{const page=await fetchProductsPage({limit:100,cursor});products.push(...page.products);cursor=page.hasMore?page.lastDoc:null;}while(cursor);
  return products.sort((a,b)=>(a.title.es||a.name).localeCompare(b.title.es||b.name,'es'));
}
export async function fetchProductsByCategory(categoryName:string,maxItems=8):Promise<Product[]>{
  const snapshot=await getDocsFromServer(query(collection(db,"products"),where("active","==",true),where("category.name","==",categoryName),limit(maxItems)));
  return snapshot.docs.map(d=>mapCatalogProduct(d.id,d.data()));
}
export async function fetchProductBySlug(slug:string):Promise<Product|null>{
  const snapshot=await getDocsFromServer(query(collection(db,"products"),where("active","==",true),where("slug","==",slug),limit(1)));
  if(!snapshot.empty)return mapCatalogProduct(snapshot.docs[0].id,snapshot.docs[0].data());
  // Legacy computed routes start with the document ID. Resolve only candidate IDs;
  // never download the full collection for a missing detail route.
  const boundaries=[...slug.matchAll(/-/g)].map(match=>match.index).slice(0,30);
  for(const boundary of boundaries){const product=await fetchProductById(slug.slice(0,boundary));if(product?.slug===slug)return product;}
  return null;
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
