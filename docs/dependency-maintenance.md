# Dependency maintenance — P-DEP-1

This preparation changes dependency graphs and the compatibility boundaries below.
It does not authorize publication or close the separate stock release gates.

## Selected families

| Family | Selected version | Compatibility boundary |
| --- | --- | --- |
| Firebase Admin | 14.4.0 in both trees | Firestore/Auth handlers, stock transactions, emitted Node functions; modular imports in the TypeScript role script |
| Firebase Functions | 7.3.0 | First compatible Admin 14 peer line; retained local entrypoint and configuration |
| Express | 4.22.3 | Existing Express 4 consumers |
| Tiptap | 3.30.5 coherent cohort | Named TextStyle import, existing schema and toolbar rendering preserved |
| jsPDF | 4.2.1 | Actual order label, accented text, logo and QR |
| Swiper | 12.1.2 | Hero and retained PromoSlider interactions |
| React Router | 7.18.2 | Existing SPA routes and links |
| Vite / Vitest + UI | 6.4.3 / 4.1.11 | Existing build and test architecture |
| Happy DOM | 20.8.9 | Storage failure fixtures reset implementations before restoring spies |
| Vercel Node builder | 5.10.2 | Both emitted handlers, native startup and authentication |
| Firebase CLI | 15.31.0 | Declared emulators with Java 21 |
| PostCSS | 8.5.23 | Existing CSS build |

React 18.3.1, React DOM 18.3.1, Tailwind 3.4.17, Firebase browser SDK
11.6.1, TypeScript 5.7.3 and Playwright 1.56.1 remain unchanged.
The locks are npm-generated; installation must use `npm ci` without force or
legacy peer resolution.

Unused declarations removed after checking source, scripts, tests and configuration:
Next, Cloudinary Node SDK, ImageKit Node SDK, React Quill/Quill, Mercado Pago SDK,
and the unused `functions/` test package. Existing image URLs and native HTTP
payment adapters remain unchanged.

## Scoped overrides

| Consumer chain | Pin | Reason and exercised boundary |
| --- | --- | --- |
| `@vercel/node → undici` | 6.28.1 | Corrected npm HTTP implementation; buffer/stream paths exercised in historical P-DEP-1 evidence. Dev-server use is now prohibited by the Edge exception controls below. |
| `@vercel/node → path-to-regexp` | 6.3.0 | Same-major corrected route parser |
| `@vercel/node` and `vite → tsx` | 4.22.0 | Corrected esbuild chain; actual tsx runner |
| `@vercel/static-config → ajv` | 8.20.0 | Corrected URI chain; actual static configuration parser |
| `gaxios → uuid` | 11.1.1 | Retains the consumed v4 CommonJS API; multipart HTTP in both trees |
| `@tiptap/react → bubble/floating-menu` | 3.30.5 | Keeps optional peer extensions in the exact editor cohort |
| `vitest → vite` | `$vite` | Supported Vite 6 peer; avoids installing another build stack |
| `@firebase/firestore → @grpc/grpc-js` | 1.13.6 | Corrected gRPC 1.x, exercised through actual emulators |
| `get-uri → basic-ftp` | 6.2.1 | Corrected FTP client; actual local FTP transfer/cache/error paths |
| `@google-cloud/pubsub → @opentelemetry/core` | 2.8.0 | Actual W3C propagation consumer retains its API |
| `micromatch`, `anymatch`, `readdirp → picomatch` | 2.3.2 | Compatible correction; actual matcher and file discovery consumers |

These pins must be reconsidered with their parent upgrades. They are not generic
allowlists or permission to ignore peer failures.

## Gates and unresolved boundaries

CI blocks on `npm audit --omit=dev --audit-level=moderate` and
`npm audit --audit-level=high`, in both the root and `functions/` trees.
The thresholds do not accept lesser findings. Keep the full reports and assess
embedded dependencies independently of npm's package inventory.

`@edge-runtime/primitives@4.1.0`, retained inside the builder tooling, embeds
Undici 5.23.0. npm overrides do not rewrite that bundle. **These bytes remain
unpatched.** On 2026-10-01 the owner accepted their installed presence only,
subject to the [controlled tooling exception](edge-tooling-exception.md).
Its single identity manifest, required build/load/emission gates and review
triggers apply to this exact tooling graph. Prior dated `OPEN_NO_WAIVER`
reports remain historical evidence and are not rewritten by this decision.
Passing CI does not declare P-DEP-1 closed or authorize publication.

Native Node fetch is separate from npm Undici. Local final runtime tests and the
frontend CI pin use Node 22.23.3 with built-in Undici 6.28.1. Before any later publication, verify the
actual remote Node patch and advisories; a project setting of `22.x` alone does
not attest the patch. No production probe or runtime configuration is applied here.

The synthetic PDF regression supplies a local logo because this source tree lacks
`public/logo-etiqueta.png`; it also verifies a failed logo load remains visible.
It does not certify the production asset. With the same synthetic content and logo,
jsPDF 3.0.1 and 4.2.1 render pixel-identical labels, including pre-existing overlap
of long field names. The historical generated CommonJS
`scripts/setAdminRole.js` is not a configured entrypoint and remains unchanged;
the compatibility regression explicitly imports the TypeScript operation.

Browser regressions retain every diagnostic. A WebKit network message is classified
as document-unload cancellation only for the local demo Firestore stream when the
same session first returned HTTP 200 with the expected CORS headers, then failed
with exactly `cancelled` (macOS) or `Load request cancelled` (Linux CI) beside an
actual `pagehide`. Both native labels were observed with the full correlation;
similar strings remain failures. The macOS behavior also reproduces with the
previous emulator. Application errors, promise rejections and unmatched
page errors still fail; negative tests enforce that boundary.

Independent dependency/consumer review, stock publication configuration,
provider validation and publication authorization remain separate requirements.
