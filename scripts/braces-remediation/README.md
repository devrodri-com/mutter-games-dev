# Braces 3.0.3 source remediation — preparation only

`mutter-braces-3.0.3-depth-backport-v1` repairs GHSA-vfj7-8cjw-p6xm / CVE-2026-93687 in the installed source. It is **not** an official release, a renamed package, or risk acceptance. Package name/version stay `braces@3.0.3`. Native audits remain required and their original failures remain failures. Independent remediation review is pending; release is not eligible.

## Origin and delta

Published npm integrity and every original/resulting file hash are in `manifest.json`; the exact line edits are `patch.json` (itself hashed). Source: [published commit 74b2db2938fad48a2ea54a9c8bf27a37a62c350d](https://github.com/micromatch/braces/tree/74b2db2938fad48a2ea54a9c8bf27a37a62c350d). Proposal inspected: [PR72](https://github.com/micromatch/braces/pull/72), contributor FSDevelop/braces, full head `28d440b5dd449dbf1fe6f3506cf94ecca4d02660`, unmerged. Only its five `lib/` changes were backported with zero fuzz to the npm source; master parser changes, documentation and test-framework changes were not imported. MIT license is preserved here and in the dependency. No upstream publication or comment was made by this task.

The hard maximum is 100 nested brace/parenthesis containers. This leaves substantial room above the repository's shallow content/watch globs while bounding recursive walkers safely on the tested Node 22.23.3. Finite lower values, including fractions, tighten the limit; larger values are capped; invalid/nonfinite values cannot disable it. Parsing checks before creating a deeper block; compile/expand/stringify check before recursive processing, including direct ASTs. Expansion detects parent cycles. Stringify continues passing no parent, preserving published `escapeInvalid` behavior. Existing character/range limits stay unchanged. This does not promise unrestricted expansion-cardinality/AST-width protection, protection against executable getters/proxies, or resolution of other advisories.

## Reproducible installation and entrypoints

Use `npm run install:controlled` (or `node scripts/braces-remediation/install.cjs <package-root>` for functions/the historical CI harness). The order is:

1. Verify the tracked patch before invoking npm.
2. `npm ci --ignore-scripts --no-audit --no-fund` — no dependency lifecycle runs.
3. Verify the expected version/integrity and every original file; apply the exact edits once; verify the complete resulting file inventory and each real direct parent's resolution.
4. `npm rebuild --ignore-scripts=false --foreground-scripts --no-audit --no-fund` — legitimate dependency lifecycle runs only after repair.
5. Reverify the complete installed package and resolutions.

A mixed/partial patch, additional copy, altered bytes, unexpected version, missing patch, or changed patch fails closed. Reapplying an intact patch is idempotent. Functions must remain braces-free. Build/test/type/lint npm entrypoints have verification prehooks; the direct SPA and function packaging entrypoints also verify before requiring their consumers. A raw `npm ci --ignore-scripts` is **not protected** until controlled apply+verify. An arbitrary direct invocation of `node_modules` outside these supported entrypoints is not claimed protected. No runtime monkey patch or hidden loader is used.

The Admin CI's historical frontend harness remains pinned. Its installation uses this current applicator **before** its rebuild or Firebase CLI invocation. Paired frontend CI installs the exact new Admin through that Admin's controlled installer. No historical Git object is edited. The two repos intentionally carry byte-identical patch/control/manifest copies so each immutable repository can bootstrap independently; both are tested and must stay paired. Frontend additionally tests Tailwind, eslint and Firebase's actual watcher chain.

## Verification and security classification

`npm run test:braces` runs bounded original-vs-patched overflow reproduction, 12,048 differential comparisons, depth boundaries/options, internal/public AST paths/cycles, consumers, missing/altered/extra/unpatched negative builds, and negative advisory-graph evaluation. The baseline is reconstructed only in a temporary test directory and checked against all published hashes; 192 MiB heap, 512 KiB stack and 15 s bounds apply identically to both copies. The initial Linux fast-glob baseline reached ENAMETOOLONG at its default optimized stack depth; the fixed stack budget preserves the actual overflow assertion reproducibly instead of accepting that different failure. Fixtures contain historical **native** audit output only for evaluator regression; CI classification always consumes that run's fresh raw audits.

`audit.cjs` retains native JSON/stderr, exact command, real exit and lock hash. `evaluate.cjs` checks verified bytes and traverses actual installed dependency resolutions for every transitive edge to the one exact advisory. Unknown advisories, malformed reports, lock/content drift and disconnected graphs block. This evaluator never changes the native exit or grants a waiver. The separate CI source-remediation job requires the actual compatibility jobs, repeats regression checks and evaluates the current native artifacts. The global run remains red while any required native audit is red. Diagnostic prebuilt output cannot authorize release.

The delivery package also runs the **unmodified 764-test published suite** against copies whose source hashes equal the actual installed source. A private Mocha 11.7.5/bash-path 2.0.1 harness is used, separately locked and reproducible; no application dependency is added for it. No PR author's test claim is substituted for these executions.

## Retirement

When a genuine official compatible fix is available, inspect its source and advisory disposition, replace the narrow backport in a separately reviewed dependency change, rerun the same consumer/security/emission gates and remove this applicator and patch only after clean installs resolve exclusively to the verified release. No scheduled task is created. Edge acceptance, Busboy 3.2.1, commercial code and operational first-cutover gates remain separate.
