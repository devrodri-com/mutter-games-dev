# Mutter Games – System Design (EN)

This document provides a detailed explanation of the internal system architecture of **Mutter Games**: the flows, responsibilities, and interactions between the Frontend (SPA), the Admin API (serverless backend), and Firebase (Auth, Firestore, Rules).

---

## 1. System Objectives

- Full e‑commerce experience for videogames, consoles, and collectibles.
- Secure admin panel for catalog, orders, and customer management.
- Backend API that centralizes *all sensitive operations*.
- Architecture ready to scale (multi‑store / white‑label).
- Minimize coupling between UI and business logic.

---

## 2. High‑Level Architecture

Main components:

1. **Frontend (React SPA + Vite)**  
   Public store + admin UI, cart management, authentication, image uploads (via backend).

2. **Admin API (Vercel Functions + Firebase Admin SDK)**  
   Sensitive logic: admin CRUD, orders, ImageKit signatures, Mercado Pago integration.

3. **Firebase (Auth + Firestore + Rules)**  
   - Auth: anonymous users + admin users (Custom Claims).  
   - Firestore: products, categories, carts, clients, orders.  
   - Rules: enforce access control for non‑admin users.

---

## 3. Authentication Flow

### 3.1 Anonymous Auth (customers)

**Goal:** always have a `uid` to associate carts and orders, even without registration.

Flow:

```
Browser → ensureAuthReady()
 ├─ If user exists → return currentUser.uid
 └─ Else → signInAnonymously()
        → wait for onAuthStateChanged(user)
Save uid in memory + safeStorage
```

Use cases:
- Identify carts.
- Associate orders.
- Later merge cart when user logs in with email/password.

### 3.2 Admin Authentication

Admins log in with Firebase Auth (email/password).  
A provisioning script assigns Custom Claims:

```json
{
  "admin": true,
  "superadmin": true
}
```

The frontend obtains the ID token and sends:

```
Authorization: Bearer <idToken>
```

to the Admin API.

---

## 4. Admin API Design

### 4.1 General Pattern

Every admin endpoint uses:

- **CORS strict allowlist**
- **verifyAdmin()** token + role verification
- **Firebase Admin SDK** to perform reads/writes

Flow:

```
Admin UI → Admin API → verifyAdmin(req)
     → Firestore Admin SDK (secure write/read)
     → return JSON
```

### 4.2 Key Endpoints

- `POST /api/admin/products`
- `PATCH /api/admin/products/:id`
- `DELETE /api/admin/products/:id`
- `GET /api/admin/clients`
- `GET /api/admin/users`
- `POST /api/admin/users` (superadmin only)
- `GET /api/imagekit-signature` (admin only)

All of them route through the same centralized verification.

---

## 5. Cart System Design

The cart uses **three layers**:

1. **React State (CartContext)**  
   Immediate source for UI.

2. **safeStorage (wrapper around localStorage)**  
   - Wrapped in try/catch  
   - Avoids iOS/Safari crashes  
   - Cleans corrupted JSON  
   - Falls back to in‑memory Map

3. **Firestore (carts/{uid})**  
   True multi‑device synchronization.

### 5.1 Cart Load Flow

```
CartContext mounts
↓
Load cache from safeStorage
↓
Subscribe to Firestore carts/{uid}
↓
Merge Firestore cart + cache
↓
Update UI
```

### 5.2 Cart Write Flow

On every change:

- Update React state  
- Persist in safeStorage  
- If `uid` exists → write to Firestore  

Conflicts resolved preferring Firestore.

---

## 6. Checkout & Orders

Flow:

```
Browser → CartContext → validate cart & shipping
↓
POST /api/admin/orders
↓
Admin API writes order using Admin SDK
↓
Admin API creates Mercado Pago preference
↓
returns init_point
↓
Browser → MercadoPago redirect
```

- Orders **never** written directly from the client.
- Firestore Rules deny client writes to `orders`.

---

## 7. Image Upload Flow (ImageKit)

Goals:

- Do NOT expose ImageKit private key.
- Allow uploads only from verified admin users.

Flow:

```
Admin UI → GET /api/imagekit-signature (with Bearer token)
↓
Admin API verifies token
↓
Generates signature + token + expire
↓
Admin UI → ImageKit upload
↓
ImageKit returns final URL
```

Admin UI stores the returned URL in Firestore.

---

## 8. Resilience & Error Handling

### Frontend

- safeStorage prevents iOS WebKit crashes
- CartContext cleans invalid storage data
- Admin API requests show meaningful user feedback
- Differentiate 4xx vs 5xx errors

### Backend

- verifyAdmin returns 401 or 403 properly
- CORS denies unknown origins with explicit 403
- ImageKit signature endpoint never logs secrets

---

## 9. Key Architectural Decisions

1. **Separation of Frontend / Admin API / Firebase**
   - Better security and maintenance.
   - Clear boundaries between UI and business logic.

2. **Firebase Auth + Custom Claims**
   - Unified identity system.
   - Granular role permissions without managing sessions manually.

3. **Firestore as source of truth**
   - Natural fit for catalogue, carts, orders.

4. **SPA (Vite)**
   - Fast DX and deployment simplicity.
   - Admin API handles all sensitive operations, keeping the SPA safe.

---

## 10. Future Evolution Paths

- Migrate UI to Next.js (SSR/ISR) reusing the same Admin API.
- Add Zod/Joi validation on all admin payloads.
- Add rate‑limiting to sensitive endpoints.
- Introduce APM/logging/tracing for better observability.

---

This system currently supports:

- Daily store operations  
- Large catalog growth  
- Secure admin workflows  
- Future extensibility without major rewrites