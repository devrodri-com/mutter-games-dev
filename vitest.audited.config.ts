import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({
 resolve: { preserveSymlinks: true, alias: { '@': path.resolve(__dirname, 'src') } },
 test: {
  include: ['tests/catalog/shop-global.test.tsx','tests/catalog/shop-composition.test.tsx','tests/catalog/category-links.test.tsx','tests/catalog/firebase-utils-diagnostics.test.ts','tests/catalog/firebase-utils-payloads.test.ts'],
  environment: 'happy-dom', globals: true, setupFiles: ['./src/test/setupTests.ts'], passWithNoTests: false,
  env: {VITE_ADMIN_API_URL:'https://api.example.com',VITE_FIREBASE_API_KEY:'TEST_KEY',VITE_FIREBASE_PROJECT_ID:'demo-mutter-r1',VITE_USE_FIREBASE_EMULATORS:'true'},
 },
});
