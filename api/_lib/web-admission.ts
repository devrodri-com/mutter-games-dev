import { createHash, createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import type { IncomingHttpHeaders } from 'node:http';
import type { DocumentReference, Firestore, Transaction } from 'firebase-admin/firestore';
import { CheckoutError } from './checkout-domain.js';

export const ADMISSION_LIMITS = { uidActive: 2, ipActive: 10, uidPerHour: 6, ipPerHour: 30 } as const;
const HOUR_MS = 60 * 60 * 1000;
const DIGEST = /^[a-f0-9]{64}$/;
const IP_HEADER = 'x-vercel-forwarded-for';
export type AdmissionContext = { readonly ipKey: string };
type Bucket = { active: string[]; admittedAt: number[]; reviewOrderIds: string[] };
type BucketWrite = { ref: DocumentReference; data: Bucket };
export type AdmissionPlan = {
    claimRef: DocumentReference;
    claim: { uidKey: string; ipKey: string; released: false; createdAt: number };
    buckets: BucketWrite[];
    reused: boolean;
};
export type QuotaReleasePlan = { claimRef: DocumentReference; buckets: BucketWrite[] } | null;

function unavailable(): never {
    throw new CheckoutError(503, 'ADMISSION_UNAVAILABLE', 'No pudimos validar los límites de compra. Probá más tarde.');
}
function invalidIp(): never {
    throw new CheckoutError(400, 'ADMISSION_IP_UNAVAILABLE', 'No pudimos validar la conexión para iniciar esta compra.');
}
function object(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) unavailable();
    return value as Record<string, unknown>;
}
function orderId(value: unknown): string {
    if (typeof value !== 'string' || !DIGEST.test(value)) unavailable();
    return value;
}
function clock(value: number) {
    if (!Number.isSafeInteger(value) || value < 0) unavailable();
}

/** Only the platform header is accepted. Missing/ambiguous values never share a fallback bucket. */
export function normalizeAdmissionIp(value: unknown): string {
    if (typeof value !== 'string' || !value || value.length > 64 || value.includes('%') || value.includes(',')) invalidIp();
    const candidate = value.trim();
    const family = isIP(candidate);
    if (family === 4) return candidate;
    if (family !== 6) invalidIp();
    // WHATWG URL serialization canonicalizes IPv6 spelling without a new dependency.
    const canonical = new URL(`http://[${candidate}]/`).hostname.slice(1, -1);
    const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(canonical);
    if (!mapped) return canonical;
    const high = Number.parseInt(mapped[1], 16);
    const low = Number.parseInt(mapped[2], 16);
    return [high >>> 8, high & 255, low >>> 8, low & 255].join('.');
}

export function requestAdmissionContext(
    headers: IncomingHttpHeaders,
    rawHeaders?: readonly string[],
): AdmissionContext {
    const secret = process.env.WEB_ADMISSION_HMAC_SECRET;
    if (process.env.VERCEL !== '1' || !secret || secret.length < 32 || secret.trim() !== secret ||
        /[\r\n]/.test(secret) || secret === process.env.CRON_SECRET) unavailable();
    const names = Object.keys(headers).filter(name => name.toLowerCase() === IP_HEADER);
    if (names.length !== 1 || names[0] !== IP_HEADER) invalidIp();
    if (rawHeaders) {
        if (rawHeaders.length % 2 !== 0) invalidIp();
        let count = 0;
        for (let i = 0; i < rawHeaders.length; i += 2) {
            if (rawHeaders[i].toLowerCase() === IP_HEADER) count++;
        }
        if (count !== 1) invalidIp();
    }
    const ip = normalizeAdmissionIp(headers[IP_HEADER]);
    return { ipKey: createHmac('sha256', secret).update(`mutter:web-admission:ip:v1\0${ip}`).digest('hex') };
}

function uidKey(uid: string): string {
    if (typeof uid !== 'string' || !uid || uid.length > 128) unavailable();
    return createHash('sha256').update(`mutter:web-admission:uid:v1\0${uid}`).digest('hex');
}
function readBucket(value: unknown, exists: boolean, activeLimit: number, rateLimit: number, now?: number): Bucket {
    if (!exists) return { active: [], admittedAt: [], reviewOrderIds: [] };
    const raw = object(value);
    if (raw.version !== 1 || !Array.isArray(raw.active) || raw.active.length > activeLimit ||
        !Array.isArray(raw.admittedAt) || raw.admittedAt.length > rateLimit) unavailable();
    const active = raw.active.map(orderId);
    if (new Set(active).size !== active.length) unavailable();
    const admittedAt = raw.admittedAt.map(value => {
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || now !== undefined && value > now) unavailable();
        return value;
    });
    if (admittedAt.some((value, index) => index > 0 && value < admittedAt[index - 1])) unavailable();
    // Recompute the review set from bounded order reads; never trust it to release a quota.
    return { active, admittedAt: now === undefined ? admittedAt : admittedAt.filter(at => at > now - HOUR_MS), reviewOrderIds: [] };
}
function claimKeys(value: unknown) {
    const raw = object(value);
    if (raw.version !== 1 || typeof raw.uidKey !== 'string' || !DIGEST.test(raw.uidKey) ||
        typeof raw.ipKey !== 'string' || !DIGEST.test(raw.ipKey) || typeof raw.released !== 'boolean') unavailable();
    return { uidKey: raw.uidKey, ipKey: raw.ipKey, released: raw.released };
}

