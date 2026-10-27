import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { FieldPath, FieldValue, type Firestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { reconcileOrder, type CheckoutOptions } from './order-reconciliation.js';
import { PROVIDER_BUDGET_MS } from './reconciliation-policy.js';

export const STOCK_SWEEP_LIMIT = 20;
export const STOCK_SWEEP_CONCURRENCY = 2;
export const STOCK_SWEEP_BUDGET_MS = 40_000;
export type SweepResult = {
    selected: number;
    attempted: number;
    /** Returned observations: verified + unverified; not a count of sales or releases. */
    processed: number;
    verified: number;
    unverified: number;
    /** Attempted rows deferred by the per-order lease/cadence guard. */
    deferred: number;
    failed: number;
    unattemptedInBatch: number;
    deadlineReached: boolean;
    /** Queue selection sample at measuredAt, not a post-run or global remaining count. */
    moreDue: boolean | null;
    oldestDueLagMs: number | null;
    measuredAt: number | null;
};
type FailureType = 'selection_failed' | 'reconciliation_failed' | 'provider_unverified' | 'deadline_reached';
type SweepExecution = {
    wallNow?: () => number;
    reconcile?: typeof reconcileOrder;
};

export async function runWebStockSweep(db: Firestore, options: CheckoutOptions, execution: SweepExecution = {}): Promise<SweepResult> {
    const clock = options.now ?? Date.now;
    const wallNow = execution.wallNow ?? (() => performance.now());
    const wallStart = wallNow();
    const dueAt = clock();
    const runId = randomUUID();
    const maintenance = db.collection('webStockMaintenance').doc('reconciliation');
    const result: SweepResult = { selected: 0, attempted: 0, processed: 0, verified: 0, unverified: 0, deferred: 0, failed: 0,
        unattemptedInBatch: 0, deadlineReached: false, moreDue: null, oldestDueLagMs: null, measuredAt: null };
    // Register each invocation transactionally, retaining the bounded historical failure summary.
    // The current receipt belongs to the latest registered run, independently of completion order.
    await db.runTransaction(async tx => {
        await tx.get(maintenance);
        tx.set(maintenance, { runId, lastStartedAt: dueAt, state: 'running', ...result,
            failureTypes: [], lastFinishedAt: FieldValue.delete(), durationMs: FieldValue.delete(), remaining: FieldValue.delete() }, { merge: true });
    });
    const finish = async (state: 'completed' | 'partial' | 'failed', failureTypes: FailureType[]) => {
        await db.runTransaction(async tx => {
            const latest = await tx.get(maintenance);
            const history = failureTypes.length ? {
                // Server commit time orders recorded failures across workers with different clocks.
                // This is historical evidence, not the health/state of the latest registered run.
                lastFailureAt: FieldValue.serverTimestamp(), lastFailureRunId: runId, lastFailureTypes: failureTypes,
                lastFailureCounts: { unverified: result.unverified, failed: result.failed, unattemptedInBatch: result.unattemptedInBatch },
            } : {};
            if (latest.data()?.runId === runId) {
                tx.set(maintenance, { runId, lastStartedAt: dueAt, lastFinishedAt: clock(), state, failureTypes,
                    durationMs: Math.max(0, Math.round(wallNow() - wallStart)), ...result, ...history }, { merge: true });
            } else if (failureTypes.length) {
                // A late worker can record its failure, but cannot replace another run's current status.
                tx.set(maintenance, history, { merge: true });
            }
        });
    };
    let rows: QueryDocumentSnapshot[];
    try {
        const due = await db.collection('orders')
            .where('commerceVersion', '==', 2)
            .where('reconciliation.nextCheckAt', '<=', dueAt)
            .orderBy('reconciliation.nextCheckAt')
            .orderBy(FieldPath.documentId())
            .limit(STOCK_SWEEP_LIMIT + 1).get();
        rows = due.docs.slice(0, STOCK_SWEEP_LIMIT);
        result.moreDue = due.size > STOCK_SWEEP_LIMIT;
        result.measuredAt = dueAt;
        const oldestDue: unknown = rows[0]?.get('reconciliation.nextCheckAt');
        result.oldestDueLagMs = typeof oldestDue === 'number' && Number.isSafeInteger(oldestDue) ? Math.max(0, dueAt - oldestDue) : null;
    } catch {
        await finish('failed', ['selection_failed']);
        throw new Error('Stock reconciliation queue unavailable');
    }
    result.selected = rows.length;
    let cursor = 0;
    const reconcile = execution.reconcile ?? reconcileOrder;
    const worker = async () => {
        while (cursor < rows.length) {
            // Stop admission before the shared wall deadline. An already-running Firestore
            // transaction finishes normally; the function has a separate 60-second ceiling.
            if (wallNow() - wallStart + PROVIDER_BUDGET_MS >= STOCK_SWEEP_BUDGET_MS) {
                result.deadlineReached = true;
                return;
            }
            const row = rows[cursor++];
            result.attempted++;
            try {
                const outcome = await reconcile(db, row.id, options, 'sweep');
                if (outcome === 'deferred') result.deferred++;
                else {
                    result.processed++;
                    if (outcome === 'verified') result.verified++;
                    else result.unverified++;
                }
            } catch {
                // The per-order reconciler persists backoff/attention. A poison row must
                // not prevent the rest of this finite batch from making progress.
                result.failed++;
            }
        }
    };
    await Promise.all(Array.from({ length: STOCK_SWEEP_CONCURRENCY }, () => worker()));
    result.unattemptedInBatch = result.selected - result.attempted;
    const failures: FailureType[] = [];
    if (result.failed) failures.push('reconciliation_failed');
    if (result.unverified) failures.push('provider_unverified');
    if (result.deadlineReached) failures.push('deadline_reached');
    await finish(failures.length ? 'partial' : 'completed', failures);
    return result;
}
