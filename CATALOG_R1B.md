# Catalog R1B — local candidate, NOT DEPLOYED

R1 remains an immutable ancestor. This continuation prepares a separate top-level audit; it does not authorize or perform push, PR, merge, deployment, effective permission changes or purchase interruption. The paired API must pin this final frontend commit in CI.

## Candidate Rules and evidence

`firebase.catalog-r1b.rules` derives byte-for-byte from the effective source fixture `tests/rules/fixtures/effective-r1.rules`, except for denying client order creation/deletion and explicitly denying the actual `checkoutIntents` path. Order updates were already denied. All browser identities, including admins, lose order writes; server Admin SDK handlers retain their authority. The observed OrderAdmin status/delete actions only alter UI state and already do not persist, so no discovered legitimate persisted admin action is removed. Restoring a future administrative commercial writer needs a separately designed server operation.

The effective source SHA256 is `3dde75a5e9390b811488bac99fc725222602aae9615b4e22008a83af9031705e`, re-read through the Rules API with HTTP 200 during R1B. The candidate deliberately preserves the effective administrator test (email exists in adminUsers), public catalog reads, UID cart ownership, client profiles, and default nested-path denial. It does not import the different claims/UID/superadmin permissions in versioned `firebase.rules`. No role migration is part of this candidate. Public Firestore reads still include inactive products, as before; the R1 application publication filter is not a confidentiality rule.

`firebase.json` and `.firebaserc` remain unchanged and **do not select this candidate for production**. The discovered default/dev alias points to mutter-games-dev, while the effective production project is mutter-games. The new root `firebase.catalog-emulators.json` selects the candidate only for local emulator runs. Keeping it at the project root makes resolution work from either repo; a missing Rules file must never silently count as a valid test. The API regression additionally proves authenticated direct product writes are denied before exercising the real administrator PATCH.

For a future authorized Rules application, prepare a dedicated temporary config selecting ONLY `firebase.catalog-r1b.rules`; explicitly select project `mutter-games`, database `(default)`, compare the current effective hash, review the effective-to-candidate diff, then read back the deployed source hash and run the permission probes in an authorized isolated environment. Do not deploy `firebase.rules` or rely on the default alias. No deployment command was executed here.

Reader fixtures now seed through a privileged emulator test context; the actual public readers still execute as unauthenticated client SDKs under the candidate. No reader assertion was weakened.

Tests reproduce forged paid orders under the previous effective policy; reject create/replace/update/delete of price, quantities, owner, payment state and preference/intent identities under the candidate; cover nested paths and foreign reads; preserve own/admin order queries, anonymous and registered carts, profile edits and public/admin catalog access. A real Auth + checkout handler + Firestore test creates one canonical UYU order/intention and retries idempotently, mocking only the MP HTTP boundary. Four older skipped tests remain historical, not acceptance evidence: all four corresponding behaviors are exercised against this candidate by `catalog-r1b.test.ts`.

## Reproduction

Use Node 22, existing installed emulator/browser tooling, no productive environment files. The executor's final runs used a clean HOME and OS restriction of outbound network to loopback. The only MP HTTP response in functional tests is synthetic. CI uses Node 22 and its existing Chrome; local optional WebKit does not inherit Chrome's channel.

- `npm run build`
- `npm run typecheck:api`
- `JAVA_TOOL_OPTIONS='-Duser.language=en -Duser.country=US' npm run test:catalog`
- `npm run check:checkout-packaging`
- `CATALOG_WEBKIT=1 JAVA_TOOL_OPTIONS='-Duser.language=en -Duser.country=US' npm run test:catalog:browser`

Browser output is written under the new R1B evidence directory, preserving R1's recorded browser evidence. No product behavior, stock or payment lifecycle was redesigned in R1B.

## Publication and release proposals — NOT APPLIED

The detailed redacted current configuration and ordered environment/transition proposal are in the local R1B execution evidence, outside the public repositories. Four projects are linked to these two repos, not just the two production aliases. One development frontend has server project mutter-games-dev but browser Firebase mutter-games; it is not isolated. Both API projects share production Firebase and ImageKit. The main frontend also has MP credentials shared across targets. Neither environment names nor CORS provide isolation.

Recommended first publication route: after the material configuration decision, temporarily disconnect Git in Settings > Git for all four identified projects; read back absence of links and confirm production deployment IDs/aliases unchanged. Then publish branches/PRs for GitHub CI only. No Preview, manual deployment, deploy hook or old Preview visit is an isolation test. Reconnect only after an audited gate prevents unsafe automatic deployments. A repository `git.deploymentEnabled` proposal is a possible later branch policy, not a setting applied by this commit. Remote CI remains unexecuted.

A safe cross-project release needs a separately approved bounded purchase closure or a separately implemented/audited compatibility bridge. A pause must close old MP and orders handlers at the server/edge on all relevant hosts, plus apply the candidate Rules; UI flags cannot close old bundles or direct Firestore writes. Existing payment preferences are not canceled by that pause. Reopen only the new validated MP handler on verified canonical production hosts after both code targets, effective Rules, historical-host controls and all remaining release gates are verified. Keep old orders endpoints and old deployment hosts closed. Never automatically roll back to either unsafe R1 production base.

## Residuals and ownership

The installed MP credential was read back as a normal MLU account, without a test-user identity; its VITE duplicate is the same credential. No preference was created. An existing isolated test seller/application credential and verified UYU mode are required before provider integration can be called complete. Do not put any credential in this repository or chat. A VITE-prefixed token's presence alone does not establish that this bundle exposes it: source consumers were inspected; rotation remains outside this task.

All 126 recovery gaps decode as images and their exact catalog paths can be served from verified local original bytes. Bounded library searches still return no matches; CDN delivery is not proof of current library ownership/history or restorable namespace/ACL. The immutable manifest stays `protectionComplete=false`. The Cerebro must resolve the provider recovery limitation or explicitly assess an alternative recovery destination and URL migration; no alternative was accepted or applied here.

R1's stock-admission limits remain: no reservation, stock deduction, webhook, cancellation, payment reconciliation or automatic retry after uncertain provider outcome. The executor review is not the independent audit.
