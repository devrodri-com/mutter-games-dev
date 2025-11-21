// api/create-mp-preference.ts

import type { VercelRequest, VercelResponse } from '@vercel/node';

interface CartItem {
  id: string;
  name?: string;
  title?: string | { es?: string; en?: string };
  price: number;
  priceUSD?: number;
  quantity: number;
}

interface ShippingData {
  name?: string;
  email?: string;
  shippingCost?: number;
  [key: string]: any;
}

interface RequestBody {
  items: CartItem[];
  shippingData: ShippingData;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { items, shippingData }: RequestBody = req.body;

    // Validación básica
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items array is required and must not be empty' });
    }

    if (!shippingData) {
      return res.status(400).json({ error: 'shippingData is required' });
    }

    // Detectar si estamos en localhost (usando el header host)
    const host = req.headers.host || '';
    const isLocalhost = /^(localhost|127\.?0\.?0\.?1|0\.0\.0\.0)/.test(host) || 
                       process.env.VERCEL_ENV === undefined;

    // Seleccionar token según entorno
    const accessToken = isLocalhost 
      ? process.env.MP_ACCESS_TOKEN_DEV 
      : process.env.MP_ACCESS_TOKEN;

    if (!accessToken || typeof accessToken !== 'string' || accessToken.trim() === '') {
      console.error('❌ Falta MP_ACCESS_TOKEN en las variables de entorno.');
      return res.status(500).json({ 
        error: 'MP_ACCESS_TOKEN not configured',
        details: isLocalhost ? 'MP_ACCESS_TOKEN_DEV required for localhost' : 'MP_ACCESS_TOKEN required for production'
      });
    }

    // Normalizar items (filtrar inválidos)
    const normalizedItems = items
      .map((item) => {
        const quantity = Number.isFinite(Number(item.quantity)) && Number(item.quantity) > 0 
          ? Math.floor(Number(item.quantity)) 
          : 1;
        
        // Precio: priorizar priceUSD, luego price
        const unit_price = Number(item.priceUSD ?? item.price ?? 0);
        
        // Título: manejar string u objeto multilenguaje
        let title = 'Producto';
        if (typeof item.title === 'string') {
          title = item.title;
        } else if (typeof item.title === 'object' && item.title) {
          title = item.title.es || item.title.en || 'Producto';
        } else if (item.name) {
          title = item.name;
        }

        return {
          title,
          quantity,
          unit_price,
          currency_id: 'UYU' as const,
        };
      })
      .filter((it) => Number.isFinite(it.unit_price) && it.unit_price > 0 && it.quantity > 0);

    // Agregar envío si corresponde
    const shippingCost = Number(shippingData?.shippingCost ?? 0);
    if (Number.isFinite(shippingCost) && shippingCost > 0) {
      normalizedItems.push({
        title: 'Costo de envío',
        quantity: 1,
        unit_price: shippingCost,
        currency_id: 'UYU',
      });
    }

    // Si no hay items válidos, retornar error
    if (!normalizedItems.length) {
      return res.status(400).json({ 
        error: 'No valid items found',
        details: 'All items must have valid price and quantity > 0'
      });
    }

    // Base URL para redirects
    const baseUrl = process.env.VITE_PUBLIC_BASE_URL || 
                   (isLocalhost ? `http://${host}` : 'https://muttergames.com');

    const payload = {
      items: normalizedItems,
      payer: {
        name: shippingData?.name || 'No especificado',
        email: shippingData?.email || 'noemail@muttergames.com',
      },
      back_urls: {
        success: `${baseUrl}/success`,
        failure: `${baseUrl}/failure`,
        pending: `${baseUrl}/pending`,
      },
      auto_return: 'approved',
    };

    console.log('🧾 MP payload:', JSON.stringify(payload, null, 2));

    // Llamar a la API de Mercado Pago
    const mpResponse = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const mpData = await mpResponse.json().catch(() => ({} as any));

    if (!mpResponse.ok) {
      console.error('❌ MP error detallado:', {
        status: mpResponse.status,
        statusText: mpResponse.statusText,
        body: mpData,
      });
      return res.status(mpResponse.status).json({
        error: 'Failed to create Mercado Pago preference',
        details: mpData.message || mpData.error || 'Unknown error from Mercado Pago',
        mpStatus: mpResponse.status,
      });
    }

    const initPoint: string | undefined = mpData?.init_point || mpData?.sandbox_init_point;
    
    if (!initPoint) {
      console.error('❌ No se recibió init_point en la respuesta de MP', mpData);
      return res.status(500).json({
        error: 'Invalid response from Mercado Pago',
        details: 'init_point not found in response',
      });
    }

    // Devolver solo el init_point
    return res.status(200).json({ init_point: initPoint });
  } catch (error) {
    console.error('❌ Error al crear preferencia:', error);
    return res.status(500).json({
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

