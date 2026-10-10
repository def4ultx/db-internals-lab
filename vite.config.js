import { defineConfig } from 'vite';
import { resolve } from 'path';
export default defineConfig({
  server: { port: 5173, host: true },
  build: {
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        explore: resolve(__dirname, 'explore.html'),
        learn: resolve(__dirname, 'learn.html'),
        video: resolve(__dirname, 'video.html'),
        compare: resolve(__dirname, 'compare.html'),
      },
    },
  },
});
