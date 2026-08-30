# Calibration Corpus Contract v1

Contract ID `m3-0-corpus-contract-v1`; schema version `1`. The machine contract is
`schemas/calibration/corpus-manifest-v1.schema.json`, with annotations separately defined by
`schemas/calibration/annotation-v1.schema.json`.

## Document and provenance record

Each document has an opaque stable ID, exact artifact SHA-256, real/synthetic flag, one split,
origin group, optional duplicate/derivation/parent-template groups, capture time, renderer freeze,
rule targets, provenance class, rights evidence and privacy review. Allowed provenance classes are
`synthetic_first_party`, `public_redistributable`, `private_authorized` and
`private_nonredistributable`.

Rights status is one of `first_party`, `public_domain`,
`permissive_redistribution_verified`, `evaluation_only_authorized` or `unknown`. Privacy status is
one of `synthetic_no_personal_data`, `reviewed_no_personal_data`, `redacted_and_reviewed`,
`contains_personal_data_authorized_private` or `unknown`. Missing or `unknown` values block use.

Only the first three redistributable rights states paired with a privacy-safe state may point to
public repository bytes. Private records use `external-private` and an opaque locator. In a
redacted public copy their repository path is null and therefore ineligible; an authorised private
run instead supplies an opaque relative path below its external artifact root. No private corpus is
simulated: the checked-in example is explicitly synthetic and contributes zero eligible real
documents.

Manifest declarations alone are not claim evidence. Every real calibration document must also
match a separately supplied `m3-0-trust-ledger-v1` via `--trust-ledger`. That external ledger binds
document ID, exact bytes, origin and hashes of provenance, licence and privacy evidence to an
independent reviewer attestation. Without it, real-document eligibility remains zero. Exact bytes
are counted once: repeating one hash under fresh document or origin IDs is invalid even within one
split and can never inflate the `>= 30` gate.

A redacted public manifest may keep the private artifact path null, but such a record is never
eligible. Actual private calibration runs use a private copy of the manifest with an opaque path
relative to an authorised external artifact root; the validator reads those bytes and verifies the
recorded SHA-256. Thus a hash-only public record documents existence without pretending that an
unavailable artifact was verified.

## Annotation and adjudication

Every real target needs at least two records from distinct opaque annotators. Each binds target ID,
rule ID, guideline version and timestamp and must declare `blinded: true` and
`breaklintResultExposed: false`. Labels are `positive`, `negative`, `ambiguous`, `abstain` and
`invalid_target`.

Any disagreement, including a divergence involving ambiguity or abstention, requires a third
distinct adjudicator or panel. Final labels are `positive`, `negative`, `ambiguous` or
`excluded_invalid`. An ambiguous/abstained input may not be silently forced to positive or negative.
Synthetic construction truth needs no invented human annotators and never counts as real data.

Guidelines are versioned per rule (`svg-text-clipped-v1`, `svg-text-ink-collision-v1`, and
`svg-text-overflows-viewport-v1`). A changed guideline creates a new version; historical labels keep
their original version. The validator requires the exact per-rule guideline on every annotation and
adjudication, rather than accepting any string that merely looks versioned.

Targets are mechanically bound to the evaluated bytes. M3-0 parses the exact SVG/HTML artifact,
requires exactly one matching author-ID SVG root and text target, and recomputes `targetId` from the
artifact hash, root ID, text ID and rule. Run-local IDs and currently unverifiable `signature`
targets are ineligible and fail closed.

## Development, tuning and holdout

Splits are `development`, `tuning` and `holdout`, assigned at origin-group level. The validator
rejects a SHA-256, origin group, duplicate group, derivation group or parent-template group spanning
splits. This blocks renamed copies, versions of one source and template derivatives from leaking
between development/tuning and holdout.

Holdout results must not inform tuning or threshold selection. A freeze records a versioned holdout
lineage and ID, external preregistration-receipt hash, time, reason and approver; ordered document
ID/hash/origin tuples; canonical manifest, annotation and adjudication hashes; renderer-freeze IDs;
and exact external acceptance-plan hashes. Any mutation under the same version is a hard failure.
Before first holdout access, an external `m3-0-preregistration-receipt-v1` binds the exact plan hash,
new lineage and holdout ID. Its hash and access-time anchor must already occur in the independently
retained previous manifest. Timestamps are consistency checks, not authority: the prior retained
bytes are the authority. Once a lineage has any evaluation, changing its plan cannot be healed with
`version + 1`; a restart requires an entirely new lineage/holdout ID, new prior receipt anchor and
no evaluation on that new lineage. Evaluation outcomes are append-only and bind the freeze,
receipt, candidate and plan.

Internal hashes alone cannot make a mutable file immutable: an editor could update both content and
hashes. Validation of an existing freeze therefore supplies the prior, independently retained
manifest through `--previous-manifest`. The validator compares actual holdout projections and
rejects coordinated content/hash updates unless the permitted lineage/version transition is proven
against the prior receipt anchor. Git
history and access-controlled append-only storage must preserve that prior baseline; JSON and a
local CLI cannot prove ACL enforcement.

Every threshold/configuration candidate has a selection record binding it to a separate external
`m3-0-acceptance-plan-v1` supplied via `--acceptance-plan`,
rule, configuration and optional empirical-threshold hash, input splits/documents and evidence
hashes. Holdout splits, holdout document IDs, a declared `holdoutOutcomeUsed`, or a final holdout
outcome hash in this selection fail. The record blocks representable leakage; it cannot prove what
a human remembered, so operational holdout access remains separately controlled and logged.
The same semantic function validates current selections and the exact candidate bytes embedded in
every historical lineage snapshot. Historical snapshots therefore carry their own canonical
document/split projection and known-outcome hash set. Rehashing a snapshot and event cannot make a
holdout input, holdout document, known outcome or post-freeze candidate admissible.

A plan freezes its acceptance-plan and sampling-plan IDs and versions, acceptance-gate version,
creation time, rule, candidate/configuration and
threshold binding, and exactly one gate for precision, recall, specificity and false-positive rate.
Precision, recall and specificity permit only `>=`; false-positive rate permits only `<=`.
It must predate candidate selection, holdout freeze, evaluation and report. Candidate selection,
holdout projection, evaluation ledger, acceptance report and claim must carry the exact same plan
SHA-256. Changing the plan and coordinated internal hashes under an existing freeze version fails
against the external prior baseline.

A calibrated-claim gate additionally requires a separately stored `m3-0-outcome-v1` supplied with
`--outcome`. It has exactly one row per frozen holdout target of the rule and binds artifact,
document, target, rule, oracle/annotation/adjudication snapshots, truth or exclusion, candidate,
renderer, plan, receipt, lineage/version and production decision. The validator derives
TP/TN/FP/FN, exclusions, denominator and eligible holdout counts itself.

Prediction is not trusted from the outcome. A separate closed `m3-0-measurement-receipt-v1`,
supplied with `--measurement-receipt`, binds the complete rule-relevant `Snapshot`/`SvgRecord`
projection to artifact, source-bound target, exact candidate, concrete holdout renderer and
producer source identity. It represents measurable/declined state, target count/cap, ink stability,
T/T0 (including T0 <= 0), collision/occlusion counts, overflow, viewport and target boxes. A
separate `m3-0-production-evaluation-v1`, supplied with `--production-evaluation`, binds those exact
receipt bytes and the independently pinned source hash of the product rule. The validator invokes
the unchanged `VALIDATION_RULES_BY_ID[ruleId].run`; its real `RuleResult` is authoritative and is projected to
`finding`, `clean` or `declined` without reading oracle truth. The outcome binds the canonical
production-row hash. Included rows may use only renderer IDs present in the freeze and on their
concrete holdout document. The executable contract version and source hash must change together
after any authorised product-rule source change.

`evidentiaryStatus` is decision-effective. A receipt marked
`non-evidentiary-contract-simulation` can exercise the contract, but its outcome contributes zero
real-evidentiary holdout documents/origins and can never make
`rule_ready_for_calibrated_claim` true. `externally-attested-real-render` additionally requires
separately supplied `m3-0-capture-evidence-bundle-v1` bytes via `--capture-evidence` and matching
`m3-0-capture-attestation-v1` bytes via `--capture-attestation`. The validator hashes the bundle
bytes itself and recomputes their exact receipt rows, raw-measurement hashes, artifact/target set,
candidate, renderer, product-rule source, producer source identity and capture chronology. A free
hash string, unrelated attestation or status-only relabel cannot make the byte check pass.

Byte integrity is deliberately separate from attestor trust. M3-0 has no owner-approved,
externally governed allowlisted signing key, provider receipt or append-only capture-event root.
Consequently `capture_evidence_bytes_valid` can be true for a complete temporary contract test,
while `capture_attestor_trust_valid` and `rule_ready_for_calibrated_claim` remain unconditionally
false. A locally chosen `attestorId`, self-supplied key or coordinated rehash is not a trust root.
The temporary simulation may make the earlier `rule_ready_for_calibration` gate true when its
generated development/tuning records and simulated trust contract compose; this is reachability of
that pre-holdout gate, not real-corpus evidence. Its calibrated-claim gate remains false. The
canonical checked-in public manifest has both readiness flags false.

