// @vitest-environment node
import { afterAll, afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { deleteApp, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import {
    ADMISSION_LIMITS, normalizeAdmissionIp, readAdmission, readQuotaRelease,
    requestAdmissionContext, writeAdmission, writeQuotaRelease, type AdmissionContext,
} from '../../api/_lib/web-admission';

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
if (!emulator || !/^127\.0\.0\.1:\d+$/.test(emulator)) throw new Error('Loopback Firestore emulator required');
const app = initializeApp({ projectId: 'demo-mutter-web-admission' }, 'web-admission-regressions');
const db = getFirestore(app);
const NOW = 1_790_000_000_000;
const HOUR = 60 * 60 * 1000;
const syntheticSecret = 'synthetic-admission-secret-not-a-production-value';
const id = () => createHash('sha256').update(randomUUID()).digest('hex');

function context(ip = '192.0.2.9') {
    return requestAdmissionContext({ 'x-vercel-forwarded-for': ip }, ['X-Vercel-Forwarded-For', ip]);
}
async function admit(uid: string, network = context(), now = NOW, orderId = id()) {
    await db.runTransaction(async tx => {
        const plan = await readAdmission(tx, db, uid, network, orderId, now);
        const existing = await tx.get(db.doc(`orders/${orderId}`));
        writeAdmission(tx, plan);
        if (!existing.exists) tx.create(existing.ref, { commerceVersion: 2, uid, inventory: { state: 'reserved', expiresAt: now + 1800000 } });
    }, { maxAttempts: 30 });
    return orderId;
}
async function close(orderId: string, state: 'committed' | 'released' = 'released') {
    await db.runTransaction(async tx => {
        const plan = await readQuotaRelease(tx, db, orderId);
        const order = await tx.get(db.doc(`orders/${orderId}`));
        if (!order.exists) throw new Error('Expected synthetic order');
        tx.update(order.ref, { 'inventory.state': state });
        writeQuotaRelease(tx, plan);
    }, { maxAttempts: 30 });
}
async function buckets() { return (await db.collection('webAdmissionBuckets').get()).docs.map(snapshot => snapshot.data()); }

beforeEach(async () => {
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('WEB_ADMISSION_HMAC_SECRET', syntheticSecret);
    vi.stubEnv('CRON_SECRET', 'different-synthetic-cron-secret');
    for (const collection of ['orders', 'webAdmissionClaims', 'webAdmissionBuckets']) {
        const snapshots = await db.collection(collection).get();
        const batch = db.batch();
        for (const snapshot of snapshots.docs) batch.delete(snapshot.ref);
        await batch.commit();
    }
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => { await db.terminate(); await deleteApp(app); });

describe('trusted platform IP boundary', () => {
    test('normalizes equivalent IPv6 and IPv4-mapped representations into one pseudonymous key', () => {
        expect(context('2001:0db8:0:0:0:0:0:1')).toEqual(context('2001:db8::1'));
        expect(context('::ffff:192.0.2.9')).toEqual(context('192.0.2.9'));
        expect(context('0:0:0:0:0:ffff:c000:209')).toEqual(context('192.0.2.9'));
        expect(normalizeAdmissionIp(' 2001:DB8::1 ')).toBe('2001:db8::1');
        expect(context().ipKey).toMatch(/^[a-f0-9]{64}$/);
        expect(context().ipKey).not.toBe(createHash('sha256').update('192.0.2.9').digest('hex'));
    });
    test.each([undefined, '', 'unknown', ['192.0.2.9'], '192.0.2.9, 192.0.2.10', '[2001:db8::1]',
        '192.0.2.9:443', 'fe80::1%en0', '192.000.002.009', '192.0.2.999'])('rejects ambiguous/missing IP %j', value => {
        expect(() => normalizeAdmissionIp(value)).toThrowError(expect.objectContaining({ code: 'ADMISSION_IP_UNAVAILABLE' }));
    });
    test('rejects duplicates rather than selecting one, and ignores arbitrary XFF', () => {
        const headers: IncomingHttpHeaders = { 'x-vercel-forwarded-for': '192.0.2.9', 'x-forwarded-for': '198.51.100.1' };
        expect(requestAdmissionContext(headers)).toEqual(context());
        expect(() => requestAdmissionContext({ 'x-forwarded-for': '192.0.2.9' })).toThrow();
        expect(() => requestAdmissionContext(headers, ['x-vercel-forwarded-for', '192.0.2.9', 'X-Vercel-Forwarded-For', '192.0.2.9'])).toThrow();
        expect(() => requestAdmissionContext({ ...headers, 'X-Vercel-Forwarded-For': '192.0.2.9' })).toThrow();
        expect(() => requestAdmissionContext(headers, ['x-forwarded-for', '192.0.2.9'])).toThrow();
        expect(() => requestAdmissionContext(headers, ['x-vercel-forwarded-for'])).toThrow();
    });
    test('requires platform provenance and a separate strong HMAC secret', () => {
        vi.stubEnv('VERCEL', ''); expect(() => context()).toThrow();
        vi.stubEnv('VERCEL', '1');
        for (const secret of ['', 'short', ` ${syntheticSecret}`, `${syntheticSecret}\n`]) {
            vi.stubEnv('WEB_ADMISSION_HMAC_SECRET', secret); expect(() => context()).toThrow();
        }
        vi.stubEnv('WEB_ADMISSION_HMAC_SECRET', syntheticSecret);
        vi.stubEnv('CRON_SECRET', syntheticSecret); expect(() => context()).toThrow();
    });
});

test('8 concurrent distinct purchases from one UID admit exactly two', async () => {
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => admit('same-user')));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(ADMISSION_LIMITS.uidActive);
    for (const result of results) if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: 'ADMISSION_ACTIVE_LIMIT' });
    expect((await db.collection('orders').get()).size).toBe(2);
    expect((await db.collection('webAdmissionClaims').get()).size).toBe(2);
}, 60000);

