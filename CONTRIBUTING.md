# Contributing to Mutter Games

Thank you for your interest in contributing to **Mutter Games**.  
This document explains how to set up the project, follow the coding standards, propose changes, and submit pull requests.

---

## 🧱 Project Structure

This repository contains the **frontend application** of Mutter Games.

Main folders:

```
src/
  components/       → UI components
  context/          → React contexts (Auth, Cart, Language)
  hooks/            → Custom hooks
  pages/            → Route-level screens
  utils/            → Helpers (safeStorage, formatting, API wrappers)
  firebase/         → Firebase initialization and utilities
tests/              → Vitest unit tests
tests/rules/        → Firestore Rules testing suite
tests/e2e/          → Playwright end‑to‑end tests
```

---

## 🛠 Requirements

Before contributing, make sure you have:

- Node.js 18+
- pnpm or npm
- Firebase CLI installed (`npm i -g firebase-tools`)
- Vercel CLI (Optional, only if you need to test builds)

---

## 🧪 Run the Project Locally

### 1. Install dependencies

```
npm install
```

### 2. Create local environment files

Create `.env.development.local`:

```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_STORAGE_BUCKET=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
VITE_FIREBASE_APP_ID=...
VITE_ADMIN_API_URL=http://localhost:3000
```

### 3. Start the frontend

```
npm run dev
```

### 4. Start Firebase Emulator (for rules tests)

```
firebase emulators:start --only firestore
```

---

## 📐 Code Style Guidelines

### TypeScript

- Use strict typing (`string | null`, `Record<string, any>`, etc.)
- Avoid `any` unless absolutely necessary.
- Prefer pure functions in helpers.

### React

- Use functional components only.
- Use hooks: `useState`, `useEffect`, `useCallback`, `useMemo` responsibly.
- Avoid expensive computations inside components.

### File Organization

- One component per file.
- Co-locate small helpers with their component.
- Put shared utilities in `src/utils/`.

---

## 🔐 Security Rules for Contributions

Contributors **must not**:

- Commit Firebase private keys.
- Commit ImageKit private keys.
- Commit real user data.
- Loosen Firestore rules without justification.
- Add new API calls without going through the Admin API.

---

## 🧪 Testing Requirements

Before submitting a PR:

### 1. Unit Tests (Vitest)

```
npm run test
```

Must pass without warnings.

### 2. Firestore Rules Tests

```
npm run test tests/rules/
```

Must pass or be explicitly skipped.

### 3. E2E Tests (Playwright)

```
npm run test:e2e
```

At least the existing tests must pass unless you are adding new features.

---

## 🔄 Submitting a Pull Request

To submit a PR:

1. Create a new branch from `main`:
   ```
   git checkout -b feature/my-change
   ```
2. Make your changes following the rules above.
3. Run **all tests**.
4. Commit using conventional commits:
   - `feat:` for new features  
   - `fix:` for bug fixes  
   - `docs:` for documentation only  
   - `refactor:` for internal changes  
5. Push your branch:
   ```
   git push origin feature/my-change
   ```
6. Open a Pull Request on GitHub with:
   - a clear title
   - a description of the change
   - screenshots if it affects the UI
   - a summary of how it was tested

---

## 🧾 Code of Conduct

Be respectful, professional, and constructive.  
This project encourages clear communication and attention to quality and security.

---

If you have any questions, feel free to open an Issue or reach out.  
Happy coding! 🎮
