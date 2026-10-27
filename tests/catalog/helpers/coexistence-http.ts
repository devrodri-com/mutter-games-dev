import { createServer, request as httpRequest } from 'node:http';
import type { AccessResponse } from '../../../api/_lib/credential-access-handler';
import { object } from './web-stock-harness';

export type CoexistenceReply = { status: number; value: Record<string, unknown>; cache: string | undefined };

/** Real HTTP framing and real production dispatch. Auth, credential admission,
 * stock cutover, request-IP admission and catalog transactions are not replaced. */
export async function createCoexistenceHttp() {
    // Only the test dispatcher changes source roots for the before-correction
    // reproduction. Both branches import actual handlers and their own graphs.
    const [access, checkout, catalog] = process.env.MUTTER_TEST_COEXISTENCE_BASELINE === '1'
        ? await Promise.all([import('../../../../frontend/api/access'),
            import('../../../../frontend/api/create-mp-preference'), import('../../../../frontend/api/catalog-edit')])
        : await Promise.all([import('../../../api/access'),
            import('../../../api/create-mp-preference'), import('../../../api/catalog-edit')]);
    const failures: unknown[] = [];
    const requests: { path: string; method: string; status: number }[] = [];
    const server = createServer(async (request, response) => {
        try {
            const chunks: Buffer[] = [];
            for await (const chunk of request) chunks.push(Buffer.from(chunk));
            const incoming = Object.assign(request, { query: {}, cookies: {},
                body: Buffer.concat(chunks).toString('utf8') || undefined });
            let status = 200;
            const output: AccessResponse = {
                setHeader(name, value) { response.setHeader(name, value); return output; },
                status(code) { status = code; return output; },
                json(value) {
                    requests.push({ path: request.url ?? '', method: request.method ?? '', status });
                    response.statusCode = status; response.setHeader('Content-Type', 'application/json');
                    response.end(JSON.stringify(value)); return output;
                },
            };
            switch (request.url?.split('?')[0]) {
                case '/api/access/session': await access.default(incoming, output); break;
                case '/api/create-mp-preference': await checkout.default(incoming, output); break;
                case '/api/catalog-edit': await catalog.default(incoming, output); break;
                default: throw new Error('Unexpected local coexistence route');
            }
        } catch (error: unknown) {
            failures.push(error); response.statusCode = 500; response.end('{}');
        }
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing loopback HTTP address');
    const base = `http://127.0.0.1:${address.port}`;

    async function call(path: string, token: string, method = 'POST', body?: unknown): Promise<CoexistenceReply> {
        const encoded = body === undefined ? undefined : JSON.stringify(body);
        return new Promise((resolve, reject) => {
            const request = httpRequest(base + path, { method, headers: {
                host: 'muttergames.com', origin: 'https://muttergames.com', authorization: `Bearer ${token}`,
                'x-vercel-forwarded-for': '203.0.113.24', 'content-type': 'application/json',
                ...(encoded === undefined ? {} : { 'content-length': String(Buffer.byteLength(encoded)) }),
            } }, response => {
                const chunks: Buffer[] = [];
                response.on('data', chunk => chunks.push(Buffer.from(chunk)));
                response.on('error', reject);
                response.on('end', () => {
                    try {
                        resolve({ status: response.statusCode ?? 0,
                            value: object(JSON.parse(Buffer.concat(chunks).toString('utf8'))),
                            cache: response.headers['cache-control'] });
                    } catch (error: unknown) { reject(error); }
                });
            });
            request.setTimeout(10_000, () => request.destroy(new Error('Local coexistence request timed out')));
            request.on('error', reject); request.end(encoded);
        });
    }
    return { call, requests, dispose: async () => {
        server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
        if (failures.length) throw new Error('Local coexistence HTTP adapter failed', { cause: failures[0] });
    } };
}
