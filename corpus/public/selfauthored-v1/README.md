# selfauthored-v1 — closed-world regression truth over self-authored documents

Twenty HTML documents that look like the products people actually print from HTML — guides, a
manual chapter, data and annual reports, a book chapter with footnotes, a cookbook, a newsletter,
a datasheet, a tutorial, scientific reports, a transcript, a catalogue, release notes, meeting
minutes, two of them in German — each with planted, construction-known defects and deliberate
clean controls, and a ground-truth file per document that was written **before breaklint was run
on any of them**.

**What this is not.** It is not calibration data and never feeds a threshold: the material is
`synthetic_first_party`, `realDocument: false`, and `docs/validation/corpus-contract-v1.md` says
synthetic construction truth never counts as real data. It is not external trust evidence. The
split is `regression`, deliberately outside the contract's calibration splits.

## Layout

```
manifest.json                 documents, hashes, features, gate summary, expectationHistory
documents/<id>.html           the artefacts: one self-contained file each (inline CSS and SVG,
                              no scripts, no external resources, generic font families only)
expected/<id>.expected.json   ground truth, format selfauthored-expected-v1 (below)
probe/construction-probe.mjs  the independent measurement used to verify construction facts
probe/construction-measurements.json
                              its condensed output on the reference renderer (see PROVENANCE.md)
PROVENANCE.md, RIGHTS.md
```

## The documents

| id | paper | planted defects (rule) | expected exit |
|---|---|---|---|
| sa01-riverbank-survey-handbook | A4 | stranded h3 on a fixed grid (heading-at-page-bottom) | 0 |
| sa02-pump-service-manual | Letter | 2340 px keep-together checklist, 3 fragments (unbreakable) | 1, 3 |
| sa03-transit-ridership-report | A4 + landscape named page | clipped bar value label (svg); 721 px figure on a 680 px landscape page; caption-only page (orphaned-continuation) | 1, 3, 4 |
| sa04-essay-chapter-footnotes | Letter | none — clean control with footnotes | 0 |
| sa05-kitchen-notebook | Letter | none; multi-column keep-together lists and six forced pages | 4 |
| sa06-mobile-work-policy-de | A4, de | straight quotes, spaced hyphens, `file:` and absolute-path links | 0 |
| sa07-sensor-datasheet | Letter | two clipped plain labels; one clipped halo label | 1, 4 |
| sa08-tidewell-newsletter | A4 | none; multi-column, vertical-writing and `<use>` declines | 4 |
| sa09-queue-worker-tutorial | A4 | 2362 px keep-together listing, 3 fragments; 1390 px listing, 2 fragments (documented gap, allowed) | 1 |
| sa10-lagoon-oxygen-report | A4 | two clipped plain labels (one rotated); two clipped halo labels | 1, 4 |
| sa11-insect-chorus-survey | Letter | none; SVG traps (letterbox, overflow visible, defs, hidden text, halos inside) | 0, 4 |
| sa12-library-annual-report | Letter + landscape named page | 2331 px keep-together table, 3 fragments (allowed: WP-F3 declines it) | 1, 3, 4 |
| sa13-planning-forum-transcript | A4 | three-line tail page of a 97-line record; full middle pages must not fire | 0 |
| sa14-weather-station-install-guide | Letter | full-bleed keep-together band, 2344 px, 3 fragments (allowed: WP-F3 declines it); 320 px keep-together side tab copied onto five pages (must not fire) | 1, 4 |
| sa15-hut-trail-guide-de | A4, de | clipped summit label; straight quotes, spaced hyphens, local links | 1 |
| sa16-lab-safety-manual | Letter | 1368 px sheet in 2 fragments (documented gap); table row left in the overflow column (observed) | 0, 1, 3, 4 |
| sa17-seed-bank-grant-proposal | A4 | label outside the left edge; label clipped by a nested SVG; stranded h4 | 1 |
| sa18-hand-tools-catalogue | A4 | none; tall cards that fit (up to 950 of 971 px), halos inside | 0, 4 |
| sa19-release-notes | Letter | `file:` link, `file:` xlink:href, root-relative absolute path | 0, 3 |
| sa20-wiki-meeting-minutes | A4, no `lang` | straight quotes, spaced hyphens, a three-glyph last line (`Ok.`) | 0 |

