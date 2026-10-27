import { object, parseReleaseBuildIdentity } from './release-build-identity.js';
import type { ReleaseHandler } from './release-attestation.js';

export type AttestationExpectation = {
    handler: ReleaseHandler;
    deploymentId: string;
    deploymentUrl: string;
    head: string;
    tree: string;
    buildId: string;
    node: string;
    nativeUndici: string;
};

function supportedVersion(value: string, major: number, minimumMinor: number, minimumPatch: number): boolean {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
    if (!match) return false;
    const [, actualMajor, minor, patch] = match;
    return Number(actualMajor) === major && (Number(minor) > minimumMinor || (Number(minor) === minimumMinor && Number(patch) >= minimumPatch));
}

// The caller must obtain expectations from the immutable artifact and the
// exact candidate deployment record, never from the response being verified.
// No runtime attestation endpoint self-declares PASS.
export function verifyReleaseAttestation(value: unknown, expected: AttestationExpectation): { status: 'VERIFIED' | 'NOT_VERIFIED'; reasons: string[] } {
    const reasons: string[] = [];
    const row = object(value);
    const deployment = object(row?.deployment);
    const build = parseReleaseBuildIdentity(row?.buildIdentity);
    if (!row || Object.keys(row).sort().join(',') !== 'buildIdentity,coldStartId,deployment,handler,invocationId,nativeUndici,node,schemaVersion'
        || row.schemaVersion !== 1) reasons.push('INVALID_RECEIPT_SCHEMA');
    if (!['checkout', 'reconcile', 'access'].includes(expected.handler) || row?.handler !== expected.handler) reasons.push('HANDLER_NOT_VERIFIED');
    if (!/^dpl_[A-Za-z0-9]+$/.test(expected.deploymentId) || deployment?.id !== expected.deploymentId
        || !/^[a-z0-9-]+\.vercel\.app$/.test(expected.deploymentUrl) || deployment?.url !== expected.deploymentUrl)
        reasons.push('DEPLOYMENT_NOT_VERIFIED');
    if (!deployment || Object.keys(deployment).sort().join(',') !== 'commit,environment,id,region,runtime,url'
        || deployment.runtime !== 'node' || !['preview', 'production'].includes(String(deployment.environment))
        || (deployment.region !== null && (typeof deployment.region !== 'string' || !/^[a-z0-9-]{1,32}$/.test(deployment.region))))
        reasons.push('RUNTIME_METADATA_NOT_VERIFIED');
    if (typeof expected.node !== 'string' || !expected.node.startsWith('v') || !supportedVersion(expected.node.slice(1), 22, 23, 3) || row?.node !== expected.node)
        reasons.push('NODE_NOT_VERIFIED');
    if (!supportedVersion(expected.nativeUndici, 6, 28, 1) || row?.nativeUndici !== expected.nativeUndici)
        reasons.push('NATIVE_UNDICI_NOT_VERIFIED');
    if (!build || build.head !== expected.head || build.tree !== expected.tree || build.buildId !== expected.buildId)
        reasons.push('BUILD_IDENTITY_NOT_VERIFIED');
    // A prebuilt may lack Git integration metadata. Its immutable build stamp
    // binds the commit; a present platform commit must agree, never override it.
    if (deployment?.commit !== null && deployment?.commit !== expected.head) reasons.push('PLATFORM_COMMIT_MISMATCH');
    const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
    if (typeof row?.coldStartId !== 'string' || !uuid.test(row.coldStartId)
        || typeof row?.invocationId !== 'string' || !uuid.test(row.invocationId)) reasons.push('INVOCATION_NOT_VERIFIED');
    return { status: reasons.length ? 'NOT_VERIFIED' : 'VERIFIED', reasons };
}
