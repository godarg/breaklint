# M3-0 validation and calibration foundation

M3-0 builds the apparatus needed to evaluate three SVG rules without claiming that any of them is
calibrated. It does not authorize a production threshold or calibrated claim. In 0.3.0 the two ink
definitions live only in the explicit validation registry; all 13 released rules and both research
definitions remain `calibrated: false`.

## Trust boundaries

The foundation keeps eight layers distinct and serialises them under distinct names:

1. `artifact`: the exact bytes and their SHA-256.
2. `renderObservation`: facts observed from the rendered artifact, including geometry and raster
   identities.
3. `independentGroundTruth`: a construction truth for synthetic cases or a blind human judgement
   supported by permitted independent evidence for real cases.
4. `breaklintMeasurement`: quantities consumed by the production rule, such as per-target ink
   counts. These are evidence about rule behaviour, never ground truth.
5. `productionDecision`: the authoritative `RuleResult` obtained by executing the unchanged
   registry rule's real `run` function over a closed, receipt-bound `Snapshot`/`SvgRecord`
   projection and the exact candidate configuration. There is no parallel decision formula.
   Neither outcome nor oracle supplies the prediction.
6. `blindAnnotations`: judgements made without seeing the breaklint result.
7. `adjudication`: an independent resolution of disagreement or ambiguity.
8. `evaluation`: comparison of the preregistered candidate against ground truth on the assigned
   split.

The arrow from layers 4 or 5 back to layer 3 is forbidden. Schemas establish record shape; the
readiness validator enforces cross-record independence, provenance, annotation, split and freeze
invariants. Neither mechanism alone is the oracle.

```
artifact bytes ──> real renderer ──> render observation ──> breaklint measurement
      │                                      │                         │
      └─> independent oracle/annotations ────┴──> evaluation <── production decision
```

For `svg/text-clipped` and `svg/text-ink-collision`, the future calibration mode is
`empirical-threshold`. For `svg/text-overflows-viewport`, it is `structural-validation`: the
boundary is zero and `overflow: visible` is an exclusion, not a tunable empirical threshold.

## Components

- [`oracle-contract-v1.md`](oracle-contract-v1.md) defines admissible truth.
- [`corpus-contract-v1.md`](corpus-contract-v1.md) defines provenance, annotation, splits and
  holdout freezing.
- `schemas/calibration/` contains strict JSON Schema 2020-12 contracts for manifests,
  annotations, external trust ledgers, preregistered acceptance plans and receipts, closed
  measurement receipts, real-rule production evaluations, target-level outcomes, acceptance
  reports, external capture attestations and immutable per-event lineage snapshots.
- `tests/tools/calibration/readiness-validator.ts` performs fail-closed semantic validation.
- `tests/tools/calibration/svg-validation-lab.ts` runs the synthetic lab in real Chrome with real
  Paged.js 0.4.3 and then invokes the unchanged production rule decisions.
- [`validation-lab.md`](validation-lab.md) documents commands, exits, controls and fixture results.

## Public/private boundary

The repository may contain first-party synthetic bytes, public-domain or verified permissively
redistributable bytes, schemas, non-sensitive hashes, redacted manifests and deterministic report
logic. Evaluation-only and private documents remain outside the repository. A redacted public
manifest uses `relativePath: null` and is deliberately ineligible because its bytes cannot be
verified. An authorised private validation run instead uses an opaque relative path below its
separately supplied private artifact root. Source locators and annotator identities remain opaque.
Absolute home paths, email-like locators, unknown rights, unknown privacy status and private bytes
declared as public all fail.

## Readiness is not calibration

`rule_ready_for_calibration` means that the foundation, an accepted sampling plan and eligible blind
real observations in both development and tuning splits exist. It permits calibration work to
start. `rule_ready_for_calibrated_claim` is stronger: at least 30 unique eligible real documents and
30 unique origin groups, complete annotation/adjudication, an unchanged frozen holdout with an
external prior baseline, a separate trust ledger, an externally stored pre-outcome acceptance plan,
a prior-baseline-anchored receipt, a closed measurement receipt, a production evaluation executed
through the exact source-pinned registry rule, a target-level outcome whose confusion matrix is
recomputed, a hash-bound acceptance report, an exact external per-event lineage snapshot, and candidate
configuration/renderer-content bindings must all validate. The plan, candidate selection, freeze,
measurement, production evaluation, outcome, evaluation event, report and claim bind the same
plan/receipt/lineage hashes; the plan supplies the authoritative
four gates. Identical
artifact bytes are invalid duplicates and count once, regardless of declared IDs.
Current and historical candidate selections share one semantic validator; a historical snapshot's
own frozen split projection and known-outcome hashes are authoritative for leakage checks.
Furthermore, external receipts require separately supplied, exactly bound real-render capture
bundle and attestation bytes. The validator can certify byte integrity but M3-0 has no independent,
externally governed attestor trust root, so no M3-0 receipt can feed the real-evidentiary holdout
denominator or make calibrated-claim readiness true. Contract simulations
remain valid test paths but always report zero such documents/origins and false calibrated-claim
readiness. Their earlier calibration-readiness flag may be true in the explicitly temporary builder
when the simulated Dev/Tuning and trust seams compose; the canonical public manifest keeps both
readiness flags false, and no simulation is persisted as real evidence.
Every external calibration artifact crosses one shared fail-closed decoder boundary. Trust
ledgers, plans, preregistration receipts, capture bundles, capture attestations, measurement
receipts, production evaluations, outcomes, acceptance reports and lineage snapshots are hashed,
strictly UTF-8/JSON-decoded, schema-checked and semantically evaluated from the same supplied
bytes. A preparsed API object is only a redundant projection: if present, its canonical value must
equal the object decoded from those bytes exactly. Malformed, schema-invalid, swapped or
desynchronised bytes never borrow validity from that projection.
For empirical rules the threshold candidate must also be bound; the structural rule must not carry
one. A separate, explicitly authorised change would still be required to set a production registry
entry to `calibrated: true`.

The M3-0 example has zero real documents, no holdout and all readiness and calibrated-claim flags
false. That is the intended green foundation state.

## Known limits

- Thirty documents and origins are a minimum contract floor, not a statistical power or
  representativeness proof.
- Renderer freezing records identity; it does not make two operating systems render identically.
- Human annotations remain fallible. Future evaluation must report agreement, ambiguity and
  exclusions, not hide them in a binary denominator.
- Intentional clipping or collision may be genuinely ambiguous.
- Device-pixel collision does not recover the documented sub-pixel optical-contact case.
- JSON cannot prove that a human was blind. Operational annotation access and evaluation events
  therefore require an external append-only ledger.
- The schema can prove that `Rule.run` received the receipt's closed projection and can pin the
  rule source bytes; it cannot turn a self-authored synthetic receipt into renderer evidence. Real
  claim work therefore requires the renderer/measurement producer to emit the receipt at capture
  time. The checked-in temporary simulation declares itself non-evidentiary.
- The temporary 30-document claim-path test is a contract simulation with generated bytes and
  simulated external attestations. It proves seam composition only and is not corpus/readiness
  evidence.
- A byte-valid capture bundle proves internal integrity, not who governed its production. M3-1 must
  add an owner-approved external trust root backed by an allowlisted signature key, verifiable
  provider receipt or append-only external capture event. No private key belongs in this repository,
  and a key supplied by the same CLI invocation cannot authorize itself.

## What M3-0 does not prove

M3-0 does not provide a real calibration corpus, a sampling-power argument, tuned thresholds, an
accepted holdout result, M3-1 completion, a release or a calibrated rule. Synthetic fixtures test
the apparatus and known boundary cases; they never count toward the real-document minimum.
