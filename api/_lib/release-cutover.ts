import type { Firestore } from 'firebase-admin/firestore';

/** Cross-repository protocol. Keep the paired Admin implementation identical. */
export const CUTOVER_PATH = 'operations/webStockCutover';
export class CutoverClosedError extends Error {
    readonly status = 503;
    readonly code = 'CUTOVER_CLOSED';
    constructor() { super('La operación está temporalmente cerrada. Intentá nuevamente más tarde.'); }
}

/**
 * One strongly consistent, uncached read is the admission linearization point.
 * Work admitted before the close may finish: the release must drain the EFFECTIVE
 * deployment timeout. This is not a lock that cancels in-flight provider work.
 * Missing/unreadable/malformed control never defaults to open.
 */
export async function assertCutoverOpen(db: Firestore, mode: 'writer' | 'reconcile' = 'writer'): Promise<void> {
    try {
        const snapshot = await db.doc(CUTOVER_PATH).get();
        const control: unknown = snapshot.data();
        if (!control || typeof control !== 'object' ||
            !('schema' in control) || control.schema !== 1 ||
            !('state' in control) || !(control.state === 'open' || mode === 'reconcile' && control.state === 'reconciling') ||
            !('revision' in control) || typeof control.revision !== 'string' || !/^[a-zA-Z0-9_-]{16,100}$/.test(control.revision) ||
            !('updatedAt' in control) || !control.updatedAt || typeof control.updatedAt !== 'object' ||
            !('toMillis' in control.updatedAt) || typeof control.updatedAt.toMillis !== 'function' ||
            !Number.isFinite(control.updatedAt.toMillis())) throw new CutoverClosedError();
    } catch {
        // Fail closed without including Firestore paths, credentials or internal errors.
        throw new CutoverClosedError();
    }
}
