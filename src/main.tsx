import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource/kaushan-script';
import './styles.css';
import { App } from './App';

// Proteção contra clickjacking: o app não abre dentro de outro site (um site falso poderia esconder
// botões do app por baixo do dele). O GitHub Pages não permite o cabeçalho que faria isso pelo servidor.
function insideAnotherSite() {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
}

const root = document.getElementById('root')!;

if (insideAnotherSite()) {
  try {
    window.top!.location.href = window.location.href;
  } catch {
    /* o outro site bloqueou: só mostra o link */
  }
  const link = document.createElement('a');
  link.href = window.location.href;
  link.target = '_top';
  link.rel = 'noopener';
  link.textContent = 'Abrir o app de agendamento';
  link.style.cssText = 'display:block;margin:40px auto;text-align:center;color:#f2f4f7;font:600 16px system-ui';
  root.replaceChildren(link);
} else {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  // Permite instalar o app na tela inicial do celular.
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./sw.js')
        .then(() => {
          // Guarda os arquivos desta primeira visita para o app abrir mesmo com sinal fraco.
          const assets = performance
            .getEntriesByType('resource')
            .map((e) => e.name)
            .filter((u) => u.startsWith(location.origin) && u.includes('/assets/'));
          return caches.open('easycut-v1').then((c) => c.addAll(['./', ...assets]));
        })
        .catch(() => undefined);
    });
  }
}
