# Operating the M3-0 validation foundation

## SVG Validation Lab

Run from the repository root:

```sh
node --experimental-strip-types tests/tools/calibration/svg-validation-lab.ts \
  --output /tmp/breaklint-m3-lab.json
```

Exit 0 means every registered lab invariant passed. Exit 1 means a rendered contract invariant
failed. Exit 3 means the apparatus failed (for example browser launch, pagination, identity or
cleanup). The JSON report is the evidence; the exit alone is not.

The lab starts the repository's intended Chrome launcher, sets print media, UTC, light colour
scheme, fixed viewport/device scale and Paged.js 0.4.3, waits for fonts, paginates, screenshots the
actual SVG and derives masks against an empty pass. Per-target masks are fed to the unchanged
production rule objects. Construction truth never uses their output.

The exact seven clipping fixtures, in contract order, are:

1. `G1_textInGruppe`
2. `G2_textInVerschachtelterGruppe`
3. `G3_zweiZieleEinesGeclippt`
4. `G4_ueberlappendeTexte`
5. `V_verduennung`
6. `N_keinClip`
7. `N_clipEnthaeltGanz`

The gate requires G1 historical shared `T = 0`; G1 target ratio `> 0.05`; V shared ratio `< 0.05`;
V clipped-target ratio `> 0.05`; exact target attribution; and zero for every constructed negative.
Collision gates cover ordinary/z-under crossings, 0.4 px hairline, pale colour, opaque-white
occlusion, clean separation, bounding-box gap and the exact S9-D corner construction. On the
reference environment the latter is missed 0 times at 4 px and hit 51 times at 0.25 px. The portable
gate is deliberately `0` versus `> 0`; `51` is recorded environment evidence, not an exact
cross-renderer pin. Viewport
gates cover outside, enlarged viewBox and `overflow: visible`.

Two additional real-renderer collision fixtures produce exactly 7 and 8 shared device pixels. They
must respectively be clean and finding, binding the inclusive boundary instead of relying on one
large positive. The lab binds current product defaults to exactly `0.05`, `8/8` and structural `0`.
Each authored clip rectangle also declares its right boundary. The lab transforms both the actual
boundary and declared authored coordinate through the real SVG CTM of the target to which the clip
is applied, then through screenshot origin
and device-scale factor, then requires agreement within ±1 device pixel. A boundary drift that
still leaves `actual < neutral` must therefore turn red. Mutations to `0.6`, `300`, a forced
`rightEdge = -1`, or the authored/constructed boundary mismatch must turn the lab red.
G2 keeps its mandatory ID, order and semantics but now uses non-identity `translate(10,0)`. The
former `translate(0,0)` was an identity operation and did not exercise transformed application;
this corrects the original fixture without inventing a replacement or changing the seven-item list.
Its target-to-SVG CTM must independently project to the authored 20-device-pixel translation at
DSF 2; both an identity-transform regression and a separate clip-width drift turn red.

Renderer results record no absolute font path: they contain family, system ID basename and SHA-256.
They also record browser executable, Paged.js and package identities, OS/runtime, page/raster settings
and resource policy. Request interception runs on every page; completion requires a measured zero
external requests. `rendererFreezeId` is the SHA-256 of the canonical renderer projection without
the ID. Source identity is a closed union: `clean-commit` is emitted only for a truly clean
worktree; otherwise `dirty-source-bundle` binds the base commit plus canonical hashes of the full
staged/unstaged diff, every tracked and untracked non-ignored file, and the bundle projection. Only
gitignored/generated outputs are excluded. Two byte changes at the same dirty path are tested to
produce different identities.

`npm test` discovers `tests/e2e/m3-validation-foundation.test.ts` and therefore executes the real
lab in the existing CI path without changing package or workflow files. The explicit process-boundary
test is:

```sh
node --test --experimental-strip-types tests/live/svg-validation-lab.test.ts
```

## Readiness validator

```sh
node --experimental-strip-types tests/tools/calibration/readiness-validator.ts \
  tests/fixtures/calibration/public-synthetic-manifest.json \
  --artifact-root tests/fixtures/calibration \
  --output /tmp/breaklint-m3-readiness.json
```

Claim-grade validation additionally supplies the separate trust, previous-freeze and acceptance
artifacts:

```sh
node --experimental-strip-types tests/tools/calibration/readiness-validator.ts MANIFEST.json \
  --artifact-root OPAQUE_CORPUS_ROOT --trust-ledger TRUST.json \
  --previous-manifest PREVIOUS_FROZEN.json --acceptance-plan PLAN.json \
  --preregistration-receipt RECEIPT.json --capture-evidence CAPTURE-EVIDENCE.json \
  --capture-attestation CAPTURE-ATTESTATION.json \
  --measurement-receipt MEASUREMENT.json \
  --production-evaluation PRODUCTION.json --outcome OUTCOME.json \
  --acceptance-report ACCEPTANCE.json --lineage-snapshot LINEAGE.json
```

