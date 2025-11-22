// api/admin/products/index.ts

import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as admin from 'firebase-admin';
import { adminDb, adminAuth } from '../../_lib/firebaseAdmin';


type VariantOption = {
  value: string;
  priceUSD: number;
  stock?: number;
};

type Variant = {
  label: { es: string; en: string };
  options: VariantOption[];
};

type CreateProductPayload = {
  title: { es: string; en?: string };
  description: string;
  slug?: string;
  category: { id: string; name: string };
  subcategory: { id: string; name: string; categoryId: string };
  tipo: string;
  defaultDescriptionType?: string;
  extraDescriptionTop?: string;
  extraDescriptionBottom?: string;
  descriptionPosition?: 'top' | 'bottom';
  active: boolean;
  images: string[];
  allowCustomization?: boolean;
  customName?: string;
  customNumber?: string;
  priceUSD?: number;
  variants: Variant[];
  sku?: string;
  stockTotal?: number;
};

function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 120);
}

function validatePayload(payload: CreateProductPayload): string | null {
  if (!payload?.title?.es?.trim()) {
    return 'title.es es requerido';
  }
  if (!payload?.category?.id) {
    return 'category.id es requerido';
  }
  if (!payload?.subcategory?.id) {
    return 'subcategory.id es requerido';
  }
  if (!Array.isArray(payload?.variants) || payload.variants.length === 0) {
    return 'Debe incluir al menos una variante';
  }
  const hasValidOptions = payload.variants.every(
    (variant) =>
      variant?.label?.es?.trim() &&
      Array.isArray(variant.options) &&
      variant.options.length > 0 &&
      variant.options.every(
        (opt) =>
          typeof opt.value === 'string' &&
          opt.value.trim().length > 0 &&
          Number.isFinite(opt.priceUSD)
      )
  );
  if (!hasValidOptions) {
    return 'Las variantes deben tener opciones con valor y precio válido';
  }
  if (!Array.isArray(payload.images) || payload.images.length === 0) {
    return 'Debe incluir al menos una imagen';
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization || '';
    const tokenString = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!tokenString) {
      return res.status(401).json({ error: 'Unauthorized: missing bearer token' });
    }

    let decodedToken: admin.auth.DecodedIdToken;
    try {
      decodedToken = await adminAuth.verifyIdToken(tokenString);
    } catch {
      return res.status(401).json({ error: 'Unauthorized: invalid token' });
    }
    const claims = decodedToken as { [key: string]: any };
    const isAdmin = claims.admin === true || claims.superadmin === true;
    if (!isAdmin) {
      return res.status(403).json({ error: 'Forbidden: admin role required' });
    }

    const payload =
      typeof req.body === 'string' ? (JSON.parse(req.body) as CreateProductPayload) : (req.body as CreateProductPayload);

    const validationError = validatePayload(payload);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const normalizedVariants: Variant[] = payload.variants.map((variant) => ({
      label: {
        es: variant.label?.es?.trim() || '',
        en: variant.label?.en?.trim() || '',
      },
      options: variant.options.map((option) => ({
        value: option.value.trim(),
        priceUSD: Number(option.priceUSD),
        stock: Number.isFinite(option.stock) ? Number(option.stock) : 0,
      })),
    }));

    const optionPrices = normalizedVariants
      .flatMap((variant) => variant.options.map((option) => Number(option.priceUSD)))
      .filter((price) => Number.isFinite(price) && price >= 0);

    if (!optionPrices.length) {
      return res.status(400).json({ error: 'No se encontraron precios válidos en las variantes' });
    }

    const priceUSD = Math.min(...optionPrices);

    const stockTotal = normalizedVariants
      .flatMap((variant) => variant.options.map((option) => Number(option.stock) || 0))
      .reduce((sum, stock) => sum + (Number.isFinite(stock) ? stock : 0), 0);

    const slugSource =
      payload.slug && payload.slug.trim().length > 0
        ? payload.slug
        : `${payload.title.es}-${payload.subcategory?.name || ''}`;
    const slug = slugify(slugSource);

    const docData = {
      title: {
        es: payload.title.es.trim(),
        en: payload.title.en?.trim() || '',
      },
      description: payload.description || '',
      slug,
      category: {
        id: payload.category.id,
        name: payload.category.name || '',
      },
      subcategory: {
        id: payload.subcategory.id,
        name: payload.subcategory.name || '',
        categoryId: payload.subcategory.categoryId || payload.category.id,
      },
      tipo: payload.tipo,
      defaultDescriptionType: payload.defaultDescriptionType || 'none',
      extraDescriptionTop: payload.extraDescriptionTop || '',
      extraDescriptionBottom: payload.extraDescriptionBottom || '',
      descriptionPosition: payload.descriptionPosition || 'bottom',
      active: payload.active,
      images: payload.images,
      allowCustomization: Boolean(payload.allowCustomization),
      customName: payload.customName || '',
      customNumber: payload.customNumber || '',
      priceUSD,
      variants: normalizedVariants,
      sku: payload.sku || '',
      stockTotal,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    const docRef = await adminDb.collection('products').add(docData);

    return res.status(201).json({ id: docRef.id, slug });
  } catch (error) {
    console.error('Error creando producto admin:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return res.status(500).json({ error: message });
  }
}

