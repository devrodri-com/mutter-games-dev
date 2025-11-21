// src/firebase/categories.ts

import { collection, getDocs, doc, addDoc, deleteDoc } from "firebase/firestore";
import { Category } from "../data/types";
import { db } from "../firebaseUtils";

export async function fetchCategoriesWithSubcategories(): Promise<
  {
    id: string;
    name: string;
    subcategories: { id: string; name: string }[];
  }[]
> {
  const ref = collection(db, "categories");
  const snap = await getDocs(ref);

  const categories = await Promise.all(
    snap.docs.map(async (docSnap) => {
      const subRef = collection(db, `categories/${docSnap.id}/subcategories`);
      const subSnap = await getDocs(subRef);
      const subcategories = subSnap.docs.map((subDoc) => ({
        id: subDoc.id,
        name: subDoc.data().name,
      }));
      return {
        id: docSnap.id,
        name: docSnap.data().name || "",
        subcategories,
      };
    })
  );

  return categories;
}

export async function createCategory(name: { es: string; en: string }) {
  try {
    const ref = collection(db, "categories");
    await addDoc(ref, { name });
  } catch (error) {
    console.error("Error creando categoría:", error);
    throw error;
  }
}

export async function deleteCategory(id: string) {
  try {
    const ref = doc(db, "categories", id);
    await deleteDoc(ref);
  } catch (error) {
    console.error("Error eliminando categoría:", error);
    throw error;
  }
}

export async function createSubcategory(categoryId: string, subcategoryName: string) {
  try {
    const ref = collection(db, `categories/${categoryId}/subcategories`);
    await addDoc(ref, { name: subcategoryName });
  } catch (error) {
    console.error("Error creando subcategoría:", error);
    throw error;
  }
}

export async function deleteSubcategory(categoryId: string, subcategoryId: string) {
  try {
    const ref = doc(db, `categories/${categoryId}/subcategories/${subcategoryId}`);
    await deleteDoc(ref);
  } catch (error) {
    console.error("Error eliminando subcategoría:", error);
    throw error;
  }
}

export async function fetchSubcategories(
  categoryId: string
): Promise<{ id: string; name: string; categoryId: string }[]> {
  const ref = collection(db, `categories/${categoryId}/subcategories`);
  const snap = await getDocs(ref);
  return snap.docs.map((docSnap) => {
    const rawName = docSnap.data().name;
    const name =
      typeof rawName === "string"
        ? rawName
        : typeof rawName?.es === "string"
        ? rawName.es
        : typeof rawName?.en === "string"
        ? rawName.en
        : "";

    return {
      id: docSnap.id,
      name,
      categoryId,
    };
  });
}

export async function fetchCategories(): Promise<Category[]> {
  const ref = collection(db, "categories");
  const snap = await getDocs(ref);

  const categories = await Promise.all(
    snap.docs.map(async (docSnap) => {
      const rawName = docSnap.data().name;
      const name =
        typeof rawName === "string"
          ? rawName
          : typeof rawName?.es === "string"
          ? rawName.es
          : typeof rawName?.en === "string"
          ? rawName.en
          : "";

      const subRef = collection(db, `categories/${docSnap.id}/subcategories`);
      const subSnap = await getDocs(subRef);
      const subcategories = subSnap.docs.map((subDoc) => {
        const raw = subDoc.data().name;
        const subName =
          typeof raw === "string"
            ? raw
            : typeof raw?.es === "string"
            ? raw.es
            : typeof raw?.en === "string"
            ? raw.en
            : "";
        return {
          id: subDoc.id,
          name: subName,
          categoryId: docSnap.id,
          orden: subDoc.data().orden ?? 0,
        };
      });

      return {
        id: docSnap.id,
        name,
        categoryId: docSnap.id,
        subcategories,
        orden: docSnap.data().orden ?? 0,
      };
    })
  );

  return categories.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
}

export const fetchAllSubcategories = async (): Promise<
  { id: string; name: string; categoryId: string }[]
> => {
  try {
    const categoriesSnapshot = await getDocs(collection(db, "categories"));
    const allSubcategories: { id: string; name: string; categoryId: string }[] = [];

    for (const catDoc of categoriesSnapshot.docs) {
      const categoryId = catDoc.id;
      const subRef = collection(db, "categories", categoryId, "subcategories");
      const subSnap = await getDocs(subRef);

      subSnap.forEach((subDoc) => {
        const rawName = subDoc.data().name;
        const name =
          typeof rawName === "string"
            ? rawName
            : typeof rawName?.es === "string"
            ? rawName.es
            : typeof rawName?.en === "string"
            ? rawName.en
            : "";

        allSubcategories.push({
          id: subDoc.id,
          name,
          categoryId,
        });
      });
    }

    if (import.meta?.env?.DEV) console.log("🧩 Subcategorías embebidas obtenidas:", allSubcategories);
    return allSubcategories;
  } catch (error) {
    console.error("❌ Error al obtener subcategorías embebidas:", error);
    return [];
  }
};

