// Gateway local no lugar do Kong do Supabase: /auth/v1 -> GoTrue, /rest/v1 -> PostgREST.
import http from 'node:http';

const ROUTES = [
  { prefix: '/auth/v1', target: { host: '127.0.0.1', port: 54329 } },
  { prefix: '/rest/v1', target: { host: '127.0.0.1', port: 54330 } },
];

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers':
    'authorization,apikey,content-type,x-client-info,prefer,range,accept-profile,content-profile,x-supabase-api-version,accept',
  'access-control-expose-headers': 'content-range,x-supabase-api-version',
  'access-control-max-age': '86400',
};

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    return res.end();
  }
  const route = ROUTES.find((r) => req.url.startsWith(r.prefix));
  if (!route) {
    res.writeHead(404, CORS);
    return res.end('not found');
  }
  const path = req.url.slice(route.prefix.length) || '/';
  const headers = { ...req.headers, host: `${route.target.host}:${route.target.port}` };
  const upstream = http.request(
    { ...route.target, method: req.method, path, headers },
    (up) => {
      const h = { ...up.headers, ...CORS };
      res.writeHead(up.statusCode || 502, h);
      up.pipe(res);
    },
  );
  upstream.on('error', (e) => {
    res.writeHead(502, CORS);
    res.end(String(e));
  });
  req.pipe(upstream);
});

server.listen(54321, '127.0.0.1', () => console.log('gateway on http://127.0.0.1:54321'));
