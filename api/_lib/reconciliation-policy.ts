import { CheckoutError, record } from './checkout-domain.js';
import { mercadoPagoNumericId, PAYMENT_TRACKING_HORIZON_MS } from './mercado-pago-payments.js';

export const PAYMENT_WINDOW_MS = 30 * 60_000;
// Operational grace, not a bound on provider indexing or settlement latency.
export const RECONCILIATION_GRACE_MS = 15 * 60_000;
export const MIN_RECHECK_MS = 60_000;
export const RECONCILIATION_LEASE_MS = 60_000;
export const PROVIDER_BUDGET_MS = 3_000;
export type Reconciliation = {
    state: 'scheduled' | 'review' | 'complete';
    nextCheckAt: number | null;
    coverageUntil: number;
    failures: number;
    lastAttemptAt?: number;
    lastProgressAt?: number;
    lastError?: string;
    leaseOwner?: string;
    leaseUntil?: number;
};

export function configuredCollector(value: unknown = process.env.MP_COLLECTOR_ID): string {
    try { return mercadoPagoNumericId(value); }
    catch { throw new CheckoutError(503, 'PAYMENT_CONFIGURATION_UNAVAILABLE', 'No pudimos habilitar el pago. Intentá nuevamente más tarde.'); }
}

export function initialReconciliation(createdAt: number): Reconciliation {
    return { state: 'scheduled', nextCheckAt: createdAt + MIN_RECHECK_MS,
        coverageUntil: createdAt + PAYMENT_TRACKING_HORIZON_MS, failures: 0 };
}

export function readReconciliation(value: unknown, createdAt: number): Reconciliation {
    if (value === undefined) return initialReconciliation(createdAt);
    const raw = record(value);
    if (!['scheduled', 'review', 'complete'].includes(String(raw.state)) ||
        !(raw.nextCheckAt === null || Number.isSafeInteger(raw.nextCheckAt)) ||
        typeof raw.coverageUntil !== 'number' || !Number.isSafeInteger(raw.coverageUntil) ||
        typeof raw.failures !== 'number' || !Number.isInteger(raw.failures) || raw.failures < 0) throw new Error('Invalid reconciliation state');
    for (const key of ['lastAttemptAt', 'lastProgressAt', 'leaseUntil']) {
        if (raw[key] !== undefined && (typeof raw[key] !== 'number' || !Number.isSafeInteger(raw[key]) || Number(raw[key]) < 0)) throw new Error('Invalid reconciliation timestamp');
    }
    const state = raw.state;
    if (state !== 'scheduled' && state !== 'review' && state !== 'complete') throw new Error('Invalid reconciliation state');
    const nextCheckAt = typeof raw.nextCheckAt === 'number' ? raw.nextCheckAt : null;
    return { state, nextCheckAt, coverageUntil: raw.coverageUntil, failures: raw.failures,
        ...(typeof raw.lastAttemptAt === 'number' ? { lastAttemptAt: raw.lastAttemptAt } : {}),
        ...(typeof raw.lastProgressAt === 'number' ? { lastProgressAt: raw.lastProgressAt } : {}),
        ...(typeof raw.lastError === 'string' ? { lastError: raw.lastError } : {}),
        ...(typeof raw.leaseOwner === 'string' ? { leaseOwner: raw.leaseOwner } : {}),
        ...(typeof raw.leaseUntil === 'number' ? { leaseUntil: raw.leaseUntil } : {}) };
}

export function knownPaymentIds(value: unknown): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 100 || value.some(id => typeof id !== 'string' || !mercadoPagoNumericId(id))) {
        throw new Error('Invalid known payment identifiers');
    }
    return [...new Set(value.filter((id): id is string => typeof id === 'string'))];
}

export function followingCheck(reconciliation: Reconciliation, inventoryState: string, now: number,
    createdAt: number, failed = false): Reconciliation {
    const base = { ...reconciliation };
    delete base.leaseOwner; delete base.leaseUntil; delete base.lastError;
    if (now >= reconciliation.coverageUntil) {
        return { ...base, state: 'review', nextCheckAt: null,
            lastError: 'provider_history_window_exceeded' };
    }
    if (failed) {
        const failures = Math.min(reconciliation.failures + 1, 30);
        const delay = Math.min(60 * 60_000, MIN_RECHECK_MS * 2 ** Math.min(failures - 1, 6));
        return { ...base, state: 'review', failures, nextCheckAt: Math.min(now + delay, reconciliation.coverageUntil),
            lastError: 'reservation_reconciliation_failed' };
    }
    const age = now - createdAt;
    const interval = inventoryState === 'reserved' ? MIN_RECHECK_MS :
        inventoryState === 'released' && age < 7 * 86_400_000 ? 60 * 60_000 : 86_400_000;
    return { ...base, state: 'scheduled', failures: 0, lastProgressAt: now,
        nextCheckAt: Math.min(now + interval, reconciliation.coverageUntil) };
}
