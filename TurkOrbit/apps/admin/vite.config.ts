import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Yönetim Merkezi üretimde ana siteyle AYNI alan adında /yonetim/ altında sunulur: oturum çerezi (HttpOnly,
// SameSite=Strict) ve CSRF koruması aynen çalışır. Geliştirmede /api istekleri API sunucusuna aktarılır;
// bu sunucunun kaynağı (http://localhost:5175) API'nin ALLOWED_ORIGINS listesinde olmalıdır.
export default defineConfig({
  base: '/yonetim/',
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5175,
    proxy: {
      '/api': { target: process.env.VITE_API_PROXY ?? 'http://127.0.0.1:4000', changeOrigin: false },
    },
  },
  build: { target: 'es2020', sourcemap: true },
});
