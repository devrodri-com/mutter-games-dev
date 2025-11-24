// vitest.config.ts
import { defineConfig, configDefaults } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
      exclude: [...configDefaults.exclude, "tests/e2e/**"],
      environment: 'happy-dom',
      globals: true,
      setupFiles: ['./src/test/setupTests.ts'],
      passWithNoTests: true,
      env: {
        VITE_ADMIN_API_URL: "https://api.example.com",
        VITE_FIREBASE_API_KEY: "TEST_KEY",
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
  });