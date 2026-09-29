// Test-only host: real SPA + real checkout handler, isolated Auth/Firestore and a synthetic MP HTTP boundary.
import { createServer } from 'vite';
import { initializeApp } from 'firebase-admin/app';
if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8188' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9198' || process.env.VITE_FIREBASE_PROJECT_ID !== 'demo-mutter-r1') {
  throw new Error('Exact local demo emulators required');
}
for (const key of ['FIREBASE_PRIVATE_KEY', 'FIREBASE_CLIENT_EMAIL', 'GOOGLE_APPLICATION_CREDENTIALS', 'MP_ACCESS_TOKEN', 'IMAGEKIT_PRIVATE_KEY', 'WEB_ADMISSION_HMAC_SECRET', 'CRON_SECRET']) {
  if (process.env[key]) throw new Error(`Credential environment forbidden: ${key}`);
}
initializeApp({ projectId: 'demo-mutter-r1' }, 'catalog-checkout');
process.env.MP_ACCESS_TOKEN = 'synthetic-browser-only';
process.env.MP_COLLECTOR_ID = '200';
process.env.VERCEL = '1';
process.env.WEB_ADMISSION_HMAC_SECRET = 'synthetic-browser-admission-key-only-12345';
const localFetch = globalThis.fetch;
let preferences = 0;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return localFetch(input, init);
  if (url.origin === 'https://api.mercadopago.com' && url.pathname === '/checkout/preferences' && init?.method === 'POST') {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    if (!body || typeof body.external_reference !== 'string' || body.expires !== true || typeof body.expiration_date_to !== 'string') throw new Error('Invalid real adapter preference payload');
    preferences++;
    return new Response(JSON.stringify({ id: `synthetic-browser-${preferences}`, collector_id: 200, external_reference: body.external_reference,
      expires: true, expiration_date_to: body.expiration_date_to,
      init_point: `https://www.mercadopago.com.uy/checkout/synthetic-browser-${preferences}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  throw new Error(`External server fetch forbidden: ${url.origin}`);
};
let handlerPromise;
const server = await createServer({
  envDir: false,
  server: { host: '127.0.0.1', port: 5277, strictPort: true },
  plugins: [{
    name: 'isolated-real-checkout-handler',
    configureServer(vite) {
      vite.middlewares.use('/api/create-mp-preference', async (req, res) => {
        try {
          const chunks = []; let size = 0;
          for await (const chunk of req) {
            size += chunk.length;
            if (size > 1024 * 1024) throw new Error('Oversized test request');
            chunks.push(chunk);
          }
          handlerPromise ??= vite.ssrLoadModule('/api/create-mp-preference.ts').then(module => module.default);
          const handler = await handlerPromise;
          const response = {
            setHeader(name, value) { res.setHeader(name, value); },
            status(code) { res.statusCode = code; return response; },
            json(body) { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); },
          };
          // Emulate the trusted platform overwriting its header, never a browser-selected IP.
          await handler({ method: req.method, headers: { ...req.headers, 'x-vercel-forwarded-for': '192.0.2.34' }, rawHeaders: ['x-vercel-forwarded-for', '192.0.2.34'], body: Buffer.concat(chunks).toString('utf8') }, response);
        } catch (error) {
          console.error('Isolated checkout handler failed:', error);
          res.statusCode = 500; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: 'Isolated handler unavailable' }));
        }
      });
    },
  }],
});
await server.listen();
process.on('SIGTERM', () => { void server.close().then(() => process.exit(0)); });
