import { collection, getDocsFromServer, query, where } from 'firebase/firestore';
import type { Product } from '../data/types';
import { isPublished, mapCatalogProduct } from '../domain/catalog';
import { db } from '../firebaseUtils';
import { fetchProductsPage } from './products';

let initialFlight: Promise<Product[]> | null = null;
let snapshotFlight: Promise<Product[]> | null = null;

/** Share concurrent readers only; settled catalog data is never cached here. */
export function fetchInitialShopProducts(): Promise<Product[]> {
  if (initialFlight) return initialFlight;
  const request = fetchProductsPage({ limit: 24 }).then(page => page.products.filter(isPublished));
  initialFlight = request;
  const clear = () => { if (initialFlight === request) initialFlight = null; };
  void request.then(clear, clear);
  return request;
}

async function readShopCatalogSnapshot(): Promise<Product[]> {
  const snapshot = await getDocsFromServer(query(collection(db, 'products'), where('active', '==', true)));
  return snapshot.docs.filter(document => isPublished(document.data())).map(document => mapCatalogProduct(document.id, document.data()));
}

/** One complete server read, independent of search, filters and card pagination. */
export function fetchShopCatalogSnapshot(): Promise<Product[]> {
  if (snapshotFlight) return snapshotFlight;
  const request = readShopCatalogSnapshot();
  snapshotFlight = request;
  const clear = () => { if (snapshotFlight === request) snapshotFlight = null; };
  void request.then(clear, clear);
  return request;
}
