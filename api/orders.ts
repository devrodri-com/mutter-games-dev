// api/orders.ts

import type { VercelRequest, VercelResponse } from '@vercel/node';

import { adminAuth, adminDb } from './_lib/firebaseAdmin';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    // CORS preflight
    res.setHeader('Access-Control-Allow-Origin', process.env.VITE_PUBLIC_BASE_URL || 'http://localhost:5173');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Permitir solo llamadas desde el mismo dominio o desde el frontend de Vercel
  res.setHeader('Access-Control-Allow-Origin', process.env.VITE_PUBLIC_BASE_URL || 'http://localhost:5173');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) {
      return res.status(401).json({ error: 'Missing bearer token' });
    }

    const decoded = await adminAuth.verifyIdToken(token);
    const uid = decoded.uid;

    const raw = req.body;
    const payload = typeof raw === 'string' ? JSON.parse(raw) : (raw || {});

    const {
      uid: bodyUid,
      createdAt,
      items,
      shipping,
      total,
      client,
      paymentIntentId,
      paymentStatus,
      paymentMethod,
      date,
      estado,
    } = payload;

    if (!bodyUid || bodyUid !== uid) {
      return res.status(403).json({ error: 'uid mismatch' });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items is required' });
    }

    if (typeof total !== 'number' || total <= 0) {
      return res.status(400).json({ error: 'invalid total' });
    }

    const docData = {
      uid,
      createdAt: createdAt || new Date().toISOString(),
      items,
      shipping: shipping || {},
      total,
      client: client || {},
      paymentIntentId: paymentStatus ?? null,
      paymentStatus: paymentStatus ?? 'pendiente',
      paymentMethod: paymentMethod ?? 'mercadopago',
      date: date || new Date().toISOString(),
      estado: estado || 'En proceso',
    };

    const docRef = await adminDb.collection('orders').add(docData);

    return res.status(201).json({ id: docRef.id });
  } catch (err: any) {
    console.error('Error creating order:', err);
    return res.status(500).json({ error: 'Internal server error', details: err?.message || 'Unknown error' });
  }
}

