# Verified source repair release gate

This gate applies only to the two Mutter repositories in `policy.json` and the
exact audited `mutter-braces-3.0.3-depth-backport-v1`. The pinned audit report is an
identifier for the independent review received under the current execution
contract; a digest alone does not prove authorship or authorization. It is not a
waiver. `BRACES_RISK_ACCEPTANCE=NOT_GRANTED`. Edge and first-cutover residual
decisions remain separate. No parser, classification algorithm, lock or version
is changed by this gate.

`policy.json` pins the audited components read from the two base Git objects.
It must never be regenerated from installed packages. Drift blocks. Retiring the
repair for a future official compatible release requires a new scoped target and
review of this policy; another advisory cannot inherit this disposition.

## CI and external verification

Original native audit commands, thresholds, JSON, stderr and exits remain intact.
The wrapper adds a separate context binding (repository, event/ref, branch HEAD,
actual checkout/tree, run, attempt, job and workflow digest). Artifacts include
the attempt in their names. The existing source-remediation job checks completed
dependencies and publishes its disposition, not an approval of an unfinished run.
Its audited evaluator's conservative `RELEASE_ELIGIBLE=NO` remains unchanged.

After both runs finish, use exact Node 22.23.3, installed declared dependencies,
`gh` with existing read authority, Python 3 standard library and new output paths:

```sh
node scripts/release-gate/cli.cjs verify-run admin /absolute/admin RUN_ID ATTEMPT /absolute/new-admin-evidence
node scripts/release-gate/cli.cjs verify-pair /absolute/pair-config.json /absolute/new-pair-evidence
```

The config has `storeRoot`, `adminRoot` (absolute clean source directories),
`storeRun`, `adminRun`, `storeAttempt`, `adminAttempt` (positive integers).
Both source roots must be the exact branch targets under review and must have
been installed with `install:controlled` (including frontend functions). The
external command reads GitHub itself. It accepts no manual PASS receipt. The
paired frontend workflow must literally pin the verified Admin head. Admin PR
merge evidence is permitted only with API-confirmed parents and the same tree as
its branch HEAD; a frontend candidate artifact requires the branch push run.

Pagination must exhaust the API count without drift or duplicates. The exact
attempt must remain the latest completed attempt, re-read after evidence/artifact
verification; a rerun that starts meanwhile blocks the result. The exact
attempt's entire job and step inventory is checked against `jobs.json`; missing,
unfinished, skipped, cancelled or unknown functional steps fail. Only the native
audit step can fail for the exact classified graph. Conditional post-cache skips
are allowed; post-step failures still block. All other jobs must succeed. Raw
global GitHub failure is preserved. All audits are reevaluated against current
verified installed bytes, not trusted because their locks match.

Official artifact ZIP digest mismatch is fatal. Bounded extraction rejects
traversal, duplicate paths, links and special files. Downloaded code is never
executed: the trusted source verifier reads the complete prebuilt, stamp,
inventories, runtime configuration, native evidence and Edge observations. Loaded
braces module hashes must equal the audited patched bytes. The output receipt
joins all six audits, both targets/runs and the new artifact. Old diagnostic
artifacts are not relabelled or accepted by this path.

## Publication consumption, no apply command

`RELEASE_TECHNICAL_GATE_STATUS=PASS` is distinct from native audit status, global
CI status, independent wiring review and operational readiness. Run:

```sh
node scripts/release-gate/cli.cjs publication-check /absolute/publication-config.json /absolute/new-publication-evidence
```

This repeats the external pair verification, then consumes the existing
first-cutover evaluator and primary receipt checks. The publication config adds
`reviewFile`, `cutoverEvidenceFile` and `cutoverAuthorizationFile` absolute paths.
The independent review record contains `status: PASS_EXACT_TARGET`, exact
`targets: {store: {head, tree}, admin: {head, tree}}`, the relative `reportPath`,
its `reportSha256` and the exact `artifactDigest` from the technical receipt. The
report must contain the favorable independent verdict and the full pair. A
historical parser PASS cannot identify this new wiring's targets.

Cutover evidence retains every existing policy/receipt requirement, must use the
same pair, audit report hash and prebuilt tar hash, and a current evaluation time
(within 60 seconds). It additionally identifies the current cutover authorization
document with `applicationAuthorization: {status:
EXPLICIT_CURRENT_CUTOVER_AUTHORIZATION, sha256: ...}`. The supplied authorization
must identify both targets. These private documents require a trusted operator
handoff and independent provenance review; hashes and text do not authenticate
their authors. No CI result or field grants production permission.

The first-cutover `evaluate` command is wired through this publication boundary.
The output can establish evidence consistency only. It never applies anything,
attests remote enforcement, proves global drain, grants authority, or closes
runtime/cron/account/backup/operations gates. No credentials, backups or business
data belong in these CI artifacts. Missing review or operational receipts block
publication even when the technical gate passes.