Exit 0 means schema and semantic checks are valid. It does not mean a rule is ready: inspect the
separate `rules` flags. Exit 1 means invalid corpus/contract data. Exit 2 means usage or unreadable
input. The report always distinguishes `schema_valid`, `provenance_valid`, `privacy_valid`,
`annotation_valid`, `split_valid`, `holdout_frozen`, `oracle_independent`,
`renderer_identity_complete`, `external_trust_valid`, `external_holdout_baseline_valid`,
`acceptance_plans_valid`, `acceptance_reports_valid`, `capture_evidence_bytes_valid`,
`capture_attestor_trust_valid`, `registry_state_consistent`,
`rule_ready_for_calibration`, and
`rule_ready_for_calibrated_claim`.
Unknown flags, repeated single-value flags and options without values are usage errors with exit 2;
none are silently ignored.

Every file supplied through an external-artifact flag is read as bytes and passed through the same
strict UTF-8/JSON/schema decoder. CLI parsing does not create a second authoritative object. The API
accepts a redundant parsed projection for compatibility only when it is canonically identical to
the object decoded from the bytes. `{}`, malformed JSON, schema-invalid JSON, swapped artifact
classes and bytes/object desynchronisation therefore fail with exit 1 rather than certifying the
hash of one input and the semantics of another.

The checked-in synthetic example is a valid foundation report with `holdout_frozen: false`, the
three external-evidence checks false, zero
eligible real documents and both readiness flags false for all three rules.

When a holdout already exists, validate its successor against the independently retained prior
manifest:

```sh
node --experimental-strip-types tests/tools/calibration/readiness-validator.ts current.json \
  --previous-manifest frozen-previous.json --artifact-root /authorised/artifact/root
```

Changing holdout content and all internal hashes together still exits 1 under the same freeze
version. An evaluated lineage cannot replace its plan by incrementing the version. A restart needs
a new lineage/holdout ID and receipt already anchored in the prior baseline, with no evaluation for
that lineage. The
previous file must be protected by Git history or access-controlled append-only storage; passing a
mutable copy of the current file as its own baseline would defeat the process boundary.

## Negative controls and red/green procedure

Run a named injected defect, expect exit 1, and inspect the expected issue:

```sh
node --experimental-strip-types tests/tools/calibration/run-negative-control.ts \
  oracle-production-decision-free-field
```

Then run the canonical manifest command above and expect exit 0. The unit contract executes all 30
controls:

```sh
node --test --experimental-strip-types tests/unit/calibration-foundation.test.ts
```

Controls cover closed-taxonomy oracle bypasses, wrong artifact hash, hash and origin leakage across splits,
single annotation, unadjudicated disagreement, forced binary ambiguity, missing provenance/rights
or privacy status, changed frozen holdout, missing renderer identity, false readiness, calibrated
claim without gate, synthetic counted real and run-local target identity. Additional controls cover
coordinated internal-hash rewrites against a prior baseline, agreeing non-binary labels forced to
binary truth, holdout-derived candidates, same-split byte inflation, unverifiable source signatures,
wrong guidelines, renderer-ID/content drift and duplicate target/annotation IDs. A control that
unexpectedly passes is a stop condition. Synthetic records carrying invented human annotations are
also rejected.

The unit suite also executes a temporary 30-unique-byte end-to-end claim-contract simulation for
each governed rule. Each run has ten frozen targets and exactly ten validator-derived dispositions,
including one independent false positive and one production-declined exclusion; the prediction
seed does not mirror the oracle-label seed. The validator executes the real registry `Rule.run`
against a closed `m3-0-measurement-receipt-v1` projection and rejects mutations to the raw
measurement, candidate/rule identity, derived decision, row hash, oracle/prediction separation,
trust, receipt/plan lineage, holdout, acceptance, renderer and registry seams. An isolated clone
also changes the actual product-rule source bytes and proves that the independent source pin turns
red. Historical lineage A remains valid only against A's own complete external snapshot bytes when
lineage B starts. Inputs are generated test bytes with explicitly simulated external attestations
and receipts marked `non-evidentiary-contract-simulation`; they are never renderer evidence, real
corpus or readiness evidence.
The same test separately constructs a temporary `externally-attested-real-render` path for each
rule with exact separately supplied bundle/attestation bytes. It proves only the byte-validation
contract: `capture_evidence_bytes_valid` is true, while `capture_attestor_trust_valid`, the
real-evidentiary denominator and calibrated-claim readiness remain false. It is deleted after the
test and is not evidence that a real corpus or external trust root exists. It also verifies that
status relabelling and unrelated/mixed capture evidence cannot inflate the evidentiary denominator.
The non-evidentiary builder can reach the earlier Dev/Tuning `rule_ready_for_calibration` contract,
but its calibrated-claim readiness is false; the canonical public manifest reports both flags false.
Historical A/B tests rehash the complete A wrapper/snapshot/event after injecting a holdout split,
holdout document, known outcome or future candidate timestamp; each remains red because both
current and embedded historical candidates use the same semantic function.

The real lab mutation suite is explicit because it launches four full browser runs:

```sh
node --experimental-strip-types tests/tools/calibration/lab-mutation-controls.ts
```

These schemas, tools and documents are repository-only development/audit assets. The current
`0.2.0` npm tarball was not changed and does not include `tests/`, `schemas/` or these validation
documents. M3-0 validation therefore runs from a repository checkout, not from the published tarball.

## M3-1 entry criteria

Proceed only with a versioned sampling plan, authorised real sources kept outside the repository,
two independent blind annotators, adjudication capacity, group-level split assignment, renderer
freeze, preregistered acceptance metrics and a holdout freeze plan. M3-1 may collect and evaluate;
it may not set `calibrated: true` until the complete claim gate and a separately authorised product
change pass.