/** Read phase only. Caller must finish every other transaction read before writeAdmission. */
export async function readAdmission(
    tx: Transaction, db: Firestore, uid: string, context: AdmissionContext, id: string, now: number,
): Promise<AdmissionPlan> {
    clock(now); orderId(id);
    if (!DIGEST.test(context.ipKey)) unavailable();
    const user = uidKey(uid);
    const claimRef = db.collection('webAdmissionClaims').doc(id);
    const userRef = db.collection('webAdmissionBuckets').doc(`uid_${user}`);
    const ipRef = db.collection('webAdmissionBuckets').doc(`ip_${context.ipKey}`);
    const [claimSnapshot, userSnapshot, ipSnapshot] = await tx.getAll(claimRef, userRef, ipRef);
    const claim = { uidKey: user, ipKey: context.ipKey, released: false as const, createdAt: now };
    const userBucket = readBucket(userSnapshot.data(), userSnapshot.exists, ADMISSION_LIMITS.uidActive, ADMISSION_LIMITS.uidPerHour, now);
    const ipBucket = readBucket(ipSnapshot.data(), ipSnapshot.exists, ADMISSION_LIMITS.ipActive, ADMISSION_LIMITS.ipPerHour, now);
    if (claimSnapshot.exists) {
        const existing = claimKeys(claimSnapshot.data());
        if (existing.uidKey !== user || existing.ipKey !== context.ipKey || existing.released ||
            !userBucket.active.includes(id) || !ipBucket.active.includes(id)) unavailable();
        return { claimRef, claim, buckets: [], reused: true };
    }
    if (userBucket.active.includes(id) || ipBucket.active.includes(id)) unavailable();
    const activeIds = [...new Set([...userBucket.active, ...ipBucket.active])];
    const orders = activeIds.length ? await tx.getAll(...activeIds.map(active => db.collection('orders').doc(active))) : [];
    const closed = new Set<string>();
    const review = new Set<string>();
    for (const snapshot of orders) {
        const data: unknown = snapshot.data();
        if (!data || typeof data !== 'object' || Array.isArray(data)) { review.add(snapshot.id); continue; }
        const candidate = object(data);
        const inventory = candidate.inventory;
        if (candidate.commerceVersion !== 2 || !inventory || typeof inventory !== 'object' || Array.isArray(inventory)) {
            review.add(snapshot.id); continue;
        }
        const state = object(inventory).state;
        if (state === 'committed' || state === 'released') closed.add(snapshot.id);
        else if (state !== 'reserved') review.add(snapshot.id);
    }
    for (const bucket of [userBucket, ipBucket]) {
        bucket.active = bucket.active.filter(active => !closed.has(active));
        bucket.reviewOrderIds = bucket.active.filter(active => review.has(active));
    }
    if (userBucket.active.length >= ADMISSION_LIMITS.uidActive || ipBucket.active.length >= ADMISSION_LIMITS.ipActive) {
        const needsReview = userBucket.reviewOrderIds.length > 0 || ipBucket.reviewOrderIds.length > 0;
        throw new CheckoutError(429, needsReview ? 'ADMISSION_REVIEW_REQUIRED' : 'ADMISSION_ACTIVE_LIMIT',
            needsReview ? 'Hay compras que requieren revisión. Revisá tus compras antes de iniciar otra.' : 'Hay compras pendientes. Revisalas antes de iniciar otra.');
    }
    if (userBucket.admittedAt.length >= ADMISSION_LIMITS.uidPerHour || ipBucket.admittedAt.length >= ADMISSION_LIMITS.ipPerHour) {
        throw new CheckoutError(429, 'ADMISSION_RATE_LIMIT', 'Iniciaste varias compras recientemente. Esperá antes de iniciar otra.');
    }
    for (const bucket of [userBucket, ipBucket]) { bucket.active.push(id); bucket.admittedAt.push(now); }
    return { claimRef, claim, buckets: [{ ref: userRef, data: userBucket }, { ref: ipRef, data: ipBucket }], reused: false };
}

/** Write phase only; stock reservation/order creation belongs in this same transaction. */
export function writeAdmission(tx: Transaction, plan: AdmissionPlan): void {
    if (plan.reused) return;
    for (const bucket of plan.buckets) tx.set(bucket.ref, { version: 1, ...bucket.data });
    tx.create(plan.claimRef, { version: 1, ...plan.claim });
}

/** Pre-quota orders have no claim. Unknown payments never call the release write. */
export async function readQuotaRelease(tx: Transaction, db: Firestore, id: string): Promise<QuotaReleasePlan> {
    orderId(id);
    const claimRef = db.collection('webAdmissionClaims').doc(id);
    const snapshot = await tx.get(claimRef);
    if (!snapshot.exists) return null;
    const keys = claimKeys(snapshot.data());
    if (keys.released) return null;
    const refs = [db.collection('webAdmissionBuckets').doc(`uid_${keys.uidKey}`), db.collection('webAdmissionBuckets').doc(`ip_${keys.ipKey}`)];
    const snapshots = await tx.getAll(...refs);
    const buckets = snapshots.map((bucket, index) => {
        if (!bucket.exists) unavailable();
        const data = readBucket(bucket.data(), true, index === 0 ? ADMISSION_LIMITS.uidActive : ADMISSION_LIMITS.ipActive,
            index === 0 ? ADMISSION_LIMITS.uidPerHour : ADMISSION_LIMITS.ipPerHour);
        data.active = data.active.filter(active => active !== id);
        return { ref: bucket.ref, data };
    });
    return { claimRef, buckets };
}

/** Call only when the matching order is atomically committed/released, after all reads. */
export function writeQuotaRelease(tx: Transaction, plan: QuotaReleasePlan): void {
    if (!plan) return;
    for (const bucket of plan.buckets) tx.set(bucket.ref, { version: 1, ...bucket.data });
    tx.update(plan.claimRef, { released: true });
}
