# Catalog R1 — local execution handoff

This change is an executor target for an independent top-level audit. It is **not approved for release**. No push, PR, merge, deployment or production data mutation was performed by this execution.

## Behavior and boundaries

- `api/create-mp-preference.ts` is the single checkout authority. Firebase authentication (including anonymous users), strict current publication, product/variant quantities, prices and delivery are validated on the server. The browser submits identifiers, quantities and contact/delivery selection only.
- A quote must be reviewed before start. The start transaction rechecks the catalog and quote, then creates a durable UID/content-bound intent and pending order. Provider calls run outside retryable transactions. Repeating a successful intent returns its stored preference. A concurrent or uncertain attempt stays locked; it never creates a second preference blindly.
- Public readers require `active === true`. Detail updates from server snapshots, search reloads when focused, and add/restore/checkout reread product documents. Administrative lists retain inactive products.
- Cart persistence is UID-scoped, writes explicit empty arrays, waits for remote writes and preserves a dirty marker on failure. Revision checks and a serialized write queue prevent late restoration/add responses from undoing a clear. Removal/update identifies the full selected line, including customization. The same synchronization runs on iOS.
- The editor delegates one changed-field PATCH to its parent. Publication is a separate intent. The API compares Firestore updateTime inside a transaction; legacy payloads receive 428 and stale edits 409. Unknown stored fields and unedited image/variant arrays remain intact.
- New order records preserve the price/title/contact fields consumed by current admin readers. Creation never marks payment paid.

## Reproduction

Use existing lockfile dependencies and Java. No production environment file is required. Do not load productive credentials. All fixture projects start with `demo-`; local emulator ports are 8188/9198. Tests overwrite only their own synthetic namespaces.

```
npm run build
npm run typecheck:api
JAVA_TOOL_OPTIONS='-Duser.language=en -Duser.country=US' npm run test:catalog
npm run check:checkout-packaging
JAVA_TOOL_OPTIONS='-Duser.language=en -Duser.country=US' npm run test:catalog:browser
CATALOG_WEBKIT=1 JAVA_TOOL_OPTIONS='-Duser.language=en -Duser.country=US' npm run test:catalog:browser
```

Browser tooling must already exist. Local WebKit is optional additional engine coverage, not a physical iPhone test. CI uses the runner's existing Chrome without installing a browser. See the [runner software inventory](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md). Browser scripts block every non-loopback request. Do not open the production SPA for a smoke: its existing bootstrap creates anonymous users.

The packaging check invokes the installed Vercel Node builder with `isDev` to skip dependency installation. It checks traced checkout modules and the one-function topology in the actual `vercel.json`; it does not claim a Vercel deployment or production-runtime smoke.

Regression coverage includes real Firestore transactions, handler authentication boundary checks, public-reader publication matrices, provider contract/timeout behavior, real React cart/checkout/editor flows and desktop/mobile navigation. Mocks are confined to external HTTP/SDK boundaries. Four historical Rules tests remain skipped without changes to their assertions. Effective deployed Rules are checked separately with `scripts/verify-effective-order-rules.mjs` using a private input; that script deliberately reproduces the unresolved direct-order bypass in an emulator.

## Release blockers and compatibility

Preview/Development currently share productive Firebase credentials. Keep this branch local until isolation is proven; do not change settings or deploy to bypass this gate. Effective deployed Firestore Rules still allow customers to create orders directly with invented contents/totals. That route cannot be closed by these two code changes; a separately scoped Rules repair coordinated by the Cerebro is required.

| Frontend deployment | Admin API | Outcome |
| --- | --- | --- |
| Old | Old | Both old purchase writers remain unsafe. |
| Old | New | Old API orders stop, but old MP function remains reachable and unsafe. Old admin saves are rejected. |
| New | Old | New MP function is guarded, but old API orders remains a bypass. New admin cannot save without a version. |
| New | New | New checkout and PATCH contracts work; old browser payloads receive an update-required error. Effective Rules still need repair. |

Changing aliases does not prove historical deployment URLs or old cached browser bundles are closed. Verify their protection as part of release coordination. There is no proven atomic release across both projects. The Cerebro must coordinate the minimum temporary purchase closure or separately reviewed compatibility bridge needed to close **all** old server writers first. This execution did not authorize or impose a commercial pause.