test('16 concurrent UIDs on one IP admit exactly ten', async () => {
    const results = await Promise.allSettled(Array.from({ length: 16 }, (_, index) => admit(`user-${index}`)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(ADMISSION_LIMITS.ipActive);
    for (const result of results) if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: 'ADMISSION_ACTIVE_LIMIT' });
    expect((await db.collection('orders').get()).size).toBe(10);
    const ip = (await db.doc(`webAdmissionBuckets/ip_${context().ipKey}`).get()).data();
    expect(ip?.active).toHaveLength(10);
    expect(ip?.admittedAt).toHaveLength(10);
}, 60000);

test('release/commit return active quota once but retain the hourly admission count', async () => {
    const first = await admit('user'); const second = await admit('user');
    await expect(admit('user')).rejects.toMatchObject({ code: 'ADMISSION_ACTIVE_LIMIT' });
    await Promise.all([close(first, 'committed'), close(first, 'committed')]);
    const third = await admit('user');
    const user = (await buckets()).find(bucket => bucket.active?.includes(second));
    expect(user?.active).not.toContain(first);
    expect(user?.active).toContain(third);
    expect(user?.admittedAt).toHaveLength(3);
    expect((await db.doc(`webAdmissionClaims/${first}`).get()).get('released')).toBe(true);
});

test('six starts per rolling hour per UID; releasing immediately does not reset the rate', async () => {
    for (let index = 0; index < 6; index++) await close(await admit('user', context(), NOW + index));
    await expect(admit('user', context(), NOW + 10)).rejects.toMatchObject({ code: 'ADMISSION_RATE_LIMIT' });
    await expect(admit('user', context(), NOW + HOUR + 6)).resolves.toMatch(/^[a-f0-9]{64}$/);
});

test('thirty starts per rolling hour per IP across UIDs', async () => {
    for (let index = 0; index < 30; index++) await close(await admit(`user-${index}`, context(), NOW + index));
    await expect(admit('another-user', context(), NOW + 31)).rejects.toMatchObject({ code: 'ADMISSION_RATE_LIMIT' });
    await expect(admit('another-user', context('198.51.100.42'), NOW + 31)).resolves.toMatch(/^[a-f0-9]{64}$/);
});

