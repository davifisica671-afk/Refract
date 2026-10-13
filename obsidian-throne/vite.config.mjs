import { defineConfig } from 'vite';

// Configuração deliberadamente permissiva: o preview do Arena serve o app
// através de um proxy HTTPS em outro domínio, então liberamos host/origin.
export default defineConfig({
  base: './',
  css: { postcss: { plugins: [] } },   // ignora o postcss.config.js do repositório-pai
  server: {
    host: '0.0.0.0',
    port: 5199,
    strictPort: true,
    cors: true,
    allowedHosts: true,
    hmr: { clientPort: 443, protocol: 'wss' },
  },
  preview: { host: '0.0.0.0', port: 5199, strictPort: true, cors: true, allowedHosts: true },
  build: { target: 'es2020', chunkSizeWarningLimit: 3000 },
});
