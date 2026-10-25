import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base: the production build works from any sub-path or even file hosting,
  // and no asset URL depends on an absolute local path.
  base: './',
  build: {
    target: 'es2022',
    sourcemap: true,
    // Babylon.js is large; one dedicated chunk keeps the app code cache-friendly.
    chunkSizeWarningLimit: 8000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/@babylonjs')) return 'babylon';
        },
      },
    },
  },
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
});
