export type PendingAttempt = { key: string; content: string; quoteHash: string; receivedOrderId?: string };
type AttemptSnapshot = { raw: string | null; attempt: PendingAttempt | null };
const changed = () => new Error('El intento guardado cambió. Conservamos su estado para verificación.');

function parseAttempt(raw: string | null): PendingAttempt | null {
    if (raw === null) return null;
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data) ||
        !('key' in data) || typeof data.key !== 'string' || !data.key.trim() ||
        !('content' in data) || typeof data.content !== 'string' ||
        !('quoteHash' in data) || typeof data.quoteHash !== 'string' ||
        ('receivedOrderId' in data && (typeof data.receivedOrderId !== 'string' || !data.receivedOrderId.trim())))
        throw new Error('El intento guardado requiere verificación. No inicies otro pago.');
    return { key: data.key, content: data.content, quoteHash: data.quoteHash,
        ...('receivedOrderId' in data && typeof data.receivedOrderId === 'string' ? { receivedOrderId: data.receivedOrderId } : {}) };
}
function samePurchase(left: PendingAttempt, right: PendingAttempt): boolean {
    return left.key === right.key && left.content === right.content && left.quoteHash === right.quoteHash;
}

/** Serializes participating checkout tabs for the full async operation; never sends unlocked. */
export async function withCheckoutLock(task: () => Promise<void>): Promise<void> {
    if (!navigator.locks?.request)
        throw new Error('Este navegador no permite verificar la compra de forma segura. Usá un navegador actualizado.');
    await navigator.locks.request('mutter-checkout-operation', { mode: 'exclusive', ifAvailable: true }, async lock => {
        if (!lock) throw new Error('Hay otra pestaña verificando una compra. Esperá antes de continuar.');
        await task();
    });
}

/**
 * The native lock excludes cooperating tabs. Exact raw snapshots additionally
 * detect observed writes by older tabs across awaits; they are not cross-tab CAS.
 */
