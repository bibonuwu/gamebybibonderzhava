import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  base: './',
  server: {
    // доступ с телефона в той же Wi-Fi сети: http://<IP компьютера>:5173
    host: true,
    port: 5173,
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
});