Feature coverage (both page sizes, named landscape pages, running elements in top and side margin
boxes, string-set, counters, footnotes, multi-column, vertical writing, tables crossing pages,
code over pages, halo and plain SVG labels, full bleed, the long-leading class) is listed per
feature in `manifest.json` under `featureCoverage`.

## Expected files (`selfauthored-expected-v1`)

Each file binds its document by `sha256` and carries:

- `paper`, `pages.range` (with the basis for the range) and `expectedExit` (`set`, `derivation`,
  `byCode`), all under the **default profile** (`fail-on error`, coverage floors error 1, warn 0.5);
- `rules`: an entry for each of the thirteen registered rules with four lists:
  - `mustFire`: at least one finding of that rule must match the target. `occurrences`, where
    given, is the number of planted instances inside the target. It is informational: the rule
    pages do not fix whether a tool reports one finding per mark or one per text run, so a gate
    may print a count that differs from it but never fails on that;
  - `mustNotFire`: no finding of that rule may match the target;
  - `allowed`: findings matching the target are permitted, never required
    (`class`: `font-dependent`, `documented-gap` with `constructionTruth: "defect"`,
    `heuristic-boundary`, `docs-silent`);
  - `expectedDeclines`: `reason` from `src/core/enums.ts` `ENV_IDS`, `required`, `count`,
    `countsTowardCoverage`. `count` is the number of candidates the construction declines under
    that reason inside the target. A decline is `required: true` only where a rule page,
    `docs/limitations.md` or this README states it; a decline that rests only on a rule's
    `declines` list in the source is `required: false` (a correct tool may measure instead).
    Entries with `measuredAlternative: true` (the halo and `<use>` labels) carry the construction
    truth for a tool that measures the target: `ifMeasured` on the entry, or per text in
    `perText[].ifMeasured`;
- `permittedDeclineReasons`, `constructionFacts` (the arithmetic), `runningElements` (visible
  margin-box copies; a 0 x 0 copy on a page whose `:first` rule sets the margin box to
  `content: none` is listed under `zeroSizeCopyPages`, not counted), `features`, `verification`
  (renderer, fonts, residue seen by the probe) and `notes`.

No entry carries a dependency marker of its own. The semantics every entry assumes are stated once,
in the next section.

## Field list

This list is closed: an expected file contains exactly these keys, and a gate fails a file with a key
it does not name, at every level listed here. **N** marks a key the gate interprets (normative);
**I** marks one it only checks for presence and type (informational). A value marked *opaque* is
informational JSON whose inner keys are not constrained and never read by a gate.

Top level (all keys required):

| key | | type and meaning |
|---|---|---|
| `schemaVersion` | N | `"selfauthored-expected-v1"` |
| `documentId` | N | the document id, equal to `manifest.json` `documents[].id` |
| `artifact` | N | path of the document, relative to this directory |
| `sha256`, `byteLength` | N | the document's bytes; must match the artifact |
| `authoredOn` | I | date the truth was first written |
| `provenanceClass` | I | `"synthetic_first_party"` |
| `calibrationEvidenceEligible` | I | `false` |
| `title`, `genre`, `fontDependence` | I | strings |
| `language` | I | `{htmlLang: string or null, typeRulesUnderDefaultLocale: string}` |
| `paper` | I | array of `{pageRule, size, orientation, pageBoxCssPx, margins, contentBoxCssPx}` with optional `selector` (what selects a named page), `observed` (what the renderer did) and `note` |
| `profile` | N | `"default"` |
| `pages` | N | object: `range` (N: `[lo, hi]`, both ends included), `measured` (I: the probe's page count), `basis` (I) |
| `expectedExit` | N | object: `set` (N: exit codes), `derivation` (I), `byCode` (I: map from exit code, as a string, to an explanation), `environmentNote` (I) |
| `features`, `notes` | I | arrays of strings |
| `runningElements` | I | array of `{id, marginBox, marginBoxCopies, pages}` with optional `zeroSizeCopyPages` and `zeroSizeCopyNote` |
| `constructionFacts` | I | array of `{fact}` with optional `arithmetic` (string) and `measured` (opaque) |
| `rules` | N | exactly the thirteen registered rule ids; each `{mustFire, mustNotFire, allowed, expectedDeclines}` (N, arrays) with optional `notes` (I, array of strings) |
| `parityBlankPages` | N | object: `count` (N: pages Paged.js inserts blank for parity; the number of `env/parity-blank-page` rows with `ruleId: null` must add up to it), `byFontStack` (I: those pages per font stack), `basis` (I) |
| `permittedDeclineReasons` | N | reasons a decline row of any rule of this document may carry |
| `notActiveInDefaultProfile` | N | rule ids that must produce no finding |
| `verification` | I | object: `method`, `browser`, `pagedjs`, `measuredOn`, `pageCount`, `pageCountByFontStack` (map from stack label to page count), `pdfPageCount`, `contentBoxHeightsPx`, `platformFonts` (opaque), `overflowColumnResidue` (array of `{page, kind, tag, id, cls, text, left, width, height}`), `fontStacks` (`{reference, dejavu, free}`) |

Entries. Required: `target` and `why` in `mustFire`, `mustNotFire` and `allowed`, and `class` in
`allowed`; `target`, `reason` and `required` in `expectedDeclines`, and `count` when `required` is
true. Every other key is optional:

| list | N keys | I keys |
|---|---|---|
| `mustFire` | `target` | `why` (required), `occurrences` (planted instances in the target), `text` (the planted text), `construction`, `measured` (opaque), `docsBasis`, `observed` (renderer behaviour the entry rests on), `underContentExtentLowerBound` (why the entry holds under the WP-F3 bound) |
| `mustNotFire` | `target` | `why` (required), `docsBasis`, `measured` (opaque), `construction` |
| `allowed` | `target`, `class` (`font-dependent`, `documented-gap`, `heuristic-boundary`, `docs-silent`) | `why` (required), `constructionTruth` (`"defect"`, with `documented-gap`), `text`, `construction`, `measured` (opaque), `docsBasis` |
| `expectedDeclines` | `target`, `reason`, `required`, `count` (required when `required` is true), `measuredAlternative`, `ifMeasured`, `perText` | `countsTowardCoverage`, `why`, `docsBasis`, `future`, `measured` (opaque) |

`perText[]` (only with `measuredAlternative`): `id` and `ifMeasured` (N); `why`, `strokeWidthPx` and
the opaque `cellInsetsPx`, `fillInkInsetsPx` and `paintedInkInsetsPx` (I).

Targets use only the keys of the Targets table, in one of these shapes: `{id}`, `{ids}`, `{selector}`,
`{selectors}`, `{within}`, `{document}` or `{document, except}`, `{svg, id}`, `{svg, texts}`,
`{svg, use}`, `{uri, id}`, `{pageOf}`, `{pages}`. `uri` is `{attribute, value}`; `pageOf` is
`{id, fragment, resolvedPages, resolvedPagesByFontStack}` (the last one I, a map from stack label to
pages); every `except` item is `{id}`.

## Release semantics

> Expectations follow the documented semantics of the breaklint release that admits this corpus (0.7.0): e.g. content in Paged.js margin boxes (running()/fixed copies) is not in the flow and is not measured by block, line or page rules (docs/limitations.md, the 'Margin-box content.' bullet; the type rules still read a running element's source text once, and SVG in a margin box is still collected); layout/orphaned-continuation-page judges a page only where its content ends; layout/unbreakable-block-too-tall correlates fragments by flow membership, not coordinates.

This is the only class rule. `manifest.json` `releaseSemantics` repeats it verbatim. It never
changes pass or fail for a single entry: the gate below is defined for the admitting release.
Against a build that does not document these semantics, such as the 0.6.0 base where the copies of
a running element are summed as fragments, the entries that rest on them fail. That result says
the build is not the admitting release; it does not say the truth is wrong. Entries that rest on
the rule cite it in `why` or `docsBasis`: every `mustNotFire` of a running element, sa13's middle
pages and sa14's `#parts-band` and `#sidetab`. None of the 16 running elements contains SVG, a
straight quotation mark or a spaced hyphen, so the type and SVG rules that still read them have
nothing to report there.

For tracing only (a gate does not read this list):

- margin-box content and flow membership: backlog item G-02, work package WP-F1;
- the continuation-page semantics: G-15, WP-F4;
- the split-block bound: G-03 and G-81, WP-F3. It replaces the structural sum over three or more
  fragments with a lower bound from the content extent of each fragment (text lines and replaced
  content). Its second round declines, as `env/invalid-measurement` and against the coverage floor,
  a split block with a flow hazard inside, on or around it (positioned, offset, transformed,
  floated, multi-column, flex or grid, table rows of two or more cells, vertical writing, negative
  block margins, overflowing replaced content), a split block whose bound is inconclusive, and an
  unsplit block that is transformed or reaches past the sheet. So sa12 `#members-roll` (table
  columns) and sa14 `#parts-band` (floats) are allowed documented gaps rather than `mustFire`, the
  landscape rows of sa03 and sa12 and the sa16 sign-off sheet carry non-required declines, and the
  exit sets of sa03, sa12, sa14 and sa16 admit 4. The other split `mustFire` blocks (sa02, sa03,
  sa09) have no hazard and hold under the bound; each says why in `underContentExtentLowerBound`;
- documents with `float: footnote` (sa04, sa17): G-79, WP-F5, which is in scope for this release.
  On current builds every footnoted document exits 3 with `injection-interference`. That is a
  dependency, not an allowance: their exit sets do not admit 3.

## Targets

| target | matches |
|---|---|
| `{"id": X}` | a finding whose source lies within the span of the element or SVG `<text>` whose author `id` is X. An inline element without a source id of its own (sa06 and sa15 `#span-en`) can never be matched, because findings in it carry the enclosing block's range; its `why` says so. For `artifact/local-uri`, see below |
| `{"ids": [...]}`, `{"selector": S}`, `{"selectors": [...]}` | the listed elements, or every element matching the CSS selector in the source document |
| `{"within": X}` | any finding whose source lies within the span of element X, inclusive: X itself is included |
| `{"document": true}` | every finding of that rule in the document, including findings whose `source` is null. `except` (a list of targets) carves findings out of it: the entry matches every such finding that matches none of the `except` targets. `except` is used only on `document` targets |
| `{"svg": X, "texts": [...]}` | a finding whose source lies within the span of one of the listed `<text>` elements (each has X as its nearest `<svg>`) |
| `{"svg": X, "id": T}` | a finding whose source lies within the span of the `<text>` element T. X is T's nearest `<svg>` ancestor; that holds in every such target (the eight SVG `mustFire` entries), and a gate that finds otherwise fails the entry. The same holds for every id in `texts` |
| `{"svg": X, "use": U}` | a finding whose source lies within the span of the `<text>` element that the `<use>` element U references (sa08: `#en-unit` references `#en-unit-def`) |
| `{"uri": {"attribute": A, "value": V}}` | an `artifact/local-uri` finding for that attribute and raw (authored) value, matched through its message (below) |
| `{"pageOf": {"id": X, "fragment": F, "resolvedPages": [...], "resolvedPagesByFontStack": {...}}}` | a finding whose `page` is in `resolvedPages` |
| `{"pages": "any page not named in mustNotFire"}` | a finding whose `page` is in none of the `resolvedPages` of the rule's `mustNotFire` `pageOf` targets (a page-level allowance) |

Identity. Every id a target names (`id`, `ids`, `within`, `svg`, `texts`, `use`, `pageOf.id`, the ids in
`except`) occurs exactly once in its document; a target whose id occurs twice, or not at all, fails
its entry. Within one list of one rule no target repeats (targets compared as canonical JSON; in
`expectedDeclines` the target together with `reason`). Across the lists of one rule, `mustFire`,
`mustNotFire` and `allowed` share no target; a target of `mustFire` or `allowed` may also appear in
`expectedDeclines`, where it says the block may be declined instead.

Combination. All keys of one target combine with AND: `{"uri": ..., "id": X}` is that attribute
of that element. A list-valued key (`ids`, `selectors`, `texts`, `except`) matches when any of its
items matches (OR). This OR applies only inside a target. The four lists of a rule are not OR
lists: every `mustFire` entry must be matched on its own, and every `mustNotFire` entry must hold on
its own.

Source spans. The span of an element is its HTML5 tree-construction element range in the source
document, from the `<` of its start tag to the end of its end tag (where tree construction closes an
element whose end tag is omitted, it ends there), counted in UTF-8 bytes. That is the coordinate
system of `SourceRef` (`utf8-bytes-unicode-codepoints-v1`). A finding's source lies within a span
when the span starts at or before `source.offset` and `source.endOffset` is at or before the span's
end.

`artifact/local-uri`. Its findings carry `source: null` (`src/rules/artifact/local-uri.ts`); the only
handle is `Finding.message`, which contains `attribute="rawValue"` with the attribute's local name as
the HTML parser reports it, so `xlink:href` appears as `href`. "Raw" means the attribute value as the
HTML parser returns it: character references decoded, nothing else changed (no trimming, no URL
resolution, no normalisation). No URI-bearing attribute in the corpus contains a character reference,
so the decoded and the authored bytes are the same. A `uri` target matches a finding whose
message contains the exact string `L="V"`, where `L` is the local name of `uri.attribute` (sa19's
`xlink:href` is compared as `href`) and `V` is `uri.value`. An `id` target matches a finding whose
message contains `L="V"` for a URI-bearing attribute (`href`, `src`, `poster`, `data`, `xlink:href`)
of X or of one of its descendants. `srcset` is out of scope: no document has a `srcset` (nor a
`poster` or `data`) attribute, so no target names one; a gate may reject such a target. An element without any such
attribute (sa06 `#p-6-2`, sa15 `#gpx-pfad`) can never be matched, and its `why` says so. Where a
target has both `uri` and `id`, the pair is an attribute of X; that holds in every such target. In
every document each local URI value occurs exactly once and no attribute and value pair repeats, so
matching by message is unambiguous. The corpus has no CSS `url()` reference.

Page targets. The canonical report has no page map: `pages` is a count, and the only page a
finding carries is `Finding.page`. So a gate never resolves a page target itself. `pageOf` names
the element (`id` only) and one of `fragment: "first"`, `"last"` or `"middle"` (every fragment
except the first and the last); `fragment` is required and has no default. `resolvedPages` is
already resolved in the expected file: the union, over the three font stacks of
`verification.fontStacks`, of the pages on which the construction probe placed those flow
fragments of X. `resolvedPagesByFontStack` shows the parts. A finding matches when its `page` is in
`resolvedPages`. Where the stacks disagree (sa03: page 6, or page 7 with DejaVu) the set is wider
than any single layout. In no rule do the `mustFire` and `mustNotFire` page sets overlap.

Declines. The report's decline rows (`notMeasured`) carry `{scope, ruleId, reason, target, count}`,
and their `target` cannot be matched to an entry: block rules pass none, a row that stands for more
than one target has it set to null, and the SVG rule writes one row per `<svg>`. Declines are
therefore checked by count, per rule and reason, never per target:

- For each rule R and reason Q with `required: true` entries, the sum of `count` over the document's
  `notMeasured` rows with `ruleId` R and `reason` Q must equal the sum of `count` over those entries.
- Entries with `measuredAlternative: true` are all or nothing per rule and reason. If the report's
  sum equals the entries' total, their targets are declined. If it is 0, their targets are measured,
  and each is judged by its `ifMeasured` through findings matched by source: a `mustFire` target
  needs a finding, a `mustNotFire` target must have none, and those findings count as covered for
  the closed-world check. Any other sum fails.
- A decline with `required: false` is checked only against `permittedDeclineReasons`; its `count`
  is the construction's expectation and is informational.

Evidence-level declines. Rows with `ruleId: null` are outside this corpus's closed world. The
build writes two of them, both from the evidence overlay (`src/render/evidence.ts`):
`env/evidence-fragment-outside-page` (scope `page`: a mark for a block whose fragment lies outside the
page, so evidence cannot bind it there) and `env/evidence-overlay-removed` (scope `document`: the
overlay was installed but binding was not possible). They say whether the evidence overlay could be
bound to the rendered PDF, which depends on the rasteriser, the evidence options and the environment,
not on what a rule measured in the document's construction. The construction probe does not model
evidence binding, so the corpus holds no truth about them and lists none. A gate therefore leaves
rows with `ruleId: null` out of every per-rule check (the counts above and `permittedDeclineReasons`).
A third evidence-level reason, `env/parity-blank-page` (scope `page`, added by WP-F5), excuses a page
that Paged.js inserted blank for parity from the binding requirement, and only when five checks
prove the page empty. Whether it is emitted still depends on the binding checks, but whether a
document has such a page is a construction fact. So this row is checked by count against the
normative `parityBlankPages.count` of the expected file: the sum of `count` over the rows with
`ruleId: null` and this reason must equal it. In this corpus it is 0 for every document: no element
has `break-before` or `break-after` `right`, `left`, `recto` or `verso`, and the probe found no
`pagedjs_blank_page` under any font stack. A gate fails a row with `ruleId: null` whose reason is
none of these three, or whose scope is not `page` or `document`. The effect of all three on the exit
is not exempt: the exit must still be in `expectedExit.set` (`expectedExit.environmentNote` names
the one environment outcome, `evidence/required-page-binding-incomplete`). The rule-level decline
`env/parity-blank-page` (for example of `layout/orphaned-continuation-page`) is in no document's
`permittedDeclineReasons`, for the same construction reason.

Invariant, true in every expected file: for one rule and reason the entries are either all
`required: true` or all `required: false`, and either all `measuredAlternative` or none; every
`measuredAlternative` entry's `count` equals the number of its targets. No rule and reason mixes
halo and `<use>` entries.

## How a gate consumes this

This is the only gate procedure. `manifest.json` `gate.steps` repeats these five steps verbatim.

1. Read `manifest.json` and verify the SHA-256 and byte length of every file in `files`. Zero documents read is a failure, never a skip.
2. Run each document in its own invocation under the default profile and read the canonical JSON report. The document's exit is that invocation's exit code, and its exit reason is `documents[0].exitReason`.
3. If the document ended in exit 3, pass only if 3 is in `expectedExit.set` and the exit reason is `render-unstable`. A render-unstable run withholds its findings and reports no pages by design (`docs/limitations.md`), so the page and rule checks are skipped for that document. Any other exit 3 fails.
4. Otherwise the exit code must be in `expectedExit.set` and the report's `pages` must lie in `pages.range`, both ends included.
5. Then, per rule: every `mustFire` entry is matched by at least one finding; no finding matches a `mustNotFire` target; every finding is matched by a `mustFire` or `allowed` entry of its rule, or is on a measured target whose `ifMeasured` is `mustFire` (closed world); the decline counts hold as the paragraph 'Declines' under 'Targets' defines, and a measured target with `ifMeasured: mustNotFire` has no finding; no decline row of that rule carries a reason outside `permittedDeclineReasons` (rows with `ruleId: null` follow the paragraph 'Evidence-level declines'). `layout/half-empty-page` is not active in the default profile, so any finding of it fails.

The expected exits are derived from the documented exit semantics only: an error finding is 1;
insufficient coverage (4) outranks findings; a table left in the paginator's overflow column is 3.
Where a documented capability is missing today (halo labels decline) the set contains both the
current and the post-capability exit, and the conditional declines (`measuredAlternative`) carry
the truth for the day the capability lands. Tables that cross pages admit 3 as "may be declined as
unmeasurable"; the plain probe saw residue only in sa16.

## Font dependence

Only `serif`, `sans-serif` and `monospace` are used. Findings depend on which fonts the renderer
resolves: every construction fact is built from explicit heights, fixed line pitches, forced
breaks or SVG coordinates, and every font-dependent outcome (widows, orphans, hyphens at page
boundaries, short last lines, word spacing in justified text, text tails) is listed as `allowed`.
SVG labels are planted at least 3 px clear of every edge on both the `getBBox()` cell box and the
pixel ink box; most are far clearer (see `measured` in each entry). The clearances and the page
ranges were checked with the machine's fonts and with two substitutions (`probe/fontconfig/`:
Liberation rejected, and Liberation plus DejaVu rejected in favour of FreeFont); the recorded
insets are the minimum over the three, and `verification.pageCountByFontStack` gives the page
counts.

## Changing the truth

The truth is frozen with the documents. It is never edited to make a gate pass. If a construction
fact or an expectation turns out to be wrong, add a dated entry to `manifest.json`
`expectationHistory` (id, date, what changed, why, previous value, source) in the same change that
edits the expected file, and change the document's bytes only together with a new hash and a new
entry. Errata E1 to E15 (2026-09-24), E16 to E26 and E27 to E35 (2026-09-25) came from three independent
reviews before any breaklint run; E16 also applies an orchestrator decision, and E26 was found by
the author during the second round. E36 to E41 (2026-09-25) are rulings on the gate author's
specification questions; E41 adds the construction fact `parityBlankPages` and changes no other
truth value.

## Reproducing the construction measurements

```bash
# as an unprivileged user, with Chrome's sandbox on
node corpus/public/selfauthored-v1/probe/construction-probe.mjs \
  --chrome /path/to/chrome --out /tmp/probe --keep-pdf \
  corpus/public/selfauthored-v1/documents/*.html
# the same with a font substitution
FONTCONFIG_FILE=corpus/public/selfauthored-v1/probe/fontconfig/free.conf node ...
```

The probe uses puppeteer-core, the Paged.js 0.4.3 UMD bundle and pngjs, nothing from `src/`.

## Paged.js behaviour found while building the corpus

Measured with the probe on Chromium 141 and kept out of the committed documents unless a
document is about it:

- An element with an inline `style` attribute that does not set `display` is marked
  `data-undisplayed`, and `break-after: avoid` of the element before it is then not propagated.
- `break-after: avoid` directly before a keep-together block taller than a page leaves that block
  in the overflow column and repeats it (residue).
- A single `<svg>` taller than the page whose children lie below the page edge is split inside the
  SVG and repeated on several pages.
- A page break inside one multi-line text node of a `<pre>` left part of that text box in the
  overflow column (the fragment's box spanned several columns); one block span per line breaks
  cleanly.
- `@page name { size: ... landscape }` lays out a landscape content box on a portrait sheet: the
  PDF pages stay portrait and the landscape content is clipped (sa03, sa12).
- `getBoundingClientRect()` of a nested `<svg>` is the union of its viewport and the content that
  overflows it (sa17), not its viewport.
- A keep-together table whose row lands on a sub-pixel page boundary can be left in the overflow
  column: that row is missing from the page (sa16, row `so-42`).
