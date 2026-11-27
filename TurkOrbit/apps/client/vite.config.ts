import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Geliştirmede /api istekleri API sunucusuna aktarılır: tarayıcı açısından aynı kaynak olur,
// böylece HttpOnly + SameSite=Strict oturum çerezi çalışır. Üretimde aynı yönlendirmeyi nginx yapar.
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': { target: process.env.VITE_API_PROXY ?? 'http://127.0.0.1:4000', changeOrigin: false },
    },
  },
  build: { target: 'es2020', sourcemap: true },
});
