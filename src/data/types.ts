// src/data/types.ts

export type Product = {
  version?: string;
  id: string;
  title: {
    en: string;
    es: string;
  };
  subtitle?: string;
  name: string;
  slug?: string;
  description: string;
  extraDescription?: string;
  priceUSD: number;
  category: { id: string; name: string };
  subcategory: Subcategory;
  images?: string[];
  stock?: { [size: string]: number };
  active: boolean;
  defaultDescriptionType?: string;
  extraDescriptionTop?: string;
  extraDescriptionBottom?: string;
  descriptionPosition?: "top" | "bottom";
  allowCustomization?: boolean;
  customName?: string;
  customNumber?: string;
  variants?: {
    label: {
      es: string;
      en: string;
    };
    options: {
      value: string;
      priceUSD: number;
      stock?: number;
      variantLabel?: string;
      variantId?: string;
    }[];
  }[];
  stockTotal?: number;
  sku?: string;
  tipo?: string; // Ej: "Juego" | "Consola" | "Accesorio" | "Merch"
  type?: string; // Ej: "Juego", "Consola", etc.
};

export type CartItem = {
  availability?: "available" | "unavailable" | "unverified";
  priceChanged?: boolean;
  id: string;
  slug: string;
  name: string;
  title: { en: string; es: string };
  subtitle?: string;
  description?: {
    en: string;
    es: string;
  };
  image: string;
  price: number; // ✅ Nuevo campo agregado
  priceUSD: number;
  quantity: number;
  customName?: string;
  customNumber?: string;
  options?: string;
  variantId?: string;
  variant?: {
    id?: string;
    label?: {
      es: string;
      en: string;
    };
  };
  variantTitle?: {
    es: string;
    en: string;
  };
  variantLabel?: string; // ⚠️ Necesario para identificar la variante por su label (ej: "COLOR")
  stock?: number;        // ⚠️ Ya lo trae en Firebase y es útil para debugging o validación
};

export type User = {
  id: string;
  uid?: string;
  name: string;
  email: string;
  password?: string;
  role?: string;
};
export type AuthUser = {
  id: string;
  name: string;
  email: string;
  password?: string;
};
export interface Client {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface ClientWithId extends Client {
  id: string;
}

export type Subcategory = {
  id: string;
  name: string;
  categoryId: string;
};

export type Category = {
  id: string;
  name: string;
  subcategories: Subcategory[];
};

export type ShippingInfo = {
  name: string;
  lastName?: string;
  phone: string;
  address: string;
  address2?: string; // <- campo opcional para unidad/apto
  city: string;
  department: string;
  state: string;
  country?: string; // <- campo opcional para país
  postalCode: string;
  wantsToRegister: boolean;
  email: string;
  password: string;
  confirmPassword: string;
  shippingCost?: number;
};
export interface Order {
  id: string;
  cartItems: CartItem[];
  client: {
    name: string;
    email: string;
    phone?: string;
    address?: string;
    address2?: string;
    city?: string;
    state?: string;
    zip?: string;
    country?: string;
  };
  shippingInfo?: ShippingInfo;
  clientEmail: string;
  totalAmount: number;
  paymentIntentId: string;
  paymentIntentStatus?: string;
  paymentStatus: 'succeeded' | 'pending' | 'failed';
  paymentMethod: string;
  date: string;
  createdAt?: string;
  estado: 'En proceso' | 'Confirmado' | 'Cancelado' | 'Entregado';
  status?: string;
  breakdown?: {
    subtotal: number;
    taxes: number;
    shipping: number;
    total: number;
  };
}
export type CartFormData = {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  country: string;
};