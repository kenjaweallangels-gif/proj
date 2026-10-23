import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', port: 5173, strictPort: false },
  resolve: {
    alias: [
      // `three` → src/core/three-lod.js (re-exports three with a geometry-detail factor), see that file
      { find: /^three$/, replacement: r('./src/core/three-lod.js') },
      { find: /^three-original$/, replacement: r('./node_modules/three/build/three.module.js') },
    ],
  },
  // keep three (and its addons) out of dependency pre-bundling so the alias above applies to the addons too
  optimizeDeps: { exclude: ['three'] },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
  },
});
