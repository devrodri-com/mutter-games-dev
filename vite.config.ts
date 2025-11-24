import { defineConfig } from 'vite';
import { defineConfig as defineTestConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path'; // 👈 importar path

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'), // 👈 define el alias "@"
    },
  },
  server: {},
});