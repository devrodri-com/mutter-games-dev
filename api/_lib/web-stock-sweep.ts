import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { FieldPath, type Firestore, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { reconcileOrder, type CheckoutOptions } from './order-reconciliation.js';
import { PROVIDER_BUDGET_MS } from './reconciliation-policy.js';

export const STOCK_SWEEP_LIMIT = 20;
export const STOCK_SWEEP_CONCURRENCY = 2;
export const STOCK_SWEEP_BUDGET_MS = 40_000;
export type SweepResult = {
    selected: number;
    attempted: number;
    processed: number;
    deferred: number;
    failed: number;
    remaining: number;
    deadlineReached: boolean;
};
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
    const result: SweepResult = { selected: 0, attempted: 0, processed: 0, deferred: 0, failed: 0, remaining: 0, deadlineReached: false };
    await maintenance.set({ runId, lastStartedAt: dueAt, state: 'running' });
    const finish = async (state: 'completed' | 'partial' | 'failed') => {
        await db.runTransaction(async tx => {
            const latest = await tx.get(maintenance);
            // A slower earlier invocation cannot overwrite the newer run's receipt.
            if (latest.data()?.runId !== runId) return;
            tx.set(maintenance, { runId, lastStartedAt: dueAt, lastFinishedAt: clock(), state,
                durationMs: Math.max(0, Math.round(wallNow() - wallStart)), ...result });
        });
    };
    let rows: QueryDocumentSnapshot[];
    try {
        const due = await db.collection('orders')
            .where('commerceVersion', '==', 2)
            .where('reconciliation.nextCheckAt', '<=', dueAt)
            .orderBy('reconciliation.nextCheckAt')
            .orderBy(FieldPath.documentId())
            .limit(STOCK_SWEEP_LIMIT).get();
        rows = due.docs;
    } catch {
        await finish('failed');
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
                if (outcome === 'checked') result.processed++;
                else result.deferred++;
            } catch {
                // The per-order reconciler persists backoff/attention. A poison row must
                // not prevent the rest of this finite batch from making progress.
                result.failed++;
            }
        }
    };
    await Promise.all(Array.from({ length: STOCK_SWEEP_CONCURRENCY }, () => worker()));
    result.remaining = result.selected - result.attempted;
    await finish(result.failed || result.deadlineReached ? 'partial' : 'completed');
    return result;
}
