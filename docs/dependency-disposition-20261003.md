# Busboy correction and unresolved braces, 2026-10-03

This preparation does not authorize release. Native security audits retain their
original thresholds. Independent matrix jobs run every prod/all audit at root
and functions; compatibility jobs do not depend on their success. Any required
red job keeps the **global CI red**. The archived prebuilt is explicitly named
`mutter-stock-prebuilt-DIAGNOSTIC-NO-RELEASE`, never a release approval.

## Busboy

Official `@fastify/busboy@3.2.1` fixes GHSA-xjh9-v7x6-24jw and
GHSA-x8mw-p69m-v3mx. Root and functions Firebase Admin remain 14.4.0, whose
`^3.0.0` dependency range accepts the patch. The root override targets only this
package (npm rehomes the one nested copy to the root); functions uses an override
under Firebase Admin. No unrelated package version changes. The exact paired
Admin carries the same patch under Firebase Admin 13.10.0.

The paired Admin's `scripts/test-busboy.cjs` exercises all three installations:
normal form fields, size limits, Dicer normal/truncated multipart, prototype-name
headers and the 252-byte boundary, including real Firebase Admin HttpClient
responses from loopback. Every scenario executes in a separate process with a
5-second deadline and 192 MiB V8 heap bound. There are no provider requests or
business credentials. Both vulnerable releases reproduce the header failures
and bounded timeout; patched copies pass the same tests.

## Braces remains unaccepted

One installed root copy: `braces@3.0.3`. No copy in functions. There is one
remaining direct advisory, GHSA-vfj7-8cjw-p6xm, propagated by npm to 17 packages
in the full root graph and six in the production graph. These are not 17
independent advisories. `tailwindcss-animate`'s runtime declaration and Tailwind
peer make part of the tooling graph appear in prod audit; that label alone does
not establish browser exposure.

| Consumer chain | Actual use and input boundary |
| --- | --- |
| Tailwind 3.4.17 -> fast-glob 3.3.3 -> micromatch 4.0.8 -> braces | PostCSS compilation expands repository content patterns (`./index.html`, `./src/**/*.{js,ts,jsx,tsx}`), with local paths; buyer text is not supplied as a glob. |
| Tailwind / Firebase CLI 15.31.0 -> chokidar 3.6.0 -> braces | Local watcher paths and emulator rules/function directories from repository configuration. Chokidar expands brace-containing watch paths. Vite's own bundled matcher is a distinct implementation. |
| @vercel/node 5.10.2, directly or via @vercel/static-config 3.4.1 -> ts-morph 12.0.0 -> @ts-morph/common 0.11.1 -> fast-glob -> micromatch -> braces | Builder inspects local entrypoints, tsconfig and source files. No Edge or vercel-dev execution is permitted. |
| typescript-eslint / parser / utils / type-utils / typescript-estree 8.30.1 -> fast-glob -> micromatch -> braces | Lint project/configuration file patterns, not business HTTP payloads. The declared ESLint configuration does not request an attacker-controlled project glob. |

`braces.compile`, `micromatch.braces` and `fast-glob.sync` all reproduce a
RangeError for a synthetic 8,001-character pattern nested 4,000 levels, below
the library's 10,000-character guard. Each reproduction is subprocess-bounded.
An ordinary file name being scanned is not automatically a pattern; the risky
boundary is an argument expanded as a glob. A malicious repository/configuration
or brace-containing supplied local watch path can reach tooling. This delivery
found no buyer-controlled path to that parser in the SPA/Node business handlers;
this is a bounded consumer assessment, not a universal non-exploitability proof.

Registry checks find braces latest 3.0.3 with no official patch. Latest compatible
Tailwind 3.4.19 still uses chokidar/fast-glob/micromatch, chokidar 3.6.0 still uses
braces, and latest micromatch 4.0.8 / fast-glob 3.3.3 retain the chain. Current
static-config also retains ts-morph 12. A Tailwind major or builder replacement
would exceed this correction. None was performed.

The observed Vite build loads braces through Tailwind. Its emitted SPA module
graph has 887 modules and no braces/micromatch/fast-glob/chokidar provenance.
Written checkout/reconciliation inventories contain 1,375/1,163 files and no
package scope or file from those four libraries. Checkout includes patched
Busboy 3.2.1. Separate native builder traces cover all 12 Admin entries (12,620
file occurrences), also without those library paths. Full graphs, package scopes
and written-byte hashes are retained in the executor package and checked again
on the final prebuilt. These are bounded output observations, not proof for
arbitrary transformations or future artifacts. Searching for a minified name
alone is not an absence proof. No new observation system, allowlist, patch or
exception was introduced for braces.

Recommended disposition: keep publication blocked pending an official bounded
braces correction and repeat parsing/consumer/output checks. If the owner wishes
to consider a tooling-only residual instead, submit the exact consumer and
emission evidence to independent review and obtain a separate, explicit decision;
the executor grants none and the audit remains red. Do not repurpose the Edge
exception or the first-cutover late-write acceptance to cover braces.

## Edge identity

All seven protected package copies, dependency/optional-peer links, full package
file trees and protected embedded payload hashes were compared unchanged before
updating only the two global lock SHA256 references in `exception.json`. The
control code, builder and accepted bytes are unchanged. The new lock identity
requires independent revalidation; earlier PASS is not transferred automatically.

Sources: [Busboy boundary](https://github.com/fastify/busboy/security/advisories/GHSA-xjh9-v7x6-24jw),
[Busboy headers](https://github.com/fastify/busboy/security/advisories/GHSA-x8mw-p69m-v3mx),
[braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm),
[upstream report](https://github.com/micromatch/braces/issues/70).
