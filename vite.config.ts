import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';

const projectRoot = import.meta.dirname;

export default defineConfig(() => ({
  plugins: [
    react(),
    tailwindcss(),
    // Los recursos generados que vivan en src/assets (fuera del grafo de imports)
    // también deben estar disponibles en producción. Los de public/ los copia Vite.
    {
      name: 'copy-unbundled-src-assets',
      apply: 'build',
      closeBundle(error?: Error): void {
        if (error) return;
        const distDir = path.resolve(projectRoot, 'dist');
        const srcAssets = path.resolve(projectRoot, 'src/assets');
        const distAssets = path.resolve(distDir, 'src/assets');
        if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
          fs.cpSync(srcAssets, distAssets, { recursive: true, force: true });
        }
      },
    },
    // Vite 8 sigue inyectando new WebSocket(...:24678) en @vite/client incluso con hmr: false.
    // En el entorno preview tras proxy HTTPS esto provoca un rechazo no capturado en @vite/client:234:39.
    {
      name: 'disable-vite-client-websocket',
      apply: 'serve',
      enforce: 'post',
      transform(code, id) {
        const normalizedId = id.replace(/\\/g, '/');
        if (!normalizedId.includes('vite/dist/client/client.mjs')) return;
        const updated = code
          .replace(
            'transport.connect(createHMRHandler(handleMessage));',
            '/* WebSocket HMR desactivado en preview */',
          )
          .replace(
            /createConnection:\s*\(\)\s*=>\s*new WebSocket\([^)]*\)/g,
            'createConnection: () => ({ readyState: 1, addEventListener() {}, removeEventListener() {}, send() {}, close() {} })',
          );
        if (updated !== code) {
          return { code: updated, map: null };
        }
      },
    },
  ],
  resolve: {
    alias: { '@': projectRoot },
  },
  server: {
    // HMR y WebSocket desactivados en el entorno preview para evitar errores tras proxy.
    hmr: false,
    ws: false,
    // La API guarda el store con un archivo .tmp transitorio; vigilarlo produce
    // errores EBUSY de chokidar cada vez que se escribe una apuesta o un pago.
    watch: {
      ignored: ['**/*.tmp', '**/node_modules/**', '**/.git/**'],
    },
  },
}));
