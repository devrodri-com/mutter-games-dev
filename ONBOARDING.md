

# 🧭 Onboarding — Mutter Games Frontend

Welcome!  
This document is a practical guide to understand the architecture, conventions, and workflows of the **Mutter Games** frontend project.  
It is designed so a new developer can begin contributing within hours, not days.

---

## 1. Project Overview

**Tech Stack**
- React + TypeScript + Vite
- Firebase (Auth, Firestore)
- Admin API (Node + Firebase Admin)
- TailwindCSS
- Vitest + Playwright

**Purpose of this repo**
- Public store (catalog, search, product page, cart, checkout)
- Admin panel (products, categories, subcategories, users, clients)
- Integrations: Mercado Pago + ImageKit

---

## 2. Repository Structure (high‑level)

```
src/
  components/          → Reusable UI and admin modules
  context/             → Global states: Auth, Cart, Language
  firebase/            → Firebase config + initialization
  pages/               → Store and admin pages
  utils/               → Helpers (safeStorage, formatting, API helpers)
tests/
  e2e/                 → Playwright tests
  rules/               → Firestore rules tests
  test/                → Unit tests (Vitest)
```

---

## 3. How Authentication Works

### 3.1 Anonymous auth (store visitors)
- Every visitor gets an anonymous Firebase user (`uid`) to sync the cart and drive the checkout.
- Managed centrally with `ensureAuthReady()` — no duplicate signInAnonymously().

### 3.2 Admin auth
- Admin users log in with Firebase Auth (email/password).
- Admin privileges come through **Custom Claims** added via backend.
- Admin API requires:  
  `Authorization: Bearer <idToken>`.

---

## 4. Cart System Architecture

The cart uses **three layers**:

1. **React state** (CartContext)
2. **safeStorage** (wrapper of localStorage with iOS‑safe fallback)
3. **Firestore** (`carts/{uid}`) realtime sync

**Important:**  
Never use `localStorage` directly. Always use `safeStorage`.

---

## 5. Image Upload Flow (Admin)

1. Admin UI requests a signature from backend:  
   `GET /api/imagekit-signature`  
   (requires admin token)
2. ImageKit upload via URL returned by signature.
3. Saved URL is stored in product.

Uploads from non-admin callers are rejected.

---

## 6. Firestore Rules (Mental Model)

- Catalogue: public read, admin-only write
- Carts: owner read/write
- Clients: owner read/write; admins via backend
- Orders: **only backend writes**
- AdminUsers: no client access

Never bypass these rules. All sensitive operations happen via Admin API.

---

## 7. Development Workflow

### Install
```
npm install
```

### Run locally
Frontend:
```
npm run dev
```

Firestore emulator (in another terminal):
```
firebase emulators:start --only firestore
```

### Run tests
Unit:
```
npm run test
```

Rules tests:
```
npm run test tests/rules
```

E2E:
```
npm run test:e2e
```

---

## 8. Coding Conventions

- Use **TypeScript** strictly (no `any` unless justified).
- UI state lives in React Context only when global; otherwise colocate state.
- Never fetch Firestore directly in admin pages — always use Admin API.
- Use **safeStorage** for local persistence.
- Use **adminApiFetch** for authenticated backend calls.

---

## 9. How to Add New Features

1. Create new branch:  
   `git checkout -b feature/<name>`
2. Add/modify components in `src/components` or `src/pages`.
3. Use existing patterns for CRUD via Admin API.
4. Add tests:
   - Vitest unit tests in `src/test/`
   - Playwright tests in `tests/e2e/`
5. Submit PR with:
   - Summary
   - Implementation notes
   - Screenshots (if UI)
   - Tests included

---

## 10. How to Ask for Help

If you're unsure about:
- Firestore data model  
- Auth flow  
- Admin API contracts  
- Deployment  
- Testing  
…ask the project maintainer before implementing.

---

## 11. Final Notes

This project is now fully modular, secure, and ready to scale.  
Follow the patterns in this guide and you will be productive very quickly.

Welcome aboard 🚀