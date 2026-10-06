import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base relativa: o ingress do HA serve o app sob um caminho dinâmico
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:8099' } },
});
