// Service worker simples: deixa o app instalável e abre rápido.
// A agenda sempre vem da internet (nunca mostra horário velho guardado).
const CACHE = 'easycut-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.add('./'))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Supabase e WhatsApp passam direto

  // Página: tenta a internet primeiro; sem sinal, abre a última versão salva.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./', copy));
          return res;
        })
        .catch(() => caches.match('./', { ignoreVary: true })),
    );
    return;
  }

  // Arquivos com hash no nome (JS, CSS, fontes) nunca mudam: guarda e reaproveita.
  if (url.pathname.includes('/assets/')) {
    event.respondWith(
      // ignoreVary: o servidor pode mandar "Vary: Origin" e o pedido do navegador nem sempre traz o mesmo cabeçalho.
      caches.match(req, { ignoreVary: true }).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
