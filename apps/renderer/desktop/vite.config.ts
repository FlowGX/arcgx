import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [preact()],
  root: '.',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome130',
    sourcemap: true,
    rollupOptions: {
      input: 'index.html',
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});