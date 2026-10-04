# PROVISIONAL: evidence-led document understanding for 0.9

Status: **PROVISIONAL — no architecture acceptance, implementation approval or release claim.**
Draft date: 2026-10-05. Contributing model: **UNKNOWN**; no runtime model identifier is available.

This proposal follows the [registered expectations](expectations-0.9.md),
[repository contract](../AGENTS.md), [source/evidence contract](../docs/source-bound-findings.md)
and [limitations](../docs/limitations.md). Complete adjudicated labels and independent Claude Opus
and Gemini design audits, with dispositions, are still required before implementation. Thresholds,
rule enablement and schema choices below are proposals requiring that evidence and review.

## 1. Evidence available and limits

The acquired baseline print reports currently contain 538 all-rules findings and 141 default-profile
findings. These are inventory counts, not precision denominators validated by completed labels.
Four scoped baseline whitespace judgements have qualified single-family Grok evidence only.
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

Before semantic heuristics depend on lines/tables, repair demonstrated collector attribution errors
with independent physical-line and source-fragment controls. Review the open register's table
reconciliation, running-clone, multi-column, text-loss, spacing and named-page cases on current
fixtures; historical status alone cannot select a fix. The table exit-4 control needs cause/coverage
investigation. Security claims require real network-log evidence; existing egress limits remain.

## 4. Candidate rules and evidence needed

All entries are conditional candidates. No minimum print font size, ppi value, page distance or new
severity has been chosen. New rules start off by default or warn until the labelled evidence and
registered gates justify more. An error requires a named proof source and an explicit argument for
changing the current registry's two-error invariant.

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

Propose reason-required attribute/config suppression with its own validated contract. Reject empty
reasons and unknown selectors/options; record scope, underlying measured predicate and counts.
Suppression cannot hide infrastructure, missing measurement or evidence, or satisfy a deficient
coverage floor. Preserve underlying occurrence records for the registered label/count comparison;
no retrospective denominator reduction. Generic profiles supply selectors, DE/EN reference words,
chapter/page-role conventions and validated metric settings without consumer-specific core logic.

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
proof, implementation acceptance or release approval. The fresh Claude design audit remains
unavailable after a quota stop. The revised requirements below still need independent acceptance.

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
