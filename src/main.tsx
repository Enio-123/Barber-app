import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/inter';
import '@fontsource/kaushan-script';
import './styles.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
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
