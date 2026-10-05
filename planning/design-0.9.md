# PROVISIONAL: evidence-led document understanding for 0.9

Status: **PROVISIONAL — no architecture acceptance, implementation approval or release claim.**
Draft date: 2026-10-05. Contributing model: **UNKNOWN**; no runtime model identifier is available.

This proposal follows the [registered expectations](expectations-0.9.md),
[repository contract](../AGENTS.md), [source/evidence contract](../docs/source-bound-findings.md)
and [limitations](../docs/limitations.md). Complete adjudicated labels and independent Claude Opus
and Gemini design audits, with dispositions, are still required before implementation. Thresholds,
rule enablement and schema choices below are proposals requiring that evidence and review.

## 1. Evidence available and limits

The original baseline report files were re-read on 2026-10-05: counting their canonical findings
arrays yields 538 all-rules findings and 141 default-profile findings. These are inventory counts, not precision denominators validated by completed labels.
Selected scoped baseline whitespace judgements have qualified single-family evidence only.
Labels, full recall confirmation, blind A/B and candidate implementation are incomplete.
Nothing here establishes precision, recall, calibration or improvement.

The coordinator measured these self-authored controls:

- One naturally continued table contains 9 rows on the first page and 15 on the second; the header
  appears only on the first page. Separately authored tables each show their own header. This
  establishes a continuation/ownership distinction, not a universal defect classification.
- Shifted inline text has two visible physical lines, while the collector retains three. Separate
  controls retain two, three and one. All eight inline commands exit 0. Collector line accounting
  therefore needs an independent physical-line oracle; a clean exit alone cannot prove that count.
- A whole-table control exits 4 in all three arms because typography candidates decline for
  `forced-break`, despite two bound artifact pages. Artifact binding and rule coverage are separate;
  neither changing a floor nor relabelling exit 4 as clean is a repair.

Private source and rendered material remain outside this repository. Public reproductions must be
self-authored, with provenance/rights notes and hand-written expected results before execution.
No claimed product precision may be inferred from these controls.

## 2. Proposed measured semantic index

A report-only interpretation can group existing findings and explain their recorded measurements.
It cannot recover missing source ownership, exact reference placement, resolved counters or image
sizes from hashes. New predicates need facts acquired with the document, not reporter heuristics.

Propose a bounded, typed document index in the measurement snapshot, populated from captured input
bytes and the same paginated acquisition. Rules remain pure snapshot consumers. The boundary is one
HTML document and its captured resource closure; multiple inputs do not imply one global publication.
Existing producer authority, primitive protection, resource limits and cleanup remain authoritative.
Bounds must produce explicit per-target declines and inventory completeness, never silently truncate
candidates or impose a desired finding-count quota.

The proposed index distinguishes these records:

- **Semantic objects:** figure, table, listing and equation; native tag or validated selector/ARIA
  evidence; authored anchor and source range; explicit body/caption/header ownership; ordered children
  and ambiguity. A wrapper box alone is not the body's placement.
- **Placements:** every actual source fragment and rendered body/caption/header occurrence, physical
  page ordinal, page-relative box, flow versus running clone, and same-acquisition evidence status.
  Printed folios are separate from physical ordinals. Invalid or withdrawn geometry stays unavailable.
- **References:** source owner and exact occurrence range, href target or bounded textual-reference
  parse, visible label/number, semantic target edge, document order, and actual rendered span/page.
  Ambiguous numbers, duplicate ids and unsupported language forms remain unknown. A source Textrun
  joined to the first block fragment cannot establish a later inline reference's page.
- **Numbering:** literal versus generated label, object kind, parsed number and provenance. Resolved
  counter/target-counter values need a source-to-render witness; computed pseudo declarations alone
  are insufficient. No arbitrary sequence convention is inferred from an apparent gap.
- **Graphic metrics:** owning object/resource identity; SVG text/tspan computed size and transform
  basis; effective physical print size; decoded raster pixel dimensions and rendered physical size.
  Browser natural dimensions, asset hashes and Freeze signatures alone do not establish effective ppi.

Available primitives include native block source ranges, author ids, fragments, page/content boxes,
SVG text identity/painted bounds and resource digests. Missing retained facts include parent/owner
edges, link-owner ranges, reference-specific placement, ARIA semantics, resolved numbering,
per-image dimensions and SVG font/transform metrics. Capture these explicitly or decline.
The nominal conversion of 72/96 pt per CSS px is a unit conversion, not a measured effective font size;
glyph-box height, container font size and raster DPI cannot substitute for it.

The package currently exposes reports rather than this internal snapshot/captured state. This draft
does not propose a public renderer/capability export or weaken the original-authoring boundary.
Selectors are search hints, not stable identities or permission to edit source.

### Schema proposal and migration

Propose **Snapshot 5 → 6** for the new required typed facts and completeness/provenance states.
A schema move requires a real migration of the shipped stored snapshot, validator/engine controls,
and live versus stored-consumer tests. An older snapshot cannot acquire facts that were never
measured: migration records missing ownership, counter values, placement and metrics as **UNKNOWN**,
with affected predicates declined. It must not invent zero sizes, an empty complete reference set,
or positive evidence. Fresh semantic measurement is required to resolve those unknowns.

Before admitting a legacy snapshot, define typed unavailable-data reasons and list every reason in
each consuming rule's `RuleMeta.declines`. Migration tests must execute the real engine and prove
`measured + declined = candidates`, with no unregistered reason or checker crash. A stamp update
and a validator accepting the new shape alone do not establish executable migration compatibility.

If canonical findings gain cause evidence, structured fix hints or suppression records, propose
**Report 5 → 6** independently. A reader migration must preserve original findings, diagnostics,
identities and stamps; new facts remain unknown for legacy reports. Context-pack/comparison/config
stamps move only when their own structures change, with separate migration and compatibility tests.
None of these stamp moves is accepted by this draft.

### Proposed non-vacuous completeness and provenance contracts

An unknown semantic inventory is a counted acquisition obligation, not an empty complete object set. For every enabled inventory-dependent rule and each inventory kind it requires, acquisition records one document-scoped completeness witness with a deterministic document/kind identity. That witness counts as one candidate alongside the individually observed object/reference candidates; it does not estimate missing objects. Its target evaluation is measured only when that inventory is positively complete. Unknown, partial, capped, legacy or mismatched inventory produces a registered not-measured evaluation with count 1, predicate UNKNOWN and countsTowardCoverage=true. These declines never enter the tool-capability or non-applicable exclusions. Show completeness-witness counts separately from concrete-object counts.

Any required incomplete inventory also makes document semantic completeness insufficient and produces exit 4, even if other rules measured targets or the numeric rule ratio exceeds its unchanged floor. Fatal infrastructure still takes precedence. failOn, display grouping and suppression cannot waive this obligation. A positively complete empty inventory may establish that no object exists; missing inventory may not. Real-engine migration controls must demonstrate all-unknown inventory, mixed measured/unknown inventories and a complete-empty control without a checker crash or vacuous clean result. This is proposed accounting, not an implemented migration.

Snapshot 6 is required for the collector-semantic repair as well as the semantic index. Fresh snapshots carry an explicit collector-semantics revision and a binding to the acquisition implementation/options that produced their line, fragment, placement and fill facts. Producer-source provenance remains separate. A stamp alone is not proof that the repaired semantics ran.

Migration of Snapshot 5 preserves its original observed bytes and legacy diagnostics, but marks collector-semantic provenance unknown. It must not relabel old lines, fragment groups or fill as repaired measurements. Rules that depend on affected legacy facts decline with a registered reason and remain coverage-accounted until fresh acquisition supplies the required independent witness. The shipped stored snapshot needs a real migration and real-engine controls; silently accepting stamp5 or merely changing its stamp is forbidden.

Source-based fingerprints remain deterministic and exclude page ordinals and fragment order. A repair must not claim the document changed because the collector changed. Comparisons require compatible collector and decision semantics; absent compatibility they return not-sufficiently-measured, never resolved. If comparison/context adds explicit provenance fields, its own stamp and reader migration must move. Tests must retain unaffected source identities, expose changed/unknown measurement semantics and prevent clone or line repair from manufacturing a fixed defect.

Validated semantic selectors, reference words, language settings and numbering conventions are resolved before acquisition. Object identification, reference parsing and ownership indexing occur once over the captured input and the same paginated acquisition. Rules consume these retained facts; reporters and rules do not reconstruct missing ownership or reparse under a different profile.

Snapshot 6 records the canonical effective semantic-profile identity, parser/identification revision and acquisition option binding separately from producer provenance. Semantic settings that are set-like are normalized before hashing; ordered settings retain order. A stored snapshot reused with a different or unknown semantic profile declines the affected inventory and reaches the completeness/exit contract above. It cannot silently reuse stale facts. Fresh acquisition under the requested profile resolves the mismatch. A same-input changed-profile control and a matching-profile control must prove this behavior before exposing selector/profile settings.

The candidate namespace additions are figure, table and reference. Add them to the normative registry-derived namespace enum only when a separately admitted rule uses them. The completeness witness needs the proposed target key type semantic-inventory, with document scope; it is an acquisition record with no invented DOM/source box. Proposed measured-unavailability reasons are env/semantic-inventory-incomplete, env/collector-semantics-unavailable, env/semantic-profile-mismatch, env/semantic-owner-unavailable, env/semantic-placement-unavailable, env/semantic-number-unavailable, env/reference-target-unavailable, env/printed-folio-unavailable and env/figure-print-metric-unavailable. Each admitted consumer declares its exact subset in RuleMeta.declines. These owed-measurement reasons are not tool-capability or non-applicable exceptions. Intentional accepted decisions and suppression of an already measured predicate are not unavailable measurements.

These proposed public values and retained facts require Snapshot 6, Report 6 and Configuration Contract v2 with explicit reader/migration controls. Target-evaluation semantics for the new completeness obligation require their own versioned decision contract; do not emit a changed meaning under rule-decision-v1. Generated configuration remains registry-derived. Standard interchange output retains its external schema and must prove that new ids/reasons serialize within it; a new rule id alone does not rename that external schema. Context/comparison stamps move if their own shape or identity contract changes, with independent compatibility tests. No enum or stamp is changed by this text.

## 3. Whitespace and collector correctness

Separate author intent, avoidable displacement and unknown cause. Use the paginator decision at the
actual break token, with a source witness where available. Keep computed CSS as separately named
cascade evidence; when it differs from the paginator, expose both. A continuing wrapper, changed
page styling or a forcing declaration the paginator never acted on is not proof of a forced break.

Account chapter endings, explicit forced/parity starts, named-page transitions actually acted upon,
title/part/cover/dedication/colophon pages, full-page figures and document endings as intentional or
accepted, with reasons visible. Generic page roles require explicit semantics/profile declarations
and a measured compatible boundary; sparse geometry alone cannot identify them.

Report avoidable whitespace only with a bound displacement witness: the figure/table/avoid block or
keep chain, its required height, available space and actual destination. Unknown causes decline;
they do not become confident alarms. Apply the same cause records to half-empty pages, orphaned
continuation pages and headings at page bottom, while retaining each rule's candidate accounting.

Evaluate a perceived-fill measure built from physical line bands and replaced-body occupancy against
independent visual labels. Glyph-band net fill is not perceived fill and has no fixed universal
ceiling. Preserve the old quantity as a diagnostic where useful; changing `minNetFill`/`maxNetFill`
semantics requires an explicit migration, not a silent replacement. No new fill threshold is chosen.
`layout/half-empty-page` remains experimental and **off by default**.

Collector ownership and printable-placement verification precede every candidate that consumes line, fragment, occurrence, page-placement or physical-transform facts. The dependency gate covers figure/caption-separated, figure/far-from-reference, figure/text-too-small, figure/raster-resolution, figure/overflows-content-box, both table placement/header rules and reference/page-number-mismatch, as well as the existing whitespace and typography consumers. Each rule admission names the exact collector facts and independent controls it requires. Source-only predicates still need a positively complete source/ownership inventory; they may not smuggle in unverified placement.

Required collector controls distinguish genuine continuations and repeated table headers from running clones and unplaced columns, preserve source census and printed overflow/bleed, keep independent physical columns separate and decline unsupported clipping or transforms. Same-acquisition ownership/ungrouped-rectangle/clip evidence and independent line or placement oracles are prerequisites, not after-the-fact rule filters. No placement-dependent rule is admitted on a repaired-looking box without those frozen red/green/mutation controls and fresh verification.

Review the open register's table reconciliation, running-clone, multi-column, text-loss, spacing and
named-page cases on current fixtures; historical status alone cannot select a fix. The table exit-4
control needs cause/coverage investigation. Security claims require real network-log evidence;
existing egress limits remain.

Collector repair must distinguish source ownership from printable placement. Positive DOM Range
rectangles alone do not prove that text paints in the page: the current collector groups them by
vertical position without intersecting the sheet or ancestor clip. Paged.js also uses a large column
gap offset. This supports a hidden-column hypothesis, not the origin of any observed clone.
Any repair needs same-acquisition occurrence, ungrouped Range and ancestor clipping evidence.
Content-box exterior, repeated text or a split marker alone must never discard a real continuation,
table cell, repeated header or author overflow that still paints in the sheet or bleed. Every
excluded occurrence stays in the source/candidate census with its reason and any separately proved
printable placement. A source token without proved placement remains explicitly unmeasured or
unplaced. Unsupported clipping and effects remain unknown. Independent controls must falsify a
filter that loses genuine continuation or merges separate physical columns by matching vertical
coordinates; a whole-block union box cannot replace its contributing rectangles.

## 4. Candidate rules and evidence needed

All entries are conditional candidates. No minimum print font size, ppi value, page distance or new
severity has been chosen. An error requires a named proof source and an explicit argument for
changing the current registry's two-error invariant.

Every new section 4 rule is OFF by default in all shipped profiles until its supported measurement contract, independent labels and preregistered precision/adverse-share gates pass and a separate evidence-bound enablement decision is reviewed. Warn severity does not grant default enablement, and a strict profile cannot activate an unadmitted candidate merely because it is registered. Explicit research opt-in is recorded as a separate arm and supplies no default-profile acceptance. Do not reduce the frozen precision denominator or alter the baseline/default comparison to admit a candidate. figure/unreferenced remains info-level and off by default; layout/half-empty-page retains its existing experimental/default-off decision unless its separately required evidence justifies changing it. The two-error guard stays in force; no new error is approved.

| Candidate | Established need / outstanding proof |
| --- | --- |
| `figure/caption-separated` | Source tags exist; self-authored body/caption split and intentional separate-caption controls, ownership and two bound placements still needed. |
| `figure/far-from-reference` | Exact first-reference edge/order and continuation-span placement missing; DE/EN, before/after and permitted-float fixtures plus label-led distance range needed. |
| `figure/dangling-reference` | Need complete ids, href owners, textual number resolution and ambiguity controls; a portable URL check proves none of these. |
| `figure/numbering` | Need literal/generated numbers and declared sequence conventions; duplicate, gap, reordered and intentionally restarted controls pending. |
| `figure/unreferenced` | Needs complete object/reference inventories; info-level and off by default remain proposed. |
| `figure/text-too-small` | Need effective SVG/tspan physical size with scaling/transform controls; painted bounds alone are insufficient. |
| `figure/raster-resolution` | Need decoded pixel/resource witness and actual print size; srcset/density/orientation controls and labelled threshold pending. |
| `figure/overflows-content-box` | Existing SVG bounds are useful primitives; body ownership, bleed/full-page intent and supported clipping evidence still needed. |
| `table/header-not-repeated` | Natural continuation versus separately authored tables is measured; header ownership/clone appearance, reader impact and positive repeated-header controls still needed. |
| `table/caption-separated` | Needs table/caption ownership and actual body-fragment placement, with intentionally separate captions as controls. |
| `reference/page-number-mismatch` | Needs displayed reference number, target edge and printed-folio mapping; TOC resets/roman numbering and counter controls pending. |

Each implemented class needs hand-written expectations, trigger/remedied and intentional/unsupported
controls, DE/EN forms, and A4/Letter coverage. Validate both accepted and declined candidates.
Admission of one class does not imply support for every listed class or unseen document pattern.

## 5. Reports, remedies and suppression

Keep JSON canonical. Human reports lead with verdict, requested/measured coverage, infrastructure
and the three to five highest-impact repair actions. Rank deterministically using supported impact
criteria; do not fabricate impact scores. Group by section, page and evidenced cause. Repeated
patterns may collapse for display, with every occurrence/id available and unchanged metric counts.

Each finding shows verified page evidence/crop, source/evidence status, reader consequence, cause
measurement and a concrete remedy. Missing or tampered assets stay visibly unavailable.
An intentional/accepted section lists accounted decisions and reasons, including omissions in any
bounded projection. Unknowns, unsupported targets and suppression remain visible beside coverage.

Put compatible revision comparison near the summary. A proposed CLI `--baseline` path should use
the existing comparison contract: display new/persisting/resolved, plus unmatchable or insufficiently
measured. Reduced coverage, disabling a rule, suppression or a missing target never proves repair.
The option is not currently promised as shipped; it needs real CLI/packed-consumer validation.

Remedy text remains solely in `src/rules/**`. Structured agent hints may name a selector, property,
value/range, expected effect and preconditions, but are data, never executable instructions or edit
authority. Emit a numeric scaling suggestion only when the geometry supports it. Tested advice
requires a genuine trigger/remedied pair; all calibration claims remain false.

Reason-required suppression is proposed as an explicit presentation/acceptance annotation for this release. It requires Report 6; that stamp move is not conditional once canonical suppression records are introduced. Each record binds the occurrence/finding id, source or config origin, validated scope and non-empty reason. The underlying finding, measured predicate, severity, source/evidence status and target evaluation remain in canonical JSON. A suppressed measured violation remains measured with predicate violated=true; it is not a decline or an excluded candidate. Candidate, measured, declined and error/warn/info counts are unchanged. The suppressed count is an additional annotated subset, never a replacement denominator.

Suppression does not change the exit verdict in this proposal. The unchanged underlying findings still participate in the existing failOn and experimental-rule policy, while infrastructure and incomplete evidence/inventory/coverage retain precedence. Invalid config suppression is rejected as a usage error; an invalid authored suppression request is visibly rejected and leaves the occurrence unsuppressed. Applying an attribute cannot authorize a config bypass. Comparison and the registered label/count metrics retain every underlying occurrence; suppression never establishes a resolved defect. Report 5 migration sets suppression data unknown, not an asserted complete empty set. Real-engine/public-consumer controls must prove these counts, exit behavior, missing-reason rejection and visibility before suppression is implemented.

Generic profiles supply selectors, DE/EN reference words, chapter/page-role conventions and validated
registry-declared metric settings without consumer-specific core logic.

Profiles and Configuration Contract v2 preserve the existing threshold and floor boundary. No profile, include, alias, acquisition attribute, config or CLI layer may supply proof-source-A threshold/options values. Rule enablement is separate from threshold configuration. Other tunable metrics must be registry-declared with validated ranges; structural proof boundaries remain fixed. Effective coverage floors may only stay at or rise above the active profile floor, and a later layer cannot undo a stricter floor already established. Selector and reference-word profiles are acquisition settings, never a second threshold table.

The runtime validator and generated schema derive these restrictions from the same rule registry. Before exposing v2, real public-consumer rejection controls must cover direct and profile-sourced threshold overrides, profile-sourced lower floors, a stricter-profile override attempt, unknown keys and malformed settings, plus legitimate stricter-floor controls. Existing v1 inputs require explicit compatibility; they do not gain unchecked v2 keys. No threshold, floor or timeout is changed by this proposal.

Configuration Contract v1 does not admit these selector/profile/suppression settings. They must not
be inserted as unchecked keys or confused with the existing HTML-tag exclusion list. A proposed
Configuration Contract v2 needs generated schema checks, rejection tests for unknown/malformed
entries, and explicit compatibility with v1 inputs. Acquisition-only attributes likewise need their
own validated accounting contract; reading an attribute does not authorize bypassing config checks.

## 6. Packages, verification and release blockers

Serialize collector, snapshot, rule engine and report-schema packages. Independent fixtures/docs
may proceed separately only after their scope and acceptance criteria are frozen. Each package
requires saved reproduction, red-before, green-after, a mutation that makes the protection fail,
and a fresh independent verifier on the frozen commit. Editing reviewed scope voids that review.
Stop a package after two rounds keep finding new blocker/high defects; disposition lower findings.
No new runtime dependency is proposed; the sole runtime dependency remains `parse5`.

Publication remains blocked until complete labels/recall confirmation, accepted design audits,
implementation evidence, migrations, full report-surface sight reviews, exact-candidate ordered
release/packed-consumer/CI gates, and the registered metrics and complete blinded A/B all pass.
The adverse-share reduction, default ceiling, recovered misses, no-regression and resource-cost
criteria in `expectations-0.9.md` remain unchanged; unknown or zero-denominator evidence is no pass.
At least two independent nonimplementing families must establish clearly higher value. Record actual
models and image/hash coverage, never infer a verdict from missing pixels or a prior reviewer.
No candidate exists yet, and no release condition is established by this proposal.

## 7. First text audit and dispositions

