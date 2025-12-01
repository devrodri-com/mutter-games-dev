# MUTTER GAMES – Frontend (Vite + React + Firebase)

This repository contains **the official frontend of Mutter Games**, completely refactored and hardened to achieve a **professional, secure, auditable, and scalable** system.

Includes:
- Public shop
- Cart + checkout with Mercado Pago
- Secure admin panel
- Integration with Admin backend via API (Vercel)
- Firebase Auth, Firestore, Storage
- Complete test suite (Vitest + Firestore Rules Testing + Playwright E2E)

---

## 📦 General Architecture

### Frontend
- **React + Typescript + Vite**
- **Firebase Client SDK (Auth, Firestore, Storage)**
- **Secure Admin backend via API** (no direct Firestore access)
- **Global states**: AuthContext, CartContext
- **UI** with Tailwind + modular components
- **Routing**: React Router

### Admin Backend (separate project)
- Repository: `mutter-games-admin-api`
- Hosted on Vercel
- Firebase Admin SDK
- Strict authentication with `verifyIdToken`
- Endpoints protected by admin/superadmin roles
- CRUD for:
  - Products
  - Categories / subcategories
  - Admin users
  - Clients
  - Orders (read-only)

---

## 🔐 Security

### Firestore (DEV/PROD)
- Public catalog → public read, backend-only write
- AdminUsers → restricted read, backend-only write
- Carts → read/write only by owner
- Orders → backend-only write, read by owner/admin
- Clients → owner and admin access
- Default full lock (`allow read, write: if false`)

### Admin Backend
- Unified layer:
  - `verifyAdmin`
  - `permissions`
  - `withAdmin`
- Protection via:
  - Firebase JWT token
  - Custom Claims (admin / superadmin)
  - Strict role-based endpoint access
- Properly configured CORS

---

## 🛠️ Scripts

### Development
```
npm run dev
```

### Unit / Integration Tests (Vitest)
```
npm run test
npm run test:watch
npm run test:ui
```

### Firestore Rules Tests
```
firebase emulators:start --only firestore   # Terminal 1
npm run test                                 # Terminal 2
```

### E2E Tests (Playwright)
```
npm run test:e2e
npm run test:e2e:ui
npm run test:e2e:codegen
```

---

## 🧪 Test Suite

### Vitest (Unit and Integration)
- `adminApiFetch.test.ts`
- `cartUtils.test.ts`
- Helpers and pure functions

### Firestore Rules Testing (DEV)
- `rules/orders.test.ts`
- `rules/clients.test.ts`
- `rules/products.test.ts`

### Playwright (E2E)
- `shop.spec.ts` → visit home + open product
- `cart.spec.ts` → pending UI flow
(this DOES NOT affect production)

---

## 🌐 Environment Variables

### Development (`.env.development.local`)
Must contain:
```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=mutter-games-dev
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...

VITE_ADMIN_API_URL=https://mutter-games-admin-api.vercel.app
```

### Production (Vercel → frontend project)
```
VITE_FIREBASE_PROJECT_ID=mutter-games
VITE_ADMIN_API_URL=https://mutter-games-admin-api-prod.vercel.app
```

---

## 📁 Project Structure (Frontend)

```
src/
  api/ (helpers only)
  components/
    admin/
    shop/
    ui/
  context/
  firebase/          ← client SDK (read-only)
  utils/
    adminApi.ts      ← communication with admin backend
    cartUtils.ts
  pages/
    Shop.tsx
    ProductPage.tsx
    CartPage.tsx
    admin/...
tests/
  e2e/
  rules/
  unit/
```

---

## 🚀 Deployment

### Production
1. Create branch `prod-hardening-preview`
2. Adjust environment variables in Vercel (PROD)
3. Verify preview:
   - Admin login
   - Product CRUD
   - Cart + checkout
4. Merge to `main`
5. Automatic Vercel deploy

---

## 🤝 Admin Backend (Separate Project)

This frontend connects exclusively to the secure backend:
- Repository: `mutter-games-admin-api`
- Location: Vercel
- Completely isolated code from frontend

---

## 🧾 Credits and Authorship

Developed by **Rodrigo (LoLo / Rodri)**  
Architecture, security, scalability, DX, and hardening.  
Test suite, admin backend, refactors, migrations, and audits, consolidated in 2025.

---

## 📌 Current Status

- Stable frontend DEV
- Admin backend DEV / PROD working
- Firestore rules tested
- Test suite passing ✔
- Basic E2E ready
- Prepared for secure production

---

## 📞 Contact

For support or consulting:  
**https://devrodri.com**  