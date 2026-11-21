# M3-1 Split and Holdout Method v1

Status: preregistered method with a local successor-freeze demonstrator; no external receipt or holdout evaluation is asserted here

## 1. Principle

Development, tuning, and holdout are separated at the closed provenance-group level. A different document ID or hash does not establish independence. Group closure and allocation occur without breaklint findings, scores, thresholds, production labels, or human labels being used to choose a split.

The holdout exists to test a preregistered decision, not to become another tuning set. M3-1 does not use holdout results to change a production threshold and does not assert calibration completion.

## 2. Group closure

Before allocation, construct equivalence/derivation edges for:

- identical artefact hashes;
- the same origin under different document IDs or locators;
- versions or translations of the same document;
- exports, extracts, redactions, ID-enriched copies, and other derivatives;
- documents generated from the same template or data source where rule-relevant geometry may be shared;
- known and perceptual duplicates;
- first-party product families and upstream generator families.

Take the transitive closure of these edges. Every resulting closed group is assigned atomically to exactly one of `development`, `tuning`, or `holdout`. A new edge that connects two splits invalidates the split and requires a new lineage version before evaluation.

Candidate examples in the source contract illustrate grouping: Dargel live responses, tracked sources, translations, extracts, and ID-normalized copies remain within their product family; `Grua_maquina.svg` and any edits or exports of that work remain in the Wilfredor artefact family; OWID grapher variants from the same chart/data lineage remain together. A different hash or delivery path never breaks a known lineage edge.

## 3. Allocation

Allocation uses a preregistered seed or externally committed assignment input and operates on closed group IDs. It may stratify by rule-relevant source class and coverage needs, but not by breaklint output or revealed labels. The allocation record binds:

- corpus, grouping, sampling, and contract versions;
- group-to-split assignments;
- document and target identities/hashes;
- renderer/environment declaration;
- allocation algorithm and seed commitment;
- expected strata and analysis plan.

The record reports group, document, and target counts separately. No individual target is moved across splits to balance outcomes.

## 4. Holdout blindness and access

Holdout artefacts and blind annotation packets may be prepared only by the minimum authorized custodial role. Developers and threshold decision-makers do not receive holdout labels, adjudications, breaklint outcomes, or outcome-revealing filenames before the preregistered evaluation gate.

Annotators remain blind as specified in the annotation protocol. Annotation and adjudication completion precede outcome disclosure. Access events are timestamped outside producer-controlled result input. A result revealed to a developer, annotator, adjudicator, or decision-maker before the gate invalidates the affected holdout lineage.

## 5. Freeze projection

The frozen projection includes, at minimum:

- exact artefact and target-manifest hashes;
- origin/duplicate/derivation/template/version group closure;
- group-to-split assignment;
- rights/privacy eligibility decisions;
- annotation packet and guideline versions;
- completed blind annotation/adjudication commitments, where applicable;
- renderer/environment and rule-contract versions;
- sampling and analysis plan versions;
- purpose, subject, sequence, predecessor, and freeze time.

The projection is canonicalized and hashed. The freeze becomes externally evidenced only when an independent receipt binds that projection hash, subject, purpose, contract version, time, sequence, and predecessor/checkpoint. A local manifest hash, Git commit, self-signature, or `previousManifest` field alone is not an external freeze.

The additive public v2 demonstrator records sequence `2` and binds `previousFreezeSha256=e9f880a8489e835aeeed89f1d387a8ba6d3be184d6b1297f5711138b95b42de9`, the immutable sequence-1 projection. It binds packet-v2 bytes and the v2 annotation bundle index; sequence 1 and all packet-v1 bytes remain unchanged. This proves local hash lineage and the negative controls only. It does not create an independent receipt, external trust root, human annotation, adjudication, calibration, or release authorization.

## 6. External receipt boundary

The receipt must be created before holdout evaluation and verified against a trust policy obtained independently of the producer-supplied corpus/result bundle. Capture evidence and the attestor trust root are separate: evidence that a receipt was captured does not prove that its signer is trusted.

Verification fails closed when the receipt is missing, post-dates evaluation, binds another subject/hash/purpose/contract, is replayed, rolls back sequence/checkpoint state, is self-signed by the producer, or relies on a freely supplied key/policy. Unknown, expired, rotated-out, or revoked attestors are rejected under the external trust-root policy.

This method does not claim that such a trust root or receipt currently exists. Until an owner-approved external governance arrangement and a real receipt are independently verified, holdout freeze validity and claim maturity remain false. A local demonstrator is an `untrusted fixture` only.

## 7. Evaluation and change control

After a valid external freeze, the evaluator runs the pinned code/environment once according to the analysis plan. The evaluation record binds its input projection, exact code commit, environment, output hash, time, and authorized purpose. Results are disclosed only at the planned gate.

The following require a new contract/lineage version, new split validation, and new external freeze receipt:

- any artefact-byte or target change;
- new or removed targets, including after an unfavorable result;
- group or split reassignment;
- correction of a duplicate/derivation/template edge;
- renderer/environment or annotation-guideline change that can affect labels;
- sampling, estimand, metric, or acceptance-plan change;
- re-evaluation after disclosure.

Prior receipts and results remain immutable and linked; they are not overwritten. A new lineage cannot erase the fact that an earlier holdout was opened.

## 8. Leakage and negative checks

Before evaluation, fail the lineage for any of these conditions:

- equal hash across splits;
- same origin under multiple IDs across splits;
- template, version, translation, redaction, export, or other derivation crossing a split boundary;
- holdout label or result visible to a prohibited role;
- outcome-dependent target removal or split balancing;
- coordinated rehashing or ID substitution intended to evade group matching;
- packet target-set count, uniqueness, or source commitment mismatch;
- neutral order that cannot be independently reconstructed from the committed seed/target contract;
- blind context that is not byte-equal to independent deterministic sanitization of the bound source;
- comments, editor/RDF metadata, authored source IDs, private paths, foreign namespaces, embedded `data:` metadata, or outcome hints in an annotator-visible context;
- target identity not bound to frozen bytes;
- freeze change without a new lineage and receipt;
- receipt created after evaluation;
- receipt/trust policy supplied solely by the producer;
- replay, substitution, or rollback accepted as current.

Each finding names the affected groups and evidence. No exception is silently waived. A failed check blocks holdout and readiness; it does not trigger automatic cleanup that would conceal the event.

## 9. M3-1 completion boundary

A successful infrastructure test may prove that the checks reject invalid fixtures. It does not prove a real external freeze. A real pilot report must state actual group/split counts, access roles, freeze time, receipt identity, verification policy source, and disclosure chronology—or explicitly state that each item is absent.

If real people, eligible documents, external receipt, or externally governed trust root are unavailable, the correct result is **Infrastructure Complete / External Execution Blocked**. No holdout, claim maturity, calibration, release, publish, or website action follows from this method alone.
