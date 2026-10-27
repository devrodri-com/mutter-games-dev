import { collection, getDocsFromServer } from 'firebase/firestore';
import { auth, db } from '../firebase';
import type { Category, Product, Subcategory } from '../data/types';
import { normalizeProduct } from '../utils/normalizeProduct';
import { adminApiFetch } from '../utils/adminApi';
import { ensureCredentialSession, type CredentialAdmission } from '../utils/credentialAccess';
import { fetchCategories } from './categories';

export const JOHN_CATALOG_SCOPE = 'JOHN_ADMIN_CLOSED_V1';

export type AdminCatalogProduct = Pick<Product,
  'id' | 'title' | 'category' | 'subcategory' | 'active' | 'images' | 'stockTotal' | 'variants'>
  & { priceUSD?: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function record(value: unknown): Record<string, unknown> { return isRecord(value) ? value : {}; }

function text(value: unknown): string { return typeof value === 'string' ? value : ''; }
function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function catalogProductForDisplay(id: string, input: unknown, categories: Category[], subcategories: Subcategory[]): AdminCatalogProduct {
  const normalized: unknown = normalizeProduct(record(input), categories, subcategories);
  const product = record(normalized);
  const title = record(product.title);
  const category = record(product.category);
  const subcategory = record(product.subcategory);
  const variant = record(Array.isArray(product.variants) ? product.variants[0] : undefined);
  const option = record(Array.isArray(variant.options) ? variant.options[0] : undefined);
  // Only project fields rendered by the existing list. Inventory validity and
  // purchase eligibility never determine whether this publication can be read.
  return {
    id,
    title: { es: text(title.es) || text(product.title) || text(title.en) || 'Sin título', en: text(title.en) },
    category: { id: text(category.id), name: text(category.name) },
    subcategory: { id: text(subcategory.id), name: text(subcategory.name), categoryId: text(category.id) },
    active: product.active === true,
    images: Array.isArray(product.images) ? product.images.filter((image): image is string => typeof image === 'string') : [],
    priceUSD: number(option.priceUSD) ?? number(product.priceUSD),
    stockTotal: number(product.stockTotal),
  };
}

function assertCurrent(admission: CredentialAdmission): void {
  if (auth.currentUser?.uid !== admission.uid || admission.expiresAtMs <= Date.now()
    || !(admission.admin || admission.superadmin)) {
    throw new Error('No pudimos comprobar el acceso actual a las publicaciones.');
  }
}

async function currentAdmission(): Promise<CredentialAdmission> {
  const current = auth.currentUser;
  if (!current) throw new Error('Ingresá a tu cuenta para ver las publicaciones.');
  const admission = await ensureCredentialSession(current);
  assertCurrent(admission);
  return admission;
}

export async function requireWritableCatalog(): Promise<void> {
  const admission = await currentAdmission();
  if (admission.scope === JOHN_CATALOG_SCOPE) {
    throw new Error('Este acceso permite solamente ver las publicaciones. Las compras siguen cerradas.');
  }
}

export type AdminCatalogRead = {
  products: AdminCatalogProduct[];
  categories: Category[];
  subcategories: Subcategory[];
  readOnly: boolean;
};

export async function readAdminCatalog(): Promise<AdminCatalogRead> {
  // The server admission chooses this branch, never a supplied UID or UI flag.
  const admission = await currentAdmission();
  const categories = await fetchCategories();
  const subcategories = categories.flatMap(category => category.subcategories);
  assertCurrent(admission);
  let products: AdminCatalogProduct[];
  if (admission.scope === JOHN_CATALOG_SCOPE) {
    // Server-only read includes inactive publications; no cached/offline fallback.
    const snapshot = await getDocsFromServer(collection(db, 'products'));
    assertCurrent(admission);
    products = snapshot.docs.map(document => catalogProductForDisplay(document.id,
      document.data(), categories, subcategories));
  } else {
    const response: unknown = await adminApiFetch('/api/admin/products');
    assertCurrent(admission);
    if (!response || typeof response !== 'object' || !('products' in response)
      || !Array.isArray(response.products)) throw new Error('Respuesta de publicaciones inválida.');
    products = response.products.map((product: unknown) => normalizeProduct(product, categories, subcategories));
  }
  assertCurrent(admission);
  return { products, categories, subcategories, readOnly: admission.scope === JOHN_CATALOG_SCOPE };
}
