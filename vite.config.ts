import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base relativo: funciona no GitHub Pages (usuario.github.io/Barber-app/) e em qualquer domínio.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: { target: 'es2021', sourcemap: false },
});
