

# Mutter Games – Architecture Overview

This document describes the architecture, responsibilities, data flow, and security model of the Mutter Games platform.  
The goal is to provide a clear, senior‑level overview of how the system works end‑to‑end.

---

## 1. High‑Level Architecture

The platform is composed of **three independent layers**:

```
Frontend (React + Vite + TypeScript)
      |
      |  REST API calls (JWT Bearer Token)
      v
Admin API (Node.js + Firebase Admin SDK)
      |
      |  privileged operations (secure, server-side)
      v
Firebase (Auth + Firestore + Storage)
```

Each part has its own responsibilities and interacts through well‑defined contracts.

---

## 2. Components

### 2.1 Frontend (mutter-games-dev)
- Public shop (catalog, filters, product pages)
- Checkout UI (preference creation, shipping)
- Cart system (local cache + Firestore sync)
- Admin panel (products, categories, clients, orders)
- Anonymous auth bootstrap
- Image uploads via ImageKit (admin only)

Technologies:
- React, Vite, TypeScript
- Firebase Auth SDK, Firestore SDK
- TailwindCSS
- Playwright (E2E) + Vitest (unit/integration)

---

### 2.2 Admin API (mutter-games-admin-api)
- Secure backend for privileged operations
- Runs on Vercel Functions (Node.js)
- Uses Firebase Admin SDK
- Ensures roles, permissions and data validation
- Creates Mercado Pago checkout preferences
- Generates secure ImageKit upload signatures
- Performs CRUD operations on:
  - Products
  - Categories / Subcategories
  - Clients
  - Orders (server‑written only)
  - Admin users

Security:
- Bearer token required for all admin operations
- Custom Claims (admin / superadmin)
- Centralized JWT verification with revocation checks
- Strict origin allowlist with CORS

---

### 2.3 Firebase Layer
The shared backend datastore.

#### Auth
- Anonymous accounts for visitors
- Password accounts for store admins
- Custom Claims to grant admin roles
- Token revocation support

#### Firestore (production rules enforced)
- Public Read‑Only: `products`, `categories`, `subcategories`
- Write‑Only From Backend:
  - `orders` creation
  - admin collections
- Owner‑scoped Read/Write:
  - carts/{uid}
  - clients/{uid}

#### Storage
- Product images stored in ImageKit, not Firebase Storage

---

## 3. Data Flow

### 3.1 Anonymous Authentication Flow
```
frontend → ensureAuthReady()
         → checks if user exists
         → if not, performs signInAnonymously()
         → resolves with UID
         → initializes cart sync
```

Anonymous auth is centralized to avoid duplicate listeners or race conditions.

---

### 3.2 Cart Sync Logic

The cart is maintained through a dual‑source approach:

1. **Local Cache** (safeStorage wrapper)
   - Fast reads on app boot
   - Fully isolated fallbacks for iOS Safari issues

2. **Firestore Sync**
```
onAuthStateChanged → uid resolved → loadCartFromFirebase(uid)
                                      | merge with local cache
                                      | subscribe to updates
```

Rules:
- Firestore → Source of truth
- safeStorage → Cache & offline support

---

### 3.3 Admin Operations

Admin panel uses the Admin API exclusively.  
Flow example (create product):

```
Admin UI
   → adminApiFetch("/api/admin/products", POST)
         ↳ Authorization: Bearer <idToken>
   → Admin API
         ↳ verifyAdmin()
         ↳ validation + normalization
         ↳ Firestore Admin SDK write
```

No admin action touches Firestore directly from the frontend.

---

## 4. Image Upload Pipeline

Secure, role‑validated creation of signatures:

```
Admin UI
   → uploadImageToImageKit(file)
       ↳ GET /api/imagekit-signature (with Bearer token)
Admin API
   ↳ verifyAdmin()
   ↳ generate signature + token + expire
Admin UI
   ↳ upload to ImageKit
```

Only admins can upload images.

---

## 5. Security Model

### 5.1 Authentication & Authorization
- Firebase Auth for identities (anonymous & password)
- Custom Claims: `admin`, `superadmin`
- Admin API validates:
  - Bearer token
  - Revoked tokens
  - Claims
- No sensitive operation is allowed from the frontend

### 5.2 Firestore Rules (zero‑trust)

Public:
- products: read‑only

Authenticated:
- clients/{uid}: only owner
- carts/{uid}: only owner
- orders/{orderId}: read only if owner
- All admin collections: no direct client access

### 5.3 CORS Hardening
- Strict allowlist
- No wildcard
- All admin endpoints share same centralized cors.ts

---

## 6. Testing Strategy

### 6.1 Unit & Integration Tests (Vitest)
- cartUtils
- adminApi fetch wrapper
- storage utilities

### 6.2 Firestore Rules Testing
- orders rules
- clients rules
- products rules
- negative cases (untrusted access)

### 6.3 E2E Tests (Playwright)
- Shop → product → cart → checkout
- Admin login → create/edit product

---

## 7. Development Workflow

- Local dev:
  - `npm run dev` for Vite frontend
  - `firebase emulators:start --only firestore`
- Feature branches for isolated changes
- Vercel deployment for prod environment (API and frontend independently)
- CI: running Vitest + rule tests (optional future improvement)

---

## 8. Planned Improvements (Roadmap)
- Migrate Catalog to server‑side rendering or on‑demand API fetching
- Introduce pagination + search indexing
- Add Zod schema validation in Admin API
- Add rate limiting to signature & admin endpoints
- Introduce CI pipeline before deploy

---

## 9. Conclusion

Mutter Games is now built on a clean, modular, secure architecture with a clear separation of concerns:

- **Frontend → UI + local cache**
- **Admin API → all sensitive logic**
- **Firebase → auth + data + rules**

This structure ensures maintainability, scalability, and consistent performance while supporting future growth (multi‑store, white‑label, marketplace, etc.).