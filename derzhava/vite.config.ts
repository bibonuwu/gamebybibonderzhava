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
    chunkSizeWarningLimit: 1300,
    rollupOptions: {
      output: {
        // Иконки и библиотеки интерфейса меняются редко — отдельными файлами: качаются параллельно с кодом игры,
        // а после обновления игры браузер (и офлайн-кэш) берёт их из кэша. Движок карты (pixi.js) Vite делит сам:
        // рендереры WebGL/WebGPU грузятся по запросу.
        manualChunks(id) {
          if (id.includes('/src/ui/iconData')) return 'icons';
          if (id.includes('/node_modules/') && !id.includes('/node_modules/pixi.js/') && !id.includes('/node_modules/@pixi/')) return 'vendor';
          return undefined;
        },
      },
    },
  },
});
