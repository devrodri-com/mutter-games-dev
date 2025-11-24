# MUTTER GAMES – Frontend (Vite + React + Firebase)

Este repositorio contiene **el frontend oficial de Mutter Games**, completamente refactorizado y endurecido (hardening) para lograr un sistema **profesional, seguro, auditable y escalable**.

Incluye:
- Tienda pública (shop)
- Carrito + checkout con Mercado Pago
- Panel administrativo seguro (admin)
- Integración con backend Admin vía API (Vercel)
- Firebase Auth, Firestore, Storage
- Test suite completa (Vitest + Firestore Rules Testing + Playwright E2E)

---

## 📦 Arquitectura General

### Frontend
- **React + Typescript + Vite**
- **Firebase Client SDK (Auth, Firestore, Storage)**
- **Backend Admin vía API segura** (no Firestore directo)
- **Estados globales**: AuthContext, CartContext
- **UI** con Tailwind + componentes modulares
- **Rutas**: React Router

### Backend Admin (proyecto separado)
- Repositorio: `mutter-games-admin-api`
- Hospedado en Vercel
- Firebase Admin SDK
- Autenticación estricta con `verifyIdToken`
- Endpoints protegidos por roles admin/superadmin
- CRUD de:
  - Productos
  - Categorías / subcategorías
  - Usuarios admin
  - Clientes
  - Órdenes (lectura)

---

## 🔐 Seguridad

### Firestore (DEV/PROD)
- Catálogo público → lectura pública, escritura solo backend
- AdminUsers → lectura restringida, escritura solo backend
- Carts → lectura/escritura solo del dueño
- Orders → escritura solo backend, lectura dueño/admin
- Clients → dueño y admin
- Bloqueo total por defecto (`allow read, write: if false`)

### Backend Admin
- Capa unificada:
  - `verifyAdmin`
  - `permissions`
  - `withAdmin`
- Protección por:
  - Token JWT Firebase
  - Custom Claims (admin / superadmin)
  - Roles estrictos por endpoint
- CORS correctamente configurado

---

## 🛠️ Scripts

### Desarrollo
```
npm run dev
```

### Tests Unitarios / Integración (Vitest)
```
npm run test
npm run test:watch
npm run test:ui
```

### Tests de Reglas de Firestore
```
firebase emulators:start --only firestore   # Terminal 1
npm run test                                 # Terminal 2
```

### Tests E2E (Playwright)
```
npm run test:e2e
npm run test:e2e:ui
npm run test:e2e:codegen
```

---

## 🧪 Suite de Tests

### Vitest (Unitarios e Integración)
- `adminApiFetch.test.ts`
- `cartUtils.test.ts`
- Helpers y funciones puras

### Firestore Rules Testing (DEV)
- `rules/orders.test.ts`
- `rules/clients.test.ts`
- `rules/products.test.ts`

### Playwright (E2E)
- `shop.spec.ts` → visitar home + abrir producto
- `cart.spec.ts` → pendiente por flujo UI
(esto NO afecta producción)

---

## 🌐 Variables de Entorno

### Desarrollo (`.env.development.local`)
Debe contener:
```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=mutter-games-dev
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...

VITE_ADMIN_API_URL=https://mutter-games-admin-api.vercel.app
```

### Producción (Vercel → proyecto frontend)
```
VITE_FIREBASE_PROJECT_ID=mutter-games
VITE_ADMIN_API_URL=https://mutter-games-admin-api-prod.vercel.app
```

---

## 📁 Estructura del Proyecto (Frontend)

```
src/
  api/ (solo helpers)
  components/
    admin/
    shop/
    ui/
  context/
  firebase/          ← SDK client (solo lectura)
  utils/
    adminApi.ts      ← comunicación con backend admin
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

## 🚀 Deploy

### Producción
1. Crear rama `prod-hardening-preview`
2. Ajustar variables de entorno en Vercel (PROD)
3. Verificar preview:
   - Login admin
   - CRUD productos
   - Carrito + checkout
4. Merge a `main`
5. Vercel deploy automático

---

## 🤝 Backend Admin (Proyecto aparte)

Este frontend se conecta exclusivamente al backend seguro:
- Repositorio: `mutter-games-admin-api`
- Ubicación: Vercel
- Código completamente aislado del front

---

## 🧾 Créditos y Autoría

Desarrollado por **Rodrigo (LoLo / Rodri)**  
Arquitectura, seguridad, escalabilidad, DX y hardening. 
Test suite, backend admin, refactor, migraciones y auditorías, consolidadas en 2025.

---

## 📌 Estado actual

- Frontend DEV estable
- Backend Admin DEV / PROD funcionando
- Rules Firestore testadas
- Suite de tests pasando ✔
- E2E básicos listos
- Preparado para producción segura

---

## 📞 Contacto

Para soporte o consultoría:  
**https://devrodri.com**  