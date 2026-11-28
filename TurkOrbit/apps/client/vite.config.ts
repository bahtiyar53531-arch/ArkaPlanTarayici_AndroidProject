import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Geliştirmede /api istekleri API sunucusuna aktarılır: tarayıcı açısından aynı kaynak olur,
// böylece HttpOnly + SameSite=Strict oturum çerezi çalışır. Üretimde aynı yönlendirmeyi nginx yapar.
// `--mode mobile` (npm run mobile:build): Capacitor için dist-mobile/, kaynak haritası olmadan (uygulama boyutu).
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': { target: process.env.VITE_API_PROXY ?? 'http://127.0.0.1:4000', changeOrigin: false },
      // Gerçek zamanlı oyun sunucusu (WebSocket). Üretimde nginx /game yolunu oyun sunucusuna yönlendirir.
      '/game': { target: process.env.VITE_GAME_PROXY ?? 'ws://127.0.0.1:4001', ws: true, changeOrigin: false },
    },
  },
  build: {
    target: 'es2020',
    outDir: mode === 'mobile' ? 'dist-mobile' : 'dist',
    sourcemap: mode !== 'mobile',
    // Phaser (~1,2 MB, gzip ~340 KB) ayrı ve uzun süre önbelleklenen bir parçadır; yalnızca /oyna açılınca indirilir.
    chunkSizeWarningLimit: 1300,
    rollupOptions: { output: { manualChunks: { phaser: ['phaser'] } } },
  },
}));
