import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Política de segurança de conteúdo (CSP) no index.html publicado: o navegador só roda scripts do
 * próprio site e só conversa com o Supabase do projeto. Isso barra script injetado (XSS) e envio de
 * dados para outro servidor. Só no build: o servidor de desenvolvimento usa scripts próprios.
 */
function contentSecurityPolicy(supabaseUrl: string): Plugin {
  const api = new URL(supabaseUrl);
  const secure = api.protocol === 'https:';
  const ws = `${secure ? 'wss' : 'ws'}://${api.host}`;
  const policy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${api.origin} ${ws}`,
    "manifest-src 'self'",
    "worker-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(secure ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
  return {
    name: 'easycut-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<meta charset="UTF-8" />',
        `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
      );
    },
  };
}

// base relativo: funciona no GitHub Pages (usuario.github.io/Barber-app/) e em qualquer domínio.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  return {
    base: './',
    plugins: [react(), contentSecurityPolicy(env.VITE_SUPABASE_URL || 'http://localhost:54321')],
    build: { target: 'es2021', sourcemap: false },
  };
});
