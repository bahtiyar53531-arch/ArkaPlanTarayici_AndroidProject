import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Testler gerçek PostgreSQL ve Redis kullanır; dosyalar aynı test veritabanını paylaştığı için sırayla çalışır.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    include: ['test/**/*.test.ts'],
  },
});