All external calibration inputs use one byte-authoritative decoder. The validator itself performs
strict UTF-8 decoding, JSON parsing and the class-specific schema check before an artifact enters a
hash map or semantic rule. This applies equally to the trust ledger, acceptance plan,
preregistration receipt, capture evidence, capture attestation, measurement receipt, production
evaluation, outcome, acceptance report and lineage snapshot. Library callers may provide an
already parsed object only as a redundant compatibility projection; a canonical mismatch against
the decoded bytes is a hard error. Hashing one byte sequence while validating a different object is
forbidden.

The separately stored `m3-0-acceptance-report-v1` supplied with `--acceptance-report` binds that
outcome hash. Its exact byte hash is bound to the claim and append-only evaluation ledger. Aggregate
counts must equal the target-row derivation; aggregate input alone cannot pass. The validator then
computes precision, recall, specificity and false-positive rate and applies the external plan; the
report must mirror those gates exactly and no writable
`passed` boolean is trusted. The report must bind the external holdout baseline/version, holdout
projection hash, candidate, renderer content hash, plan and independently eligible holdout counts.
JSON cannot prove ACL enforcement or human secrecy, so Git/ACL/append-only controls remain required.
Every evaluation event binds external `m3-0-lineage-snapshot-v1` bytes. That snapshot freezes its
ordered artifact/origin/target/source-identity, oracle, annotation, adjudication and renderer tuples
and embeds exact base64 bytes plus hashes for receipt, plan, candidate selection, optional capture
evidence bundle and attestation, measurement receipt, production evaluation, outcome and acceptance
report. Each historical event is validated
against its own bytes and chronology (`plan <= receipt <= freeze <= measurement <= production <=
outcome <= acceptance <= lineage snapshot <= event`). Historical events remain an immutable prefix when a new lineage
begins at version 1 with a newly pre-anchored receipt; they are not reinterpreted against the new
lineage's current freeze.

The checked-in 30-document success-path test labels its measurement receipt
`non-evidentiary-contract-simulation`. Its generated bytes and simulated trust attestations prove
only that all seams compose and reject mutation; they are not renderer output, real corpus, or
readiness evidence. A real run must have the capture-time renderer/measurement producer issue the
receipt. Reconstructing it from oracle labels or outcome rows is forbidden.

## Eligibility and gates

Only real, independently sourced, rights/privacy-cleared, unambiguous targets with complete blind
annotations/adjudication are eligible. Synthetic targets, targets, pages and repeated versions do
not substitute for unique document and origin counts.

`rule_ready_for_calibration` requires an accepted sampling plan plus eligible development and tuning
data. `rule_ready_for_calibrated_claim` additionally requires at least 30 unique eligible real
artifact hashes and 30 unique origin groups, a frozen unchanged holdout with an external previous
baseline, a recomputed passing preregistered acceptance report, and bindings for candidate
configuration and renderer content. Empirical rules also bind a threshold
candidate; the viewport rule is structural and must keep `thresholdCandidateHash: null`. A future
claim also requires a real corpus and an owner-approved external capture-attestor trust root. M3-0
does not have that root, so its calibrated-claim readiness remains false for every rule even when
capture bundle bytes are internally consistent.

Thirty is a minimum inherited product gate, not a power calculation. M3-1 must preregister sampling,
representativeness, acceptance metrics and one-time holdout access before collecting/tuning, and
must separately establish an owner-approved externally governed trust root. Private signing keys
must never enter the public repository; freely supplied CLI public keys cannot authorize themselves.

## Semantic controls

JSON Schema closes local shapes with `additionalProperties: false`. The semantic validator then
checks bytes, privacy-safe paths, group leakage, annotator identity, disagreement, ambiguity,
holdout projections, append-only evaluation, oracle independence, renderer completeness and false
readiness claims. `tests/fixtures/calibration/negative-controls.ts` contains one named mutation for
every mandatory failure class plus synthetic-as-real and run-local-target controls. Additional
controls cover coordinated holdout/hash rewrites against an external baseline, agreeing non-binary
labels forced to binary truth, holdout-derived candidate selection, same-split byte duplication,
wrong rule guidelines, content-derived renderer-ID drift, unverifiable targets and duplicate target/annotation
IDs, plus invented human annotations on synthetic truth.

Renderer freeze identity is itself closed and content-bound. `rendererFreezeId` must equal
`renderer_<sha256(canonical renderer projection without the ID)>`. Source identity is either a
verified clean commit or a dirty-source bundle binding the base commit, canonical Git diff,
tracked-plus-untracked non-ignored tree, source bundle and explicit scope. Renaming an ID without
changing the renderer content fails.