test('an uncertain reserved order remains counted after its deadline', async () => {
    await admit('user'); await admit('user');
    await expect(admit('user', context(), NOW + HOUR * 2)).rejects.toMatchObject({ code: 'ADMISSION_ACTIVE_LIMIT' });
    expect((await db.collection('webAdmissionClaims').get()).docs.every(snapshot => snapshot.get('released') === false)).toBe(true);
});

test('bounded repair removes only explicit closed orders from active buckets', async () => {
    const first = await admit('user'); const second = await admit('user');
    await db.doc(`orders/${first}`).update({ 'inventory.state': 'committed' });
    const third = await admit('user');
    for (const bucket of await buckets()) {
        expect(bucket.active).toEqual([second, third]);
        expect(bucket.admittedAt).toHaveLength(3);
    }
    await close(first, 'committed');
    for (const bucket of await buckets()) expect(bucket.active).toEqual([second, third]);
});

test('missing and malformed orders retain quota and give a review path', async () => {
    const first = await admit('user'); await admit('user');
    await db.doc(`orders/${first}`).delete();
    await expect(admit('user')).rejects.toMatchObject({ code: 'ADMISSION_REVIEW_REQUIRED' });
    await db.doc(`orders/${first}`).set({ commerceVersion: 2, inventory: { state: 'unknown' } });
    await expect(admit('user')).rejects.toMatchObject({ code: 'ADMISSION_REVIEW_REQUIRED' });
    await db.doc(`orders/${first}`).update({ 'inventory.state': 'released' });
    await expect(admit('user')).resolves.toMatch(/^[a-f0-9]{64}$/);
});

test.each([
    { active: Array.from({ length: 11 }, id), admittedAt: [] },
    { active: [], admittedAt: Array.from({ length: 31 }, () => NOW) },
    { active: ['invalid-id'], admittedAt: [] },
    { active: [], admittedAt: [NOW + 1] },
    { active: [], admittedAt: [NOW, NOW - 1] },
])('malformed or oversized persisted metadata is never ignored: %j', async patch => {
    const network = context();
    await db.doc(`webAdmissionBuckets/ip_${network.ipKey}`).set({ version: 1, ...patch });
    await expect(admit('user', network)).rejects.toMatchObject({ code: 'ADMISSION_UNAVAILABLE' });
    expect((await db.collection('orders').get()).empty).toBe(true);
});

test('rollback of admitting transaction leaves no quota and replay does not count twice', async () => {
    const orderId = id(); const network = context();
    await expect(db.runTransaction(async tx => {
        const plan = await readAdmission(tx, db, 'user', network, orderId, NOW);
        writeAdmission(tx, plan);
        throw new Error('Synthetic stock admission failed');
    })).rejects.toThrow('Synthetic stock admission failed');
    expect((await db.collection('webAdmissionClaims').get()).empty).toBe(true);
    await admit('user', network, NOW, orderId);
    await admit('user', network, NOW, orderId);
    for (const bucket of await buckets()) { expect(bucket.active).toHaveLength(1); expect(bucket.admittedAt).toHaveLength(1); }
    await expect(admit('different-user', network, NOW, orderId)).rejects.toMatchObject({ code: 'ADMISSION_UNAVAILABLE' });
});

test('private quota metadata contains no raw IP and legacy orders need no quota migration', async () => {
    const network: AdmissionContext = context();
    await admit('synthetic-user', network);
    const serialized = JSON.stringify({ buckets: await buckets(), claims: (await db.collection('webAdmissionClaims').get()).docs.map(snapshot => snapshot.data()) });
    expect(serialized).not.toContain('192.0.2.9'); expect(serialized).not.toContain('synthetic-user');
    const legacy = id();
    await db.doc(`orders/${legacy}`).set({ commerceVersion: 2, inventory: { state: 'reserved' } });
    await close(legacy);
    expect((await db.doc(`webAdmissionClaims/${legacy}`).get()).exists).toBe(false);
});
