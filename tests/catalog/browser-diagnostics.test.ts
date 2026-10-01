// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isDocumentUnloadDiagnostic, type Diagnostic } from '../e2e/browser-diagnostics';

const channel = 'http://127.0.0.1:8188/google.firestore.v1.Firestore/Listen/channel?database=projects%2Fdemo-mutter-r1%2Fdatabases%2F(default)&SID=synthetic-session';
const diagnostic: Diagnostic = { at: 1000, kind: 'pageerror', message: `${channel.replace('http:/', '')} due to access control checks.` };
const evidence: Diagnostic[] = [
  { at: 100, kind: 'listen-response', url: channel, status: 200, headers: { 'access-control-allow-origin': 'http://127.0.0.1:5277', 'access-control-allow-credentials': 'true' } },
  { at: 999, kind: 'request-failed', url: channel, message: 'cancelled' },
  { at: 1004, kind: 'pagehide', url: 'http://127.0.0.1:5277/shop' },
];

describe('strict local WebKit document-unload diagnostic classification', () => {
  it('requires a previously successful stream, matching cancellation and actual unload', () => {
    expect(isDocumentUnloadDiagnostic(diagnostic, evidence, 'webkit')).toBe(true);
    for (const missing of ['listen-response', 'request-failed', 'pagehide']) {
      expect(isDocumentUnloadDiagnostic(diagnostic, evidence.filter(event => event.kind !== missing), 'webkit')).toBe(false);
    }
  });
  it('does not classify failed responses, broken CORS or unrelated sessions', () => {
    expect(isDocumentUnloadDiagnostic(diagnostic, evidence.map(event => event.kind === 'listen-response' ? { ...event, status: 500 } : event), 'webkit')).toBe(false);
    expect(isDocumentUnloadDiagnostic(diagnostic, evidence.map(event => event.kind === 'listen-response' ? { ...event, headers: {} } : event), 'webkit')).toBe(false);
    expect(isDocumentUnloadDiagnostic(diagnostic, evidence.map(event => event.kind === 'request-failed' ? { ...event, url: `${channel}-other` } : event), 'webkit')).toBe(false);
  });
  it('does not classify live connection failures or distant navigation', () => {
    expect(isDocumentUnloadDiagnostic(diagnostic, evidence.map(event => event.kind === 'request-failed' ? { ...event, message: 'network connection lost' } : event), 'webkit')).toBe(false);
    expect(isDocumentUnloadDiagnostic(diagnostic, evidence.map(event => event.kind === 'pagehide' ? { ...event, at: 9000 } : event), 'webkit')).toBe(false);
  });
  it('does not classify JavaScript errors, external channels or a different browser', () => {
    expect(isDocumentUnloadDiagnostic({ ...diagnostic, message: 'TypeError: broken application' }, evidence, 'webkit')).toBe(false);
    expect(isDocumentUnloadDiagnostic({ ...diagnostic, message: diagnostic.message?.replace('127.0.0.1:8188', 'firestore.googleapis.com') }, evidence, 'webkit')).toBe(false);
    expect(isDocumentUnloadDiagnostic(diagnostic, evidence, 'chromium')).toBe(false);
  });
});