Before release: resolve effective Rules and Preview isolation; satisfy native CI (including the API dependency-audit gates); complete provider verification in an already authorized isolated test mode; settle the recovery metadata limitation; obtain independent audit on the exact two commits; then recheck targets and deploy under the already recorded authorization. The API CI harness pins this frontend commit; it becomes available remotely only after safe publication of the frontend branch.

## Payment and recovery limits

[Mercado Pago's Preferences API](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-preferences/overview) supplies creation and lookup by external reference. This implementation does not assume an idempotency header for preference creation. After an uncertain external result, preserve the intent and use the exact external reference for verified recovery; no automatic second POST is allowed. Only synthetic provider-boundary tests were performed. No live MP preference/payment was created and no sandbox account/mode was established.

Stock admission is not reservation and does not prevent overselling across different buyers. Existing preferences are not revoked by deactivation. Payment confirmation, stock reservation/deduction, existing admin payment displays and automated reconciliation remain MG-PAY-01, outside this repair. An attempt without a valid start response prevents blindly starting a different purchase; verification is required before replacing an uncertain attempt.

### R1C — persisted client attempt lifecycle (AUD-R1-01)

The UID-scoped `mutter-checkout:<uid>` record keeps the original `key`, complete serialized `content` and `quoteHash`. Before sending a new start it is persisted without a receipt. Only after the existing HTTP client validates a start response, including a nonempty order identity and the allowed MP destination, the hook persists `receivedOrderId` before navigation. This records receipt of checkout initiation, **never payment approval**; no order/payment state is updated by this marker.

Equivalent content and quote hash reuse the same key, even after a received response or remount. A changed content or quote hash may obtain a new key only after the prior record has a received order identity and the existing quote/review step has completed. This permits A→B→C without the permanent R1/R1B repeat-purchase lockout. Delivery/contact/customization remain part of the existing complete content comparison. Deliberately buying identical content at the identical quote again is still interpreted as retrying that attempt, not a separate new purchase; resolving that distinction or payment completion is outside R1C.

Lost transport responses, invalid responses and `RECOVERY_REQUIRED` preserve the uncertain key. A different purchase cannot evade that uncertainty. Legacy records without a receipt are not automatically upgraded to success; retrying the matching request may recover the stored server result. Known definitive pre-admission rejections retain their existing specific cleanup/review behavior. There is no timer, mount/success-page cleanup, indiscriminate deletion or blind retry.

If the initial key cannot be persisted, start is not sent. If receipt persistence fails without an earlier durable receipt, navigation is stopped and the pre-request record remains uncertain; matching retry retains its key. Once receipt is durable, a later navigation/last-order-cache failure or lost equivalent retry remains a visible error without relabeling that known start as uncertain. Read/cleanup failures stay visible and do not free the key. A response received for an owner who has since changed is recorded under that original UID and cannot redirect or mark the next user's attempt. Reviews and the visible recovery indicator are UID scoped. The existing single-hook busy guard prevents concurrent double-click starts; server idempotency remains the authority for repeated requests.

R1C regression tests use the real hook, CartProvider, HTTP client validation and localStorage, replacing only HTTP/SDK/navigation boundaries. The A→B→C test fails on unchanged R1B because B emits no second start, then passes on R1C. Existing checkout-ui assertions remain unchanged. This local correction creates new audit targets; it does not inherit the prior audit verdict or authorize any remote action. `RELEASE_STATUS=BLOCKED`, `PROTECTION_COMPLETE=false` remain.

Recovery data and originals live outside both public repositories. The private manifest distinguishes complete restored fields/bytes from 126 references whose original bytes are recoverable but whose ImageKit library metadata/fileId is unavailable. This is not PITR, an atomic snapshot, an ImageKit account namespace restoration or proof of physical inventory. Original delivery uses [ImageKit's documented original-file mode](https://imagekit.io/docs/core-delivery-features#deliver-original-file-as-is---orig-true).

## Code rollback

Do not automatically roll back to either old deployment: doing so reopens an unsafe writer. Preserve evidence and coordinate a safe purchase closure before any code rollback. Rollback changes code/aliases only; it must never restore, delete or migrate production catalog/order data. Any remediation or different release target requires new immutable commits and a new audit target.
