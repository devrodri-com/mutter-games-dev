# Controlled Edge tooling exception

Decision dated 2026-10-01, authorized by Rodrigo for Mutter preparation only.
Stable identifier: `R1-PDEP1-EDGE-UNDICI`.

`EDGE_RISK_ACCEPTANCE=OWNER_ACCEPTED_TOOLING_ONLY_WITH_CONDITIONS`

`EDGE_EMBEDDED_BYTES_PATCHED=NO`

`INDEPENDENT_CONTROL_AUDIT=PENDING`

The owner accepts the installed presence of the identified embedded Undici
bytes in the official builder's tooling. Their execution and emission remain
prohibited. This preserves the official constructor without a fork, hidden
installation patch, package deletion or additional dependency update.

The machine-readable [exception manifest](../scripts/edge-tooling/exception.json)
is the single source of accepted package locations, versions, lock provenance,
package metadata hashes, relevant file hashes and the dependency/optional-peer
chain. In particular it binds `@vercel/node@5.10.2`,
`@edge-runtime/primitives@4.1.0` and its 601884-byte `dist/fetch.js.text.js`
containing Undici 5.23.0. Do not copy or refresh its identity list to make a
changed installation pass.

The manifest preserves the independent review's dated list of 19 matching GHSA
and their preconditions. It is neither a permanent exhaustive count nor an
advisory allowlist. Version matching alone does not prove an exploit; lack of
observed exposure does not repair the bytes. npm Undici, Node's native fetch,
other projects/versions and an unknown remote runtime are outside this decision.

## Required execution

Use Node 22.23.3, clean `npm ci` installations at root and `functions/`, and the
exact Admin checkout pinned by CI. Keep commercial credentials absent, demo
Auth/Firestore and synthetic MP. Local development retains Vite and Node
functions. Do not use `vercel dev`, `startDevServer`, Edge VM or the Edge CLI.

Required commands, also wired into the existing CI workflow:

1. `npm run check:edge-tooling`: both lock identities; all installed package
   metadata under both installations, including aliases/nested copies; accepted
   file bytes; static operational source, scripts, configuration and workflows.
2. `npm run test:edge-tooling`: disposable positive and negative fixtures for
   installation, operational consumers, observation and final emission.
3. `npm run build`: the actual TypeScript compiler and production Vite build
   execute in fresh observed processes. Vite uses its real configuration plus a
   passive module-graph collector. Inspect every final disk file after all build
   hooks, binding chunks to module provenance and written bytes.
4. `npm run check:checkout-packaging`: observe the actual official `build()`
   and materialization for both functions; inspect both complete output graphs,
   package scopes, hashes and written files; then retain the separate native
   Node cold-start/invocation gate and OS network canaries without loader mocks.
5. Keep the four existing npm audits, API types, commercial emulator suite and
   browser regressions, including WebKit. No threshold or assertion is waived.

Set `EDGE_TOOLING_EVIDENCE_DIR` to a fresh directory outside the checkout to
retain SPA and packaging receipts. Set `CHECKOUT_PACKAGING_EVIDENCE_DIR` to a
fresh child directory there to retain the actual function materializations and
native canaries. Do not reuse phase directories. CI uploads this evidence even
after a failed step; an upload is not a passing gate. Without these variables,
temporary evidence is removed after the command and the receipt is printed.

## What is measured

Installed presence is distinguished from loading and emission. All accepted
installed copies must match the manifest. Unknown copies, changed metadata,
bytes, locks or chain fail the control. The static check reads executable tests
and guard code as well as application entrypoints; documentation mentions and
fixture strings are not operational imports.

The explicit build instrumentation installs synchronous Node resolution/load
hooks before the real entrypoint. Forbidden paths, canonical symlink targets
and identified payload bytes are rejected before evaluation; no replacement
exports are supplied. Violations remain failures even if a consumer catches
the exception. Actual module events retain resolution parents and byte hashes.

Node child processes and workers, including workers with empty `execArgv`, get
their own preload handshake and journals. Missing handshakes/journals, unknown
native processes, shell children, detached children or additional loaders are
`NOT_VERIFIED`. The installed native esbuild Go service is separately recorded
by executable/package/hash/arguments; Node hooks do not inspect its internals.
Unreferenced workers are bounded by their observed parent lifetime; the journal
records whether an exit was observed. This instrumentation is a bounded build
control, not a security sandbox against deliberate tampering with the observer.

Emission inspection combines package/module provenance with all written file
hashes and fingerprints derived from the accepted payload without evaluating
it. It rejects the full or decoded payload under renamed paths and distributed
byte fragments. Real module graphs cover the authorized transformation and
minification; fingerprints do not promise universal detection of arbitrary
obfuscation. Missing graphs, output files or inspection evidence cannot pass.
The corrected npm Undici remains a separate package and is not mistaken for
the incorporated version merely because it shares a name.

The observed builder phase ends before native handler invocations. Those retain
the existing fresh Node processes, restricted environment, OS network denial
and effective canaries, without internal API replacements or loading from the
source dependency tree. Commercial quantities and stock logic are unchanged.

## Suspension and future delivery

Any changed bytes, versions, dependency/optional-peer chain, new consumer,
Edge/dev-server use, observed forbidden load/emission, missing inspection or
new evidence materially affecting risk suspends control validity pending review.
Never automatically broaden the manifest or treat a new advisory as accepted.
Revisit at maintenance/publication time; this adds no scheduled task.

Re-run the controls on the exact delivery pair and artifacts, following the
[release runbook](operations/WEB_STOCK_RELEASE_RUNBOOK.md). CI's pinned Node
patch does not attest a Vercel project's `22.x` runtime or a platform rebuild.
Any remotely rebuilt output needs equivalent identity, load and final-output
evidence before a separately authorized publication can be accepted. No remote
build, deployment, cron activation or production observation is performed here.

A passing executor run supports
`P_DEP_1=CONDITIONAL_EXCEPTION_CONTROLS_PENDING_INDEPENDENT_AUDIT`;
it does not close the finding as repaired. Independent focused verification is
still required in another superior session.
`STOCK_RELEASE_READY=NO_PENDING_SEPARATE_GATES`: runtime/provider verification,
remote configuration, publication authority and stock acceptance remain
separate from this limited exception and from a green CI badge.