export class CheckoutAttemptOwner {
    private current: AttemptSnapshot;
    private lastOrderRaw: string | null;
    private readonly auxiliary = new Map<string, string>();
    private readonly intentPrefix: string;
    private readonly receiptPrefix: string;
    private restored = false;
    constructor(private readonly storageKey: string) {
        const raw = localStorage.getItem(storageKey);
        this.current = { raw, attempt: parseAttempt(raw) };
        this.lastOrderRaw = localStorage.getItem('lastOrderId');
        this.intentPrefix = `${storageKey}:attempt:`;
        this.receiptPrefix = `${storageKey}:receipt:`;
        for (let index = 0; index < localStorage.length; index++) {
            const name = localStorage.key(index);
            if (name?.startsWith(this.intentPrefix) || name?.startsWith(this.receiptPrefix)) {
                const value = localStorage.getItem(name);
                if (value !== null) this.auxiliary.set(name, value);
            }
        }
    }
    snapshot(): AttemptSnapshot { return { ...this.current }; }
    assertCurrent(): void {
        if (localStorage.getItem(this.storageKey) !== this.current.raw ||
            localStorage.getItem('lastOrderId') !== this.lastOrderRaw) throw changed();
    }
    private writeRaw(raw: string | null): void {
        this.assertCurrent();
        if (raw === null) localStorage.removeItem(this.storageKey);
        else localStorage.setItem(this.storageKey, raw);
        this.current = { raw, attempt: parseAttempt(raw) };
        this.assertCurrent();
    }
    replace(attempt: PendingAttempt): void { this.writeRaw(JSON.stringify(attempt)); }
    remove(): void { this.writeRaw(null); }
    restore(predecessor: AttemptSnapshot): void { this.writeRaw(predecessor.raw); }
    setLastOrder(id: string): void {
        this.assertCurrent();
        localStorage.setItem('lastOrderId', id);
        this.lastOrderRaw = id;
        this.assertCurrent();
    }
    private auxiliaryRaw(name: string): string | null {
        const expected = this.auxiliary.get(name) ?? null;
        if (localStorage.getItem(name) !== expected) throw changed();
        return expected;
    }
    private writeAuxiliary(name: string, raw: string | null): void {
        this.auxiliaryRaw(name);
        if (raw === null) {
            localStorage.removeItem(name);
            this.auxiliary.delete(name);
        } else {
            localStorage.setItem(name, raw);
            this.auxiliary.set(name, raw);
        }
        this.auxiliaryRaw(name);
    }
    private intentName(attempt: PendingAttempt): string {
        return this.intentPrefix + encodeURIComponent(attempt.key);
    }
    private pendingIntents(): PendingAttempt[] {
        return [...this.auxiliary.keys()].filter(name => name.startsWith(this.intentPrefix)).sort()
            .map(name => {
                const attempt = parseAttempt(this.auxiliaryRaw(name));
                if (!attempt || name !== this.intentName(attempt)) throw changed();
                return attempt;
            });
    }
    get restoredPending(): boolean { return this.restored; }
    hasOtherPending(): boolean {
        return this.pendingIntents().some(attempt => attempt.key !== this.current.attempt?.key);
    }
    /** Resolve the current primary first; a later action recovers an orphan by its original key. */
    recoverPending(): PendingAttempt | null {
        let pending = this.current.attempt;
        const intents = this.pendingIntents(), orphan = intents[0];
        if (!pending && orphan) {
            this.replace(orphan);
            this.restored = true;
            return orphan;
        }
        const remembered = intents.find(attempt => attempt.key === pending?.key);
        if (pending && remembered) {
            if (!samePurchase(pending, remembered) || pending.receivedOrderId && remembered.receivedOrderId &&
                pending.receivedOrderId !== remembered.receivedOrderId) throw changed();
            if (!pending.receivedOrderId && remembered.receivedOrderId) {
                pending = remembered;
                this.replace(pending);
            }
        }
        return pending;
    }
    ensurePending(attempt: PendingAttempt): void {
        this.assertCurrent();
        const name = this.intentName(attempt), saved = parseAttempt(this.auxiliaryRaw(name));
        if (!saved) this.writeAuxiliary(name, JSON.stringify(attempt));
        else if (!samePurchase(saved, attempt) || saved.receivedOrderId && attempt.receivedOrderId &&
            saved.receivedOrderId !== attempt.receivedOrderId) throw changed();
    }
    begin(attempt: PendingAttempt): void {
        this.assertCurrent();
        const name = this.intentName(attempt);
        if (this.auxiliaryRaw(name) !== null) throw changed();
        this.writeAuxiliary(name, JSON.stringify(attempt));
    }
    finish(attempt: PendingAttempt, neverSent = false): void {
        const name = this.intentName(attempt), raw = this.auxiliaryRaw(name);
        const saved = parseAttempt(raw);
        if (!saved) return;
        if (!samePurchase(saved, attempt) || neverSent && saved.receivedOrderId ||
            attempt.receivedOrderId && saved.receivedOrderId && saved.receivedOrderId !== attempt.receivedOrderId) throw changed();
        this.writeAuxiliary(name, null);
    }
    /** A sent result survives even if another tab now owns the primary pointer. */
    recordReceipt(attempt: PendingAttempt, id: string): void {
        if (!id.trim() || attempt.receivedOrderId && attempt.receivedOrderId !== id)
            throw new Error('La compra requiere verificación. Conservamos su comprobante anterior.');
        const intentName = this.intentName(attempt), intent = parseAttempt(this.auxiliaryRaw(intentName));
        if (intent && (!samePurchase(intent, attempt) || intent.receivedOrderId && intent.receivedOrderId !== id)) throw changed();
        const raw = JSON.stringify({ ...attempt, receivedOrderId: id });
        if (!intent?.receivedOrderId) this.writeAuxiliary(intentName, raw);
        const name = this.receiptPrefix + encodeURIComponent(attempt.key);
        const existing = parseAttempt(this.auxiliaryRaw(name));
        if (existing) {
            if (!samePurchase(existing, attempt) || existing.receivedOrderId !== id) throw changed();
            return;
        }
        this.writeAuxiliary(name, raw);
    }
}
