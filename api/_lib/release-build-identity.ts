import { createHash } from 'node:crypto';

export type ReleaseBuildIdentity = {
    schemaVersion: 1;
    head: string;
    tree: string;
    packageLockSha256: string;
    functionsLockSha256: string;
    builder: '@vercel/node@5.10.2';
    buildNode: 'v22.23.3';
    buildId: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function object(value: unknown): Record<string, unknown> | null {
    return isObject(value) ? value : null;
}

// This is also consumed by the receipt verifier. The build stamp is generated in
// the emitted artifact; the tracked UNSTAMPED source cannot identify a release.
export function parseReleaseBuildIdentity(value: unknown): ReleaseBuildIdentity | null {
    const row = object(value);
    if (!row || Object.keys(row).sort().join(',') !== 'buildId,buildNode,builder,functionsLockSha256,head,packageLockSha256,schemaVersion,tree'
        || row.schemaVersion !== 1 || typeof row.head !== 'string' || !/^[a-f0-9]{40}$/.test(row.head)
        || typeof row.tree !== 'string' || !/^[a-f0-9]{40}$/.test(row.tree)
        || typeof row.packageLockSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.packageLockSha256)
        || typeof row.functionsLockSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.functionsLockSha256)
        || row.builder !== '@vercel/node@5.10.2' || row.buildNode !== 'v22.23.3'
        || typeof row.buildId !== 'string' || !/^[a-f0-9]{64}$/.test(row.buildId)) return null;
    const identity: Omit<ReleaseBuildIdentity, 'buildId'> = {
        schemaVersion: 1, head: row.head, tree: row.tree,
        packageLockSha256: row.packageLockSha256, functionsLockSha256: row.functionsLockSha256,
        builder: row.builder, buildNode: row.buildNode,
    };
    const buildId = createHash('sha256').update(JSON.stringify(identity)).digest('hex');
    return buildId === row.buildId ? { ...identity, buildId } : null;
}
