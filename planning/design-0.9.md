> Superseded for the 0.9 release process on 2026-10-07 by [the focused completion plan](finish-0.9.md). This earlier scope and its unmet criteria remain historical research, not a release PASS.

# PROVISIONAL: evidence-led document understanding for 0.9

Status: **PROVISIONAL — no architecture acceptance, implementation approval or release claim.**
Draft date: 2026-10-05. Contributing model: **UNKNOWN**; no runtime model identifier is available.

This proposal follows the [registered expectations](expectations-0.9.md),
[repository contract](../AGENTS.md), [source/evidence contract](../docs/source-bound-findings.md)
and [limitations](../docs/limitations.md). Complete adjudicated labels and independent Claude Opus
and Gemini design audits, with dispositions, are still required before implementation. Thresholds,
rule enablement and schema choices below are proposals requiring that evidence and review.

This revision is an **architecture contract refinement before evidence-led scope and admission
freeze**, not final implementation authorization. **Phase A remains INCOMPLETE.** All eight findings
in section 9 remain **OPEN** until the corrected frozen design receives fresh independent audits and
Root accepts their dispositions. Future implementation controls are **PENDING**, not automatic failures
because they are unrun. There is **no current migration PASS**, no candidate acquisition or primary
membership freeze established here, and no new-version or release verdict. Actual model identifiers
and unretained runtime fields remain **UNKNOWN** unless bound existing run output establishes them.

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

Propose **Snapshot 5 → 6** for collector-semantic repair and new typed facts, required completeness
obligations and measurement provenance. An older snapshot cannot acquire missing ownership, counter
values, placement or metrics: preserve observations and original diagnostics and mark missing facts
**UNKNOWN**, with the exact owed consumer declines below. Never invent zero sizes, complete-empty
inventories or fresh measurement. A changed stamp or validator alone proves no executable migration.
Before a migrated snapshot is judged, register every unavailable-data reason in `ENV_IDS` and each
consuming `RuleMeta.declines`; real-engine controls must prove `measured + declined = candidates`
without undeclared reasons or a checker crash. Live/stored controls remain pending.

**Report 5 → 6 is required** for the mandatory inventory and measurement-semantics projections,
cause/accepted-decision evidence and canonical suppression annotations in this proposal. Readers for
Report 4/5 preserve findings, diagnostics, identities, original stamps and available facts. New facts
are **UNKNOWN**, including legacy suppression completeness. Snapshot, report, configuration, decision,
context and comparison compatibility are separate contracts. Each structural or identity change owes
its own stamp/version and reader/migration controls. No enum, schema or stamp is changed by this text.

### Stored demo: fresh recording and legacy control

The existing public `examples/demo-snapshot.json` explicitly identifies a **handwritten snapshot
fixture**, not an acquired document. It is Snapshot 5; its renderer and inputIdentity are null. Its
metadata does not bind original HTML for the illustrative former line addresses. The current CLI
loads this fixture and documents exit 1. These are static source/metadata observations; its current
CLI exit was not remeasured during this design refinement.

Keep the public demo behavior as a stored-snapshot rule/reporter demonstration ending with exit 1.
Before Snapshot 6 activation, create a fresh recorded Snapshot 6 from a new finite, self-authored
public HTML input through the supported acquisition. Bind source and resource closure, acquisition
options, implementation/collector/parser/profile identities and the same-acquisition expected
violation. Choose a supported existing nonexperimental gating error under the unchanged default
failOn policy and fully measured obligations, then verify the real CLI and engine end with exit 1.
The demo runtime continues to need no renderer because it reads that stored measurement; the
preparation of its record is a real acquisition.

Retain the exact old handwritten Snapshot-5 bytes as a named migration control, never as freshly
acquired or repaired geometry. Its migration preserves observations and original diagnostics and
explicitly sets missing collector/semantic facts UNKNOWN. Its expected outcome follows the declared
per-rule obligations and is frozen before testing; it cannot invent evidence to preserve the old
illustrative demo result. Do not merely change its stamp or silently accept stamp 5 in the new
engine. A fresh Snapshot-6 demo is required to preserve the help contract; the legacy control does
not satisfy it.

### Non-vacuous completeness, report fields and exit order

An unknown semantic inventory is a counted acquisition obligation, not an empty complete object set.
For every enabled inventory-dependent rule and required inventory kind, retain one document-scoped
completeness witness with deterministic document/kind identity. It counts as one candidate alongside
concrete observed targets, without estimating missing objects. A complete inventory gives the witness
a measured decision; partial, unknown, capped, legacy or mismatched inventory gives a registered
not-measured decision, count 1, predicate **UNKNOWN** and `countsTowardCoverage=true`. These are owed
measurements retained in both the coverage base and the source census.

Report 6 requires a document semanticInventory projection. Each enabled inventory-dependent
rule/kind obligation records ruleId, kind, deterministic document/kind witness identity,
required=true, status complete/partial/unknown/capped/legacy/mismatched, reason and compatible
acquisition identity. SemanticCompleteness is sufficient only if all required obligations are
positively complete. A complete empty set is a measured completeness witness with zero concrete
objects; unknown never means empty.

RuleCoverage retains total candidates/measured/notMeasuredCount and adds separate
completenessWitness and concreteTarget components, each with those three counts and their typed
not-measured records. Component counts reconcile exactly with the unchanged total accounting. One
witness is one obligation, not an estimate of missing objects. Report 6 document, context and
whatWasNotMeasured projections retain rule, kind, witness/target distinction, reason and count;
bounded omissions are explicit.

After invocation validation, document verdict precedence is: fatal infrastructure → required
semantic inventory incomplete → required page evidence incomplete → empty input/no measured rule →
numeric coverage-floor failure → finding gate → clean. The first failed condition determines
exitReason; all concurrent records remain visible. The new deterministic reason is
semantic-inventory-incomplete, with the ordered rule/kind reasons in semanticInventory. Fatal
infrastructure remains exit 3 and precedes every insufficiency; semantic/evidence/coverage
insufficiency remains exit 4 even if a numeric ratio passes or failOn=never. Ratio, display grouping
and suppression cannot waive a required incomplete witness. Across documents, the existing
strongest-verdict ordering remains.

Real-engine controls must cover all-unknown, mixed and complete-empty inventories, a numeric ratio
that passes despite an unknown required witness, and simultaneous fatal/inventory/evidence failures.
Each asserts reason precedence and separated witness/target accounting. These controls remain
**PENDING**; their specification is not a migration or executable test result.

### Required measurement identities and comparison compatibility

Snapshot 6 records collector-semantics revision and acquisition implementation/options binding for
its line, fragment, placement and fill facts. Collector provenance stays separate from producer/source
capability provenance. Snapshot-5 migration marks collector semantics **UNKNOWN** and preserves the
original observed bytes; it cannot relabel old lines or fragment groups as repaired. Every affected
released consumer in section 3 declares its exact owed legacy reason.

Validated semantic selectors, reference words, language/numbering and page-role conventions resolve
before acquisition. Identification, reference parsing and ownership indexing occur once over captured
input and the same paginated acquisition. Rules and reporters consume retained facts and do not
reparse missing facts under another profile. A stored matching-profile control and a changed/unknown
profile control must prove the proposed mismatch decline and completeness/exit contract.

Report 6 requires measurementSemantics per document: collectorSemanticsRevision, acquisition
implementation/options binding, canonical effective semanticProfileIdentity, parser/identification
revision and the applicable ruleDecisionVersions. Every member has known/unknown availability and
identity provenance; producer/source capability provenance remains separate and mandatory under its
existing contract. Snapshot 6 is the acquisition source for this projection. Legacy Report 4/5
reading preserves findings, identities, diagnostics and original stamps and projects the missing
semantic identities UNKNOWN.

Configuration v2 expands every permitted semantic setting into config.effective before acquisition,
including selectors, reference words, language/numbering and declared role conventions. Its
versioned canonical fingerprint includes those effective values. Set-like values normalize before
hashing; meaningfully ordered values retain order. A profile label alone is not an independent
hidden input. No document-provided policy layer is introduced. Acquisition uses this exact resolved
identity once; rules/reporters do not reparse under another profile.

compareReports checks known compatible collector, parser/profile, acquisition options and per-rule
decision identities before both observed-finding matching and absent-finding/resolution branches.
Missing, changed or unsupported compatibility produces not-sufficiently-measured with explicit
reasons, never resolved or proved target deletion. A source identity must not change merely because
the collector changed. Suppression, lower coverage, omitted targets and legacy unknowns cannot
establish repair. Compatibility rules are explicit, versioned and supported by independent controls;
equal tool version or equal schema stamp is insufficient. Context and comparison contracts require
their own version/stamp and reader migrations wherever this mandatory projection or identity guard
changes their shape/meaning.

### Proposed enum and decision-contract additions

The proposed new rule namespaces are `figure`, `table` and `reference`; add a namespace to the
normative released enum when its first rule is **REGISTERED**, not only when admitted. Registration,
admission and default enablement are distinct section 4 states. The completeness witness uses proposed
key type `semantic-inventory`, with document scope and no invented DOM/source box.

Proposed owed measured-unavailability reasons are `env/semantic-inventory-incomplete`,
`env/collector-semantics-unavailable`, `env/semantic-profile-mismatch`, `env/semantic-owner-unavailable`,
`env/semantic-placement-unavailable`, `env/semantic-number-unavailable`, `env/reference-target-unavailable`,
`env/printed-folio-unavailable`, `env/figure-print-metric-unavailable`, `env/break-cause-unavailable`,
`env/page-role-unavailable` and `env/displacement-witness-unavailable`. Every released or new consuming
rule declares its exact subset in `RuleMeta.declines`, with the inventory below and cause contract in
section 3. None enters TOOL_CAPABILITY_ENV_IDS or NON_APPLICABLE_ENV_IDS. Intentional/accepted decisions
and annotations of measured violations are separate typed reasons, never unavailable measurements.

The completeness obligation and changed cause-aware decisions use proposed `rule-decision-v2`.
Preserve old v1 decisions and their version as historical input; do not emit changed meanings under
v1 or assume compatibility. Snapshot 6, Report 6, Configuration Contract v2 and changed context/
comparison contracts require independent compatibility controls. Standard interchange schemas remain
external contracts; new ids/reasons/annotations must serialize in them without falsely renaming those
schemas. All proposed values and exact reader behavior remain **OPEN** until independently audited.

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

### Released cause-aware decisions and versioned accounting

The proposed cause-aware decision change applies explicitly to layout/half-empty-page,
layout/orphaned-continuation-page and layout/heading-at-page-bottom. It has rule-decision-v2
semantics, including the completeness-witness obligation; changed decisions must not be emitted
under rule-decision-v1. Registry and readable decision contracts identify compatible versions per
rule. Migration preserves old v1 decisions with their version and makes compatibility UNKNOWN; it
cannot reinterpret them as new decisions.

Positively established intentional/accepted cases use status=measured, predicate.violated=false,
countsTowardCoverage=true, and a typed decision disposition of intentional or accepted, with an
independently retained compatible boundary/role witness. The proposed closed decision-reason
registry names chapter-end, document-end, forced-start, parity-start, acted-named-page-transition,
declared-special-page and full-page-object. Each reason is an accepted decision reason, never an
EnvId. The reason, witness and unchanged candidate count remain visible in Report 6 and bounded
context. Sparse geometry or unacted CSS cannot establish acceptance. Not-applicable/excluded remains
reserved for demonstrated scope exclusions; an intended page is not unavailable merely because the
author intended it.

If a required cause, compatible page-role boundary or displacement witness is absent, use
status=not-measured, predicate UNKNOWN and countsTowardCoverage=true. Proposed owed reasons are
env/break-cause-unavailable, env/page-role-unavailable and env/displacement-witness-unavailable,
with exact per-consumer RuleMeta.declines entries. A rule requires a role witness only for the
particular asserted role-dependent decision; absence of arbitrary role declarations does not make
every ordinary page unknown. These reasons do not enter TOOL_CAPABILITY_ENV_IDS or
NON_APPLICABLE_ENV_IDS. Existing independent infrastructure diagnostics remain visible. Suppression
cannot supply a witness or waive coverage.

Before activation, preregister the finite default/strict before-and-after cases for measured defect,
proved intentional/accepted, unknown cause, unknown displacement and legacy provenance. Keep all
released numeric thresholds, default settings and floors. Unknown owed candidates can legitimately
produce exit 4, immediately under strict floor 1, but every baseline 0/1→candidate 3/4 transition
still requires fresh independent proof under the unchanged no-regression criterion. No measured
geometric violation disappears merely through a reporter annotation. Half-empty-page remains
experimental/default-off; experimental findings still do not trigger the finding gate, while its
enabled measurement obligations retain their coverage effect.

Evaluate a perceived-fill measure built from physical line bands and replaced-body occupancy against
independent visual labels. Glyph-band net fill is not perceived fill and has no fixed universal
ceiling. Preserve the old quantity as a diagnostic where useful; changing `minNetFill`/`maxNetFill`
semantics requires an explicit migration, not a silent replacement. No new fill threshold is chosen.
`layout/half-empty-page` remains experimental and **off by default**.

The dependency gate applies to every released rule as well as every new candidate. The normative
inventory names all thirteen released ids and, for each, the exact retained line, fragment,
occurrence, placement, source-census or physical-transform facts it reads; the independent
hand-authored positive, negative, unsupported and mutation controls; and the exact registered
legacy/missing-fact decline subset. The following thirteen-rule table is the bounded proposed
inventory. It preserves each existing RuleMeta.declines list and identifies proposed additions
separately. No released rule is implicitly exempt because it predates admission.

The ten geometry/fragment/placement consumers in that table require known compatible collector
semantics. Their proposed legacy decline is env/collector-semantics-unavailable, declared
individually in RuleMeta.declines and counted as an owed measurement. Source-text and local-URI
predicates retain their source-based arithmetic where the captured source census and ownership are
positively complete. They do not need artificial geometry to detect a character or URI, but
source-run loss, unproved occurrence ownership, missing source census or an invented page address
cannot be hidden. Source-census incompleteness uses the explicitly declared
env/semantic-inventory-incomplete obligation; placement UNKNOWN remains separate from an otherwise
measured source predicate. Retain unplaced source leaves in the census with their reason, rather
than dropping them because a printable block was filtered.

Before changing any consumed fact, freeze independent physical-line, continuation, ownership,
placement or transformed-boundary controls and observed red/green/mutation evidence, followed by a
fresh verifier on the frozen implementation. A real two-page table, repeated header, independent
physical columns, running original/clone, author overflow/bleed and unsupported clipping/transform
controls must be able to falsify the filter. Content-box exterior alone is insufficient to discard
printed material. All excluded residual occurrences stay visible in the source census. The
structural Proof-A boundaries, the two-error guard, options and floors remain unchanged; no
two-fragment sum is asserted to be safe where the released error rule explicitly retains its
decoration ambiguity.

### Existing released rule dependency inventory

This table names all thirteen released rules observed in `src/rules/index.ts`, both Proof-A errors,
their actual body dependencies and declared decline lists. It describes static current code, not a
runtime proof that collector geometry painted or a claim that the proposed controls passed. The
current default enables twelve; `layout/half-empty-page` is off; current strict enables thirteen.
Current defaults, structural options and floors are preserved. The table's proposed reasons are
additions requiring enum/metadata/reader controls, not existing emitted values. For the three source
predicates, the UNKNOWN source-census obligation is separate from otherwise measured source arithmetic;
missing placement alone never invents a geometry requirement for the local-URI predicate.

| Released rule and actual body ranges | Retained facts read by the current rule | Independent finite controls required before changing those facts | Current declared declines; proposed additions |
| --- | --- | --- | --- |
| `layout/widow`; `src/rules/layout/widow.ts` 62–127 | Opening own-line count, delegated/nested ownership, previous source-correlated fragment, fragmentIndex/count, incoming paginator cause, block-container and effective widows facts. | Two-page own-text continuation with hand-counted opening/previous closing lines; nested paragraph carried whole; display:contents/container; forced boundary; running clone; shifted inline and separate physical columns. Mutation: join or duplicate an unplaced rectangle or delegate the wrong owned line; oracle must detect changed counts. **PENDING.** | Current: `env/multicolumn`, `env/vertical-writing`, `env/forced-break`, `env/invalid-measurement`. Proposed owed: `env/collector-semantics-unavailable`. |
| `layout/orphan`; `src/rules/layout/orphan.ts` 48–107 | Closing own-line count, next correlated fragment, fragmentIndex/count, outgoing cause, container/effective orphans facts. | Two-page own-text split with independent closing/next opening line counts; intact nested child moved whole; forced boundary; hidden original/printed clone. Mutation: change next-fragment owner or admit staging line; oracle must fail. **PENDING.** | Current: `env/multicolumn`, `env/vertical-writing`, `env/forced-break`, `env/invalid-measurement`. Proposed owed: `env/collector-semantics-unavailable`. |
| `layout/unbreakable-block-too-tall` **error, Proof A**; `src/rules/layout/unbreakable-block-too-tall.ts` 113–204, 235–284 | sid-correlated flow fragment census, visible boxed lead, rendering/display/marginCopies/visibility, fragmentCount, retained first-box height for one/two fragments and sum for >=3, page content height, fixed break-inside structural option. | Independently measured oversized avoid block spanning >=3 pages; hidden first fragment with later printed lead; genuine two-page table/block with repeated decoration, preserving the released ambiguity; running clones; printed bleed outside ContentBox. Mutation: drop a real fragment or add a clone height; independent membership/length oracle must fail. **PENDING.** | Current: `env/multicolumn`, `env/vertical-writing`, `env/invalid-measurement`. Proposed owed: `env/collector-semantics-unavailable`. |
| `layout/heading-at-page-bottom`; `src/rules/layout/heading-at-page-bottom.ts` 46–135 | Heading tag, printable/renderedBox own or visible lines, same-page following blocks and their placement, contentBox bottom, lineHeight/font fallback, visibility/container scope. | Heading stranded vs heading followed by real body; display:contents heading; hidden/running original and margin clone; transformed/clip unknown; compatible deliberate page boundary with accepted reason vs unknown cause. Mutation: promote staging following block or lose a printed follower. **PENDING.** | Current: `env/multicolumn`, `env/vertical-writing`, `env/invalid-measurement`. Proposed owed: `env/collector-semantics-unavailable`, `env/break-cause-unavailable`, `env/page-role-unavailable`, `env/displacement-witness-unavailable`. |
| `layout/half-empty-page`; `src/rules/layout/half-empty-page.ts` 40–136 | Page blank, glyph-band fill.net/topGap, contentBox, isLast, incoming cause and fragment continuation membership. Existing net-fill arithmetic is diagnostic; new perceived fill is a separately versioned proposal. | Hand-labelled physically full large-leading page; intentional terminal/role page; parity/forced starts; independently measured avoid-object displacement vs unknown displacement; unchanged defaults and strict enabled coverage. Mutation: replace missing cause with overflow or pretend glyph fill is perceived fill. **PENDING.** | Current: `env/parity-blank-page`, `env/forced-break`. Proposed owed: `env/collector-semantics-unavailable`, `env/break-cause-unavailable`, `env/page-role-unavailable`, `env/displacement-witness-unavailable`. |
| `layout/orphaned-continuation-page`; `src/rules/layout/orphaned-continuation-page.ts` 1–82, 94–232 | Page-by-page pre-order blocks, renderedBox/contentBox vertical overlap, fragmentIndex, linesByBlock and next-page fresh-block ownership, net/topGap, block lineHeight, overlapping SVG viewport, blank/incoming cause. Horizontal position alone is not validated by the current flowBlocks predicate. | Genuine tiny ending continuation vs full middle continuation; two-page table continuation/repeated header vs two independent tables; running/margin SVG; inline tall SVG vs body object; printed bleed; unknown cause. Mutation: reorder ownership or substitute staging next-page lines; independent physical ownership oracle must fail. **PENDING.** | Current: `env/parity-blank-page`, `env/forced-break`. Proposed owed: `env/collector-semantics-unavailable`, `env/break-cause-unavailable`, `env/page-role-unavailable`, `env/displacement-witness-unavailable`. |
| `layout/hyphen-across-page`; `src/rules/layout/hyphen-across-page.ts` 45–85 | Source fragment continuation/index/count, effective layout scope and retained boundaryHyphen mark on own/nested inline content. Page cause is also message data. | Known word split across pages inside an inline emphasis element vs intact word/whole moved child; repeated/running clone and source ownership; no-source-map/unsupported provenance. Mutation: transfer hyphen mark to wrong owner or silently drop a real boundary occurrence. **PENDING.** | Current: `env/multicolumn`, `env/vertical-writing`. Proposed owed: `env/collector-semantics-unavailable`. |
| `svg/text-overflows-viewport` **error, Proof A**; `src/rules/svg/text-overflows-viewport.ts` 22–42, 59–129, 131–195 | Inline SVG/text source census and per-target addresses, viewportScreen and CTM-transformed text boxes, measurable/reason/capped/unreadable/unsupported counts, visible-overflow applicability, rounding and fixed structural boundary. | Known transformed text within and outside a clipped viewport; overflow:visible nonapplicable target; CTM/viewport unsupported; painted stroke/filter/use targets; cap/unaddressable rest; repeated SVG identities. Mutation: remove an unreadable target or change CTM/viewport basis; independent geometry/census oracle must fail. **PENDING.** | Current: `env/svg-not-inline`, `env/svg-no-text`, `env/svg-overflow-visible`, `env/svg-too-many-text-targets`, `env/svg-ctm-unavailable`, `env/svg-viewport-geometry-unsupported`, `env/svg-painted-bounds-unsupported`. Proposed owed: `env/collector-semantics-unavailable`. |
| `type/spaced-hyphen`; `src/rules/type/spaced-hyphen.ts` 48–87 | TextRun source characters, language/ancestor exclusion and math-window predicate; candidate census and block/source identity are first-collected-block dependent; page/box projection is not an occurrence-specific printable witness. | Self-authored DE/EN character/context and excluded-code cases; same source with split/clone placement must keep source count/identity; unplaced source run must stay censused with UNKNOWN location; first fragment cannot establish later occurrence page. Mutation: drop source run when block placement is excluded. **PENDING.** | Current: none. Proposed owed: `env/semantic-inventory-incomplete`. |
| `type/straight-quotes`; `src/rules/type/straight-quotes.ts` 40–77 | TextRun source characters, digit-before-mark exception, language/ancestor exclusion; first-block-dependent census/identity and placement projection. | DE/EN straight mark, inch/arc-minute and excluded-code controls; split/clone/unplaced run count and source identity; explicit UNKNOWN occurrence location. Mutation: multiply source run for clones or omit unplaced quoted source. **PENDING.** | Current: none. Proposed owed: `env/semantic-inventory-incomplete`. |
| `type/short-last-line`; `src/rules/type/short-last-line.ts` 45–100 | Paragraph tag/alignment, last-fragment status, visible physical lines, last width, block width and effective fontSize, layout scope/finite geometry. | Hand-measured last line width and ems vs page-boundary line; shifted inline fragments and distinct physical columns; narrow/long final line; unsupported geometry. Mutation: merge columns by y or treat clipped staging line as last printed line. **PENDING.** | Current: `env/multicolumn`, `env/vertical-writing`, `env/invalid-measurement`. Proposed owed: `env/collector-semantics-unavailable`. |
| `type/excessive-word-spacing`; `src/rules/type/excessive-word-spacing.ts` 69–164 | Visible container/leaf ownership, justification, authored word-spacing, td/th exclusions, line records and wordBoxes horizontal gaps, independently sampled natural spaceWidth, source block/source rendering facts. | Hand-counted consecutive-word gaps and natural space under same font; author-spaced inline run; nested/display:contents container; separate physical columns; table-cell exclusion; missing natural space. Mutation: mix word boxes between columns/owners or invent missing divisor. **PENDING.** | Current: `env/multicolumn`, `env/vertical-writing`, `env/invalid-measurement`. Proposed owed: `env/collector-semantics-unavailable`. |
| `artifact/local-uri`; `src/rules/artifact/local-uri.ts` 46–77 | Source-model URI inventory, rawValue/scheme/resolvedUri and request metadata. No line, fragment, page box or CTM is read by the predicate; literal page 1 is a report address, not a measured rendered occurrence. | Self-authored file:/absolute-local/relative/data URI forms in supported HTML/CSS inventories; same source with altered paginated placements preserves URI census; unsupported/incomplete source census remains UNKNOWN. Mutation: silently omit a URI source leaf. Geometry-provenance absence alone must not fabricate a URI predicate decline. **PENDING.** | Current: none. Proposed owed: `env/semantic-inventory-incomplete`. |

The source-text snapshot assembly currently joins a source run to its first collected block and drops
runs lacking that join (`src/measure/snapshot.ts` 1387–1393). URI references map directly from the source
model (1444–1447). Thus character predicates do not use geometry for arithmetic but can still lose
candidates through collector-dependent mapping. The new source census must retain those residuals and
UNKNOWN occurrence placement; neither a first-fragment box nor literal fallback page 1 is a proved
reference/character occurrence page. The unbreakable-block error currently retains first-box geometry
for one/two fragments and sums correlated fragments only from three onward; this proposal does not
claim that a two-fragment sum is safe or silently change that structural decision.

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

Define registered, admitted and default-enabled separately. Registered means a supported definition
is in the shipped rule registry and its id is supported by the generated schema and CLI. Admitted
means its preregistered measurement, precision and gate obligations have been fulfilled with
independent evidence. Default-enabled means a separate reviewed enablement decision permits
automatic selection by the named shipped execution profile. Store admission and per-profile
default-enablement policy with RuleMeta and derive the resolver, generated schema and report
registry projection from that single source. Add the normative namespace when a rule is REGISTERED,
rather than waiting for ADMISSION. Registration alone never grants admission or automatic
default/strict-profile activation. Existing released rules retain their present status and
enablement policy; half-empty-page remains experimental and default-off, and strict retains its
existing activation of that released rule.

A registered but unadmitted candidate is off automatically in both default and strict. Explicit
rules:{id:true} or --only for a registered candidate is valid and records research opt-in
classification, selection origin and lifecycle status in the report. It does not grant admission or
default-profile acceptance. These are the existing explicit selection mechanisms, with proposed
lifecycle constraints and reporting; their current implementation does not yet supply those
constraints. The existing unregistered RESEARCH_RULES registry remains separate from the public
CLI/config/schema/SARIF. No new public toggle for that private validation registry is invented.
Every changed selection/registry/report contract still requires implementation controls before
exposure.

Baseline ALL remains its measured thirteen-rule registry. Candidate ALL explicitly enables EVERY
rule actually shipped in its registry, existing and new, using the registered default
coverage/gating semantics. Before the FIRST candidate acquisition, commit a complete candidate
rule-id/registry/lifecycle/selection manifest and keep it unchanged throughout that comparison.
Explicit registered but unadmitted candidates are included and carry their research opt-in
classification; this classification cannot remove their findings from the primary metric. The
default arms remain separately recorded. For each primary arm, N is EVERY reported finding,
including new findings and real-but-cosmetic findings; F retains the two registered adverse labels.
All new candidate findings require independent Claude, Gemini and Grok pixel labels under the
unchanged protocol. Useful rules or unknown candidates cannot be omitted to improve the ratio, and
low-value findings cannot be added to dilute it. A separately paired existing-thirteen ledger may be
disclosed as a SECONDARY diagnostic only; it cannot replace the primary ALL metric, change its
thresholds or modify old labels/denominators. Research-registry definitions that are not shipped
remain outside the public registry; they cannot silently count as shipped supported rules.

No actual candidate rule membership or primary freeze is established by this draft. Before the first
candidate acquisition, Root must review and commit the complete prospective rule-id declaration and
supported contracts. The existing baseline bytes and labels remain unchanged. Newly registered
legitimate true-/false-positive findings all require the independent label protocol; a candidate's
research classification is diagnostic and never a primary denominator exclusion. Figure/unreferenced
remains info-level/off automatically; half-empty-page retains its released experimental/default-off
policy. The two-error guard remains in force and no new error is approved.

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

Suppression is an additional reason-required annotation on a still-measured violation. Canonical
Report 6 retains every underlying finding and predicate.violated=true, severity, identity, coverage
and counts. Use a typed per-finding annotation with validated config-origin selection and nonempty
reason. Report 6 summary.suppressed is number|null, with a typed completeness/UNKNOWN reason. Fresh
validated complete annotation state may produce numeric zero; migrated Report 4/5 produces
null/UNKNOWN despite the original legacy summary.suppressed:0. Preserve the original legacy bytes
and declared value as historical input; that old placeholder does not prove a complete suppression
inventory.

JSON carries these canonical annotations. SARIF keeps the result, level, message, fingerprints and
measurements unchanged and projects the annotation only as a proprietary
result.properties.breaklintSuppression value with reason/origin/identity and violated=true. Do not
populate SARIF standard suppressions, accepted-dismissal state or an external suppression kind.
JUnit retains the existing failure for each annotated violation and annotates it in escaped
properties/system-out or its failure detail; suppression never produces skipped, reduces failures or
makes the testcase pass. Existing skipped for an actual coverage gap remains a distinct
unknown-measurement signal and is not used for an annotated measured violation.

Console, Markdown and HTML visibly show the retained violation plus its annotation/reason and
unknown completeness, while display grouping retains all occurrence ids and metric counts. Mandatory
facts add the annotated-subset count or UNKNOWN and its completeness, separately from findings and
not-measured counts. Context retains annotated violations and exposes bounded omissions. Comparison
never resolves a violation because it is annotated. failOn and experimental findings keep their
existing gate policy; inventory, coverage and infrastructure retain precedence. Annotation text is
escaped untrusted data and cannot authorize edits, commands or profile bypass.

Suppression does not change the exit verdict. Underlying findings still participate in unchanged
failOn and experimental-rule policy; fatal infrastructure, required inventory/evidence and coverage
retain precedence. Invalid config suppression is a usage error with no report. The proposed release
has config-origin annotations only and introduces no authored suppression/policy attribute. Real
engine/public-consumer controls for retained counts/exit, nonempty reason, escaped visibility and
UNKNOWN legacy reading are required before implementation; all remain **PENDING**.

### Configuration v2: discriminator, actual layers and immutable boundaries

Keep the proposed release grammar small: add a required contractVersion:2 discriminator to v2 files.
An absent discriminator is read as the unchanged v1 grammar, with only its existing accepted keys
and rules. A versionless file containing v2-only keys is rejected as usage; unknown/unsupported or
malformed explicit versions are rejected. The v2 generated schema and runtime reader use the same
registry and grammar. A valid versionless v1 input retains config.contractVersion=1, its permitted effective-config
shape and the v1 fingerprint domain. It cannot supply v2-only semantic or annotation settings.
Fresh acquisition uses the validated built-in semantic defaults and records their identity in
Report 6 measurementSemantics; those defaults are not fabricated as user-supplied v1 keys. Explicit
v2 input produces contractVersion=2, expanded effective semantic values and the v2 fingerprint domain.
These two reader paths and their compatibility require real controls before activation.

The only policy precedence remains defaults < selected built-in execution profile < validated JSON
config file < CLI. ConfigSource remains default/profile/config/cli, with a reported source for every
effective leaf. Semantic identification settings are a validated closed v2 config subset resolved
before acquisition, not additional include, alias or document-attribute layers. Remove proposals for
includes, policy aliases and new custom document attributes that set semantic profiles, suppression,
thresholds, rule enablement or floors. Native HTML/ARIA and captured source declarations remain
untrusted object-identification data under the validated profile, not a policy override or an
instruction. The proposed suppression selection is config-origin only; its source target is an
identity binding, not an authored configuration layer.

No layer supplies Proof-A threshold/options values. Other metrics remain registry-declared with
ranges. Effective floors are monotonic through every actual layer: max of the inherited floor and
each validated stricter request; a lowering request is rejected rather than silently clamped. Rule
enablement is distinct from metric options. Automatic default/strict enablement obeys the RuleMeta
admission and reviewed enablement policy; explicit config:true/--only for registered candidates
remains valid and records research opt-in classification. V2 fingerprint domain is
breaklint-effective-config-v2 plus the canonical effective semantic values; it excludes output
paths, model text, runtime counters and provenance. Invalid configuration is exit 2 with no report,
as currently contracted. No include/alias/attribute implementation is needed to satisfy this
version's design.

Before exposure, real public-consumer controls cover versionless v1 compatibility, explicit v2 reading,
unknown/malformed versions and keys, legitimate stricter floors, every actual layer's forbidden Proof-A
options and lower-floor attempts, stricter-profile downgrade rejection, effective-source reporting
and matching/reordered/different semantic fingerprints. Runtime validator and generated schema share
the same registry. These controls remain **PENDING**. Configuration Contract v1 does not gain unchecked
semantic keys or confuse semantic selectors with the existing HTML-tag exclusion list. No threshold,
floor, document timeout or runtime dependency changes in this refinement.

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
| AUD-09-02, high | Lock proof-source-A options and monotonic floors across the actual profile/config/CLI layers. Speculative include/alias/policy-attribute layers are removed from this revision; public-consumer rejection controls remain unrun. |
| AUD-09-03, high | Require Snapshot 6 collector semantics/provenance; legacy data stays unknown and comparisons cannot manufacture repair. Migration and identity controls remain unrun. |
| AUD-09-04, medium | Parse profile-dependent semantics at acquisition; retain canonical profile provenance and decline mismatch. Matching/mismatching stored-consumer controls remain unrun. |
| AUD-09-05, medium | Name proposed namespaces, inventory target and unavailable-data reasons with artifact/decision stamps. Registry/schema/migration controls remain unrun. |
| AUD-09-06, medium | Gate every placement/fragment/transform consumer on independent collector controls. Dependency acceptance remains outstanding. |
| AUD-09-07, medium | Require Report 6 for reason-required annotations; retain underlying findings, accounting and exit. Suppression controls remain unrun. |
| AUD-09-08, low | Keep every new candidate off by default, including strict, until registered gates and reviewed enablement. No default has changed. |

The label set, recall sweep, default/all-rules metrics and blinded improvement judgments remain
incomplete. This revised proposal authorizes no code, migration, new rule, schema or release.


## 9. Second fresh text audit: all eight dispositions OPEN

A second fresh Claude text design audit inspected the frozen public design `791385b22c1ffd8c9b36e5993ff8b676a6f65cc5`,
whose design source was 32,385 bytes, SHA-256
`225a0760e44beabe5603be93d3248305f99aad00a68e16e77b1d95e67a6d56ea`. Existing native output identifies
**claude-opus-5-5**, exit 0, and a saved text candidate before judgment parsing. It returned
**CONDITIONAL: three HIGH, four MEDIUM and one LOW finding**, with zero images. A qualified Gemini
text audit identifies **gemini-3.8-flash**, zero additional contradictions, and zero images. Its scoped
result cannot erase source-supported Claude issues or supply architecture acceptance. Actual model
identifiers are observed only for those bound historical outputs; this draft's contributing model
remains **UNKNOWN**.

The first conditional Claude design review in section 8 and this second conditional review are both
retained, including the new HIGHs. These are Phase B preimplementation text design reviews, not code-
package test/acceptance reports or C3 implementation verifier results. This document does not decide
stop-rule applicability or authorize further reviews; the registered stop rule remains unchanged for
Root's interpretation. No prior failed or terminally stopped scope is renamed, replaced or rerun.

The current refinements address proposed architecture contracts before the evidence-led scope and
admission freeze. They authorize no implementation or measurements. All eight dispositions below
remain **OPEN** until fresh independent audits examine the corrected frozen text and Root accepts the
evidence-bound dispositions. Proposed implementation controls are **PENDING**, not automatically
failed by this unexecuted draft. Their absence still means no implementation/migration/release claim.

| Finding | Proposed correction sections | Status and evidence still required |
| --- | --- | --- |
| DESIGN-R01-01, HIGH | §2 enum timing; §4 registry lifecycle and primary ALL membership; §5 actual config selection | OPEN. RuleMeta/schema/CLI lifecycle and namespace controls; explicit opt-in and source reporting; full candidate manifest before first acquisition; all new three-family labels. |
| DESIGN-R01-02, HIGH | §3 thirteen-rule facts/controls/declines inventory; §2 legacy reasons | OPEN. Independent physical/source oracles, observed red/green/mutation controls and fresh verification for every changed released consumer, including both Proof-A errors. |
| DESIGN-R01-03, HIGH | §3 cause-aware statuses/reasons/exits; §2 decision-v2 and reader compatibility | OPEN. Finite before/after default/strict controls, accepted witness visibility and independently justified 0/1→3/4 transitions. |
| DESIGN-R01-04, MEDIUM | §2 Report 6 inventory fields, separated counters and deterministic exitReason order | OPEN. All-unknown, mixed, complete-empty and ratio-passing unknown-witness real-engine controls; context reconciliation. |
| DESIGN-R01-05, MEDIUM | §2 fresh acquired Snapshot-6 demo and preserved handwritten legacy control | OPEN. Self-authored fresh source/provenance, real acquisition, live/stored parity and actual demo exit 1; migrated legacy accounting/UNKNOWN controls. |
| DESIGN-R01-06, MEDIUM | §2 mandatory Report 6 semantics and both comparison branches; §5 expanded semantic fingerprint | OPEN. Matching/mismatching collector/parser/profile/options, legacy readers, retained source identities and no manufactured resolved/deleted defect. |
| DESIGN-R01-07, MEDIUM | §5 Config v2 discriminator, v1 reading and four actual layers | OPEN. Schema/runtime compatibility and rejection controls; no include/alias/document-attribute policy implementation. |
| DESIGN-R01-08, LOW | §5 retained-violation reporter projections, mandatory facts and nullable legacy suppression | OPEN. JSON/SARIF/JUnit/human/context/comparison consumer controls; no suppression-induced dismissal, skipped or resolved result. |

**Phase A is INCOMPLETE.** Complete labels, recall confirmation, baseline/default denominators and
independent judgements are not established by this text. **No current migration PASS**, candidate
acquisition, primary membership freeze or new-version verdict exists. All unchanged registered metric,
cost, no-regression, exact-candidate gate, packed-consumer, complete blinded usefulness and report sight
review obligations remain outstanding. Workplan, saved reproduction, observed red-before/green-after,
mutation and fresh independent Opus verification precede any activation. Unknown facts stay UNKNOWN.
