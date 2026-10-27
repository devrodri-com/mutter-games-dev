import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { object, parseReleaseBuildIdentity, type ReleaseBuildIdentity } from './release-build-identity.js';
// Trace the same receipt validator into the native artifacts so release tooling
// can test the emitted contract without copying its acceptance policy.
export { verifyReleaseAttestation } from './release-attestation-verifier.js';

export type ReleaseHandler = 'checkout' | 'reconcile' | 'access';
export type ReleaseRequest = {
    method?: string;
    headers: Record<string, string | string[] | undefined>;
};
export type ReleaseResponse = {
    setHeader(name: string, value: string): unknown;
    status(code: number): ReleaseResponse;
    json(body: unknown): unknown;
};
export type ReleaseAttestation = {
    schemaVersion: 1;
    handler: ReleaseHandler;
    node: string;
    nativeUndici: string | null;
    deployment: { id: string | null; url: string | null; commit: string | null; environment: string | null; region: string | null; runtime: string };
    coldStartId: string;
    invocationId: string;
    buildIdentity: ReleaseBuildIdentity | null;
};

const coldStartId = randomUUID();
const secretFormat = /^[A-Za-z0-9_-]{32,256}$/;

export function releaseAuthorized(header: unknown, secret: unknown): boolean {
    if (typeof secret !== 'string' || !secretFormat.test(secret) || typeof header !== 'string'
        || !/^Bearer [A-Za-z0-9_-]{32,256}$/.test(header)) return false;
    return timingSafeEqual(createHash('sha256').update(header).digest(), createHash('sha256').update(`Bearer ${secret}`).digest());
}

function metadata(name: string, format: RegExp): string | null {
    const value = process.env[name];
    return typeof value === 'string' && format.test(value) ? value : null;
}

function readBuildIdentity(): ReleaseBuildIdentity | null {
    // Static URL is traced into both Node artifacts. This is a local artifact
    // read after authentication, never a database/network/configuration fetch.
    const value: unknown = JSON.parse(readFileSync(new URL('./release-build-identity.json', import.meta.url), 'utf8'));
    const row = object(value);
    if (row?.schemaVersion === 1 && row.status === 'UNSTAMPED' && Object.keys(row).length === 2) return null;
    const identity = parseReleaseBuildIdentity(value);
    if (!identity) throw new Error('Invalid release build identity');
    return identity;
}

export function handleReleaseAttestation(req: ReleaseRequest, res: ReleaseResponse, handler: ReleaseHandler): boolean {
    const action = req.headers['x-mutter-release-action'];
    if (action === undefined) return false;
    res.setHeader('Cache-Control', 'no-store');
    const method = handler === 'reconcile' ? 'GET' : 'POST';
    if (req.method !== method) {
        res.setHeader('Allow', method);
        res.status(405).json({ error: 'Method not allowed' });
        return true;
    }
    if (action !== 'runtime-attestation') {
        res.status(400).json({ error: 'Invalid release action' });
        return true;
    }
    if (!releaseAuthorized(req.headers.authorization, process.env.RELEASE_ATTESTATION_SECRET)) {
        res.status(401).json({ error: 'Unauthorized' });
        return true;
    }
    try {
        const receipt: ReleaseAttestation = {
            schemaVersion: 1, handler, node: process.version, nativeUndici: process.versions.undici ?? null,
            deployment: {
                id: metadata('VERCEL_DEPLOYMENT_ID', /^dpl_[A-Za-z0-9]+$/),
                url: metadata('VERCEL_URL', /^[a-z0-9-]+\.vercel\.app$/),
                commit: metadata('VERCEL_GIT_COMMIT_SHA', /^[a-f0-9]{40}$/),
                environment: metadata('VERCEL_ENV', /^(production|preview|development)$/),
                region: metadata('VERCEL_REGION', /^[a-z0-9-]{1,32}$/),
                runtime: process.release.name,
            },
            coldStartId, invocationId: randomUUID(), buildIdentity: readBuildIdentity(),
        };
        console.info(JSON.stringify({ event: 'release-runtime-attestation', handler, coldStartId, invocationId: receipt.invocationId }));
        res.status(200).json(receipt);
    } catch {
        // A missing/corrupt artifact is an observable failure, not a successful
        // receipt with fabricated identity or an exception containing paths.
        res.status(503).json({ error: 'Release attestation unavailable' });
    }
    return true;
}
