# Mutter Games – Security Overview

This document describes the main security mechanisms implemented in the **Mutter Games** platform.  
It focuses on: authentication, authorization, Firestore Rules, CORS, sensitive operations in the Admin API, and external integrations (Mercado Pago, ImageKit).

---

## 1. Security Goals

- Protect all **admin** operations (catalog, orders, clients, admin users).
- Prevent any **direct write** from the public frontend to sensitive collections.
- Ensure that **anonymous users** can only do what is strictly necessary (browse, cart, checkout).
- Enforce **principle of least privilege** at all levels:
  - frontend
  - Admin API
  - Firebase Auth
  - Firestore Rules
- Avoid exposing secrets (ImageKit private key, Firebase Admin key, etc.).

---

## 2. Authentication & Identity

### 2.1 Firebase Auth

The platform uses **Firebase Authentication** for both:

- Anonymous visitors (for carts and orders association)
- Admin users (for accessing the admin panel and Admin API)

Auth flows:

- **Anonymous users:**
  - Signed in via `signInAnonymously()` and centralized helpers.
  - Used to link carts and orders to a `uid`.

- **Admin users:**
  - Email/password accounts created in Firebase Auth.
  - Promoted to admin by a provisioning script using Firebase Admin SDK.

### 2.2 Custom Claims (admin / superadmin)

Admin privileges are **not** derived from Firestore documents alone.  
Instead, they rely on Firebase Auth **Custom Claims**:

```json
{
  "admin": true,
  "superadmin": true
}
```

- `admin: true` → has access to admin panel and Admin API for catalog, clients, etc.
- `superadmin: true` → can manage admin users (create/delete).

These claims are required to call any admin endpoint.

---

## 3. Admin API Security

### 3.1 Token Verification

All Admin API routes enforce the following pattern:

1. Extract `Authorization: Bearer <idToken>` from headers.
2. Use Firebase Admin SDK to verify the token:
   - `verifyIdToken(token, /* checkRevoked */ true)`
3. Check custom claims:
   - Ensure `admin === true` or `superadmin === true`.
4. Deny with:
   - `401 Unauthorized` if token is missing/invalid/revoked.
   - `403 Forbidden` if claims do not grant access.

This logic is centralized in:

- `api/_lib/verifyAdmin.ts`
- `api/_lib/withAdmin.ts` (for handlers wrapped with a common pattern)

### 3.2 CORS Hardening

Admin API is hosted as Vercel Functions.  
CORS is enforced via a single module:

- `api/_lib/cors.ts`

Key points:

- Uses an **allowlist** based on `CORS_ALLOW_ORIGIN` env variable.
- Only specific origins are allowed, for example:
  - `https://muttergames.com`
  - `https://www.muttergames.com`
- Any other origin:
  - gets `Access-Control-Allow-Origin: null`
  - or a `403` response for non-OPTIONS requests.
- `Access-Control-Allow-Headers` includes `Authorization` and `Content-Type`.

This prevents third-party sites from calling the Admin API with the user’s token.

---

## 4. Firestore Rules

Firestore Rules are the **second line of defense** and enforce access constraints even if someone bypasses the frontend.

### 4.1 Public Data (Read-Only)

- `products`
- `categories`
- `subcategories`

Rules:

- `allow read: if true;`
- `allow write: if false;` (for regular clients)
- Admin writes must go through Admin API (using Admin SDK, bypassing client rules).

### 4.2 Carts

Collection: `carts/{uid}`

Rules:

- Only the authenticated user with matching `request.auth.uid` can:
  - read and write their cart.
- No cross-user access.

### 4.3 Clients

Collection: `clients/{uid}`

Rules:

- `create`, `read`, `update`, `delete` limited to:
  - the authenticated user with same `uid` as doc ID.
- Admin APIs use Admin SDK for privileged operations if necessary.

### 4.4 Orders

Collection: `orders/{orderId}`

Rules:

- Orders are **created by Admin API**, not by frontend.
- Firestore Rules can deny client writes to `orders` entirely (recommended).
- Read access limited to:
  - `request.auth.uid == resource.data.uid` (owner)
  - and/or admin via backend logic (Admin SDK).

### 4.5 Admin Users

Collection: `adminUsers`

Rules:

- Client **cannot** write directly.
- Admin user provisioning is done via:
  - Admin API
  - or tooling scripts using Firebase Admin.