An independent Gemini text audit inspected the preceding draft, identified by SHA-256
`198565a20d77d4d6fd86b0aaf906951519039164fc3919d3694418c3fc1615d4`, and supplied repository-contract
excerpts on 2026-10-05. The service audit reports **`gemini-3.7-flash`** after the configured model
chain's fallback. It saw **zero images**, issued a **CONDITIONAL** verdict, and returned six findings
(two high, three medium, one low). This is a text audit of a proposal, not sight review, execution
proof, implementation acceptance or release approval. The fresh Claude audit was unavailable at that earlier checkpoint after a quota stop. Section 8 records
the subsequently completed conditional text audit. The revised requirements still need independent
acceptance.

| Audit finding | Disposition and required proof |
| --- | --- |
| ARCH-09-01, high: migrated unknowns can produce unregistered decline reasons | Accepted as a migration prerequisite. Section 2 now requires typed reasons, per-rule metadata and real-engine legacy fixtures proving complete accounting without crashes. No migration exists yet. |
| ARCH-09-02, medium: selector/suppression proposals exceed Config v1 | Accepted. Section 5 now explicitly requires a separate v2 contract and validation/compatibility tests before exposing such keys; acquisition attributes also require accountable validation. |
| ARCH-09-03, medium: promotion of a candidate to error hits the two-error guard | Retain the existing guard and candidate off/warn policy. Any later error proposal needs its own proof-source argument in `docs/limitations.md` and fresh review before a guard change; this draft approves none. |
| ARCH-09-04, high: semantic rules cannot repair faulty collector attribution | Accepted as a package dependency already required in section 3. Demonstrated physical-line and fragment defects need independent oracle tests and fresh verification before dependent rules. Thresholds and coverage floors remain unchanged. |
| ARCH-09-05, medium: graphic metrics may remain unavailable | Accepted. Missing decoded dimensions or effective SVG text transforms produce registered declines; no synthetic ppi or font-size fallback. Acquisition controls must demonstrate the supported metrics. |
| ARCH-09-06, low: exposing `--baseline` before consumer validation creates an untested contract | Accepted. Keep the proposed option unexposed until real CLI, comparison and packed-consumer tests pass. No shipped option is claimed. |

All implementation proofs in this table remain outstanding. Dispositions narrow the proposal; they
do not convert the audit verdict to PASS or satisfy either required design reviewer.


## 8. Fresh Claude text audit: proposed dispositions remain open

On 2026-10-05 a fresh self-contained text audit of frozen design commit `212a675`
(SHA-256 `3d9885456a4ca2d9b8734975d781b7857a68a8c964af5b1286c63a95f36983f4`)
completed with native exit 0. Its native modelUsage identifies **`claude-opus-5-5`**. It saw zero
images and returned **CONDITIONAL: three high, four medium and one low finding**, within the
eight-finding limit. It inspected the supplied design, repository contract and listed source
excerpts; it did not run code, inspect pixels, remeasure product counts or accept a release.
The preceding Gemini retry-chain exhaustion supplied no verdict on this frozen revision.

The contract additions above are proposals addressing this audit; they are not accepted architecture
and do not close the issues by themselves. Both required design audits must inspect the changed
revision, and each admitted implementation still owes its measured controls and fresh verifier.

| Finding | Proposed resolution; proof still outstanding |
| --- | --- |
| AUD-09-01, high | Count document inventory-completeness witnesses; incomplete required inventories force insufficient measurement instead of vacuous zero candidates. Real-engine legacy controls remain unrun. |
| AUD-09-02, high | Lock proof-source-A options and monotonic floors across profiles, includes, attributes and direct config. Public-consumer rejection controls remain unrun. |
| AUD-09-03, high | Require Snapshot 6 collector semantics/provenance; legacy data stays unknown and comparisons cannot manufacture repair. Migration and identity controls remain unrun. |
| AUD-09-04, medium | Parse profile-dependent semantics at acquisition; retain canonical profile provenance and decline mismatch. Matching/mismatching stored-consumer controls remain unrun. |
| AUD-09-05, medium | Name proposed namespaces, inventory target and unavailable-data reasons with artifact/decision stamps. Registry/schema/migration controls remain unrun. |
| AUD-09-06, medium | Gate every placement/fragment/transform consumer on independent collector controls. Dependency acceptance remains outstanding. |
| AUD-09-07, medium | Require Report 6 for reason-required annotations; retain underlying findings, accounting and exit. Suppression controls remain unrun. |
| AUD-09-08, low | Keep every new candidate off by default, including strict, until registered gates and reviewed enablement. No default has changed. |

The label set, recall sweep, default/all-rules metrics and blinded improvement judgments remain
incomplete. This revised proposal authorizes no code, migration, new rule, schema or release.
