import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base relativo: funciona no GitHub Pages (usuario.github.io/EasyCut/) e em qualquer domínio.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { target: 'es2021', sourcemap: false },
});