---

## 5. Sensitive Operations

### 5.1 Admin CRUD (products, categories, subcategories, clients)

All admin CRUD operations are implemented in the Admin API:

- No direct Firestore writes from the frontend.
- The frontend does **not** use Firestore Client SDK for admin operations.
- Every admin action goes through:
  - `verifyAdmin` + CORS + Admin SDK.

This prevents:

- Privilege escalation via client.
- Direct writes to collections by normal users.
- Unvalidated data injection.

### 5.2 Orders Creation (Checkout Flow)

- When a checkout is performed:
  - The **Admin API** writes the order document in Firestore.
  - Firestore Rules can deny client-side `create` on `orders`.
  - Admin API then calls Mercado Pago to create a payment preference.

Impact:

- Clients cannot forge or tamper orders directly.
- Orders contain only server-validated data.

---

## 6. ImageKit Integration Security

### 6.1 Signature Endpoint

Endpoint: `GET /api/imagekit-signature`

Security:

- Protected by `verifyAdmin(req)`:
  - requires valid `Authorization: Bearer <idToken>`.
  - only admin/superadmin can call this endpoint.
- Returns:
  - `signature`
  - `token`
  - `expire`
  - `publicKey` (safe to share on frontend)

CORS:

- Uses the same strict allowlist as other admin endpoints.

### 6.2 Upload Flow

Flow:

1. Admin UI asks for a signature (with token).
2. Admin API verifies the admin and returns signature data.
3. Admin UI uploads directly to ImageKit using the signature.
4. ImageKit returns the final URL.
5. Admin UI saves the URL in Firestore as part of the product document.

Secrets:

- Private keys are stored in environment variables on Vercel.
- Private key is **never** sent to the client.
- Signature and token expire quickly (short-lived).

---

## 7. Mercado Pago Integration

- The Admin API is the only component that:
  - creates Mercado Pago payment preferences.
- Client calls Admin API, which:
  - validates totals and cart data,
  - writes an order, and
  - calls Mercado Pago with server-side credentials.

This protects:

- Access tokens and credentials (kept on server).
- Integrity of the order total and currency.

---

## 8. Local Storage Safety (safeStorage)

Because iOS/Safari can behave differently around `localStorage`, a safe wrapper is used:

- `src/utils/safeStorage.ts`

Features:

- Wraps `localStorage` access in try/catch.
- Checks for `typeof window !== 'undefined'`.
- Uses an in-memory Map as fallback if storage is unavailable or fails.
- Provides `safeParse()` to handle corrupted JSON and remove invalid entries.

Used for:

- Cart cache
- Shipping data
- User email (optional)
- Language preference

This prevents the app from crashing due to storage issues or malformed data.

---

## 9. Logging & Observability

- No secrets are logged:
  - ImageKit private key is never printed.
  - Firebase Admin configuration is not logged.
- Debug logs (e.g. auth, cart) are guarded with:
  - `if (import.meta.env.DEV)` on the frontend.
- In production:
  - Errors are surfaced to the UI with safe messages.
  - Sensitive information is not leaked.

---

## 10. Threat Model (Simplified)

Mitigated threats:

- **CSRF / Token theft via browser**:
  - CORS allowlist with Authorization header control.
  - Admin API requires valid Bearer tokens + claims.
- **Privilege escalation**:
  - Custom Claims enforced for admin/superadmin.
  - Firestore Rules disallow admin collections writes from client.
- **Data tampering**:
  - Orders + admin operations only via Admin SDK.
- **Secret exposure**:
  - No private keys in frontend.
  - Env vars in Vercel for ImageKit / Firebase Admin.
- **Storage corruption / crashes on iOS**:
  - safeStorage wrapper with fallback.

---

## 11. Future Security Enhancements

Planned / possible improvements:

- Add payload schema validation (e.g. Zod) in Admin API.
- Implement rate-limiting (per IP & per uid) on sensitive endpoints.
- Add structured logging and monitoring for:
  - failed admin login attempts,
  - signature usage,
  - unusual order patterns.

---

Overall, Mutter Games is designed with a **zero-trust mindset**:  
the public frontend has minimal permissions, and all sensitive operations are concentrated in a secured Admin API + Firestore Rules + Firebase Auth (with roles). This combination provides a strong baseline for a production e-commerce system.
