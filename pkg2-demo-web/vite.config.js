import { defineConfig } from 'vite';

// base: './' — собранную папку dist можно открыть с любого пути (сетевой диск, внутренний сайт, ноутбук без интернета).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022', chunkSizeWarningLimit: 2500,
    rollupOptions: { input: { main: 'index.html', galley: 'galley.html', tablet: 'tablet.html', lab: 'lab.html' } },
  },
  test: { environment: 'node', include: ['tests/**/*.test.js'] },
});
