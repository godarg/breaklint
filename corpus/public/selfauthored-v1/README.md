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
| sa03-transit-ridership-report | A4 + landscape named page | clipped bar value label (svg); 721 px figure on a 680 px landscape page; caption-only page (orphaned-continuation) | 1, 3 |
| sa04-essay-chapter-footnotes | Letter | none — clean control with footnotes | 0 |
| sa05-kitchen-notebook | Letter | none; multi-column keep-together lists and six forced pages | 4 |
| sa06-mobile-work-policy-de | A4, de | straight quotes, spaced hyphens, `file:` and absolute-path links | 0 |
| sa07-sensor-datasheet | Letter | two clipped plain labels; one clipped halo label | 1, 4 |
| sa08-tidewell-newsletter | A4 | none; multi-column, vertical-writing and `<use>` declines | 4 |
| sa09-queue-worker-tutorial | A4 | 2362 px keep-together listing, 3 fragments; 1390 px listing, 2 fragments (documented gap, allowed) | 1 |
| sa10-lagoon-oxygen-report | A4 | two clipped plain labels (one rotated); two clipped halo labels | 1, 4 |
| sa11-insect-chorus-survey | Letter | none; SVG traps (letterbox, overflow visible, defs, hidden text, halos inside) | 0, 4 |
| sa12-library-annual-report | Letter + landscape named page | 2331 px keep-together table, 3 fragments | 1, 3 |
| sa13-planning-forum-transcript | A4 | three-line tail page of a 97-line record; full middle pages must not fire | 0 |
| sa14-weather-station-install-guide | Letter | full-bleed keep-together band, 2344 px, 3 fragments; 320 px keep-together side tab copied onto five pages (must not fire) | 1 |
| sa15-hut-trail-guide-de | A4, de | clipped summit label; straight quotes, spaced hyphens, local links | 1 |
| sa16-lab-safety-manual | Letter | 1368 px sheet in 2 fragments (documented gap); table row left in the overflow column (observed) | 0, 1, 3 |
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

## Release semantics

> Expectations follow the documented semantics of the breaklint release that admits this corpus (0.7.0): e.g. content in Paged.js margin boxes (running()/fixed copies) is not in the flow and is not measured by any rule (docs/limitations.md 'unmeasured margin-box content'); layout/orphaned-continuation-page judges a page only where its content ends; layout/unbreakable-block-too-tall correlates fragments by flow membership, not coordinates.

This is the only class rule. `manifest.json` `releaseSemantics` repeats it verbatim. It never
changes pass or fail for a single entry: the gate below is defined for the admitting release.
Against a build that does not document these semantics, such as the 0.6.0 base where the copies of
a running element are summed as fragments, the entries that rest on them fail. That result says
the build is not the admitting release; it does not say the truth is wrong. Entries that rest on
the rule cite it in `why` or `docsBasis`: every `mustNotFire` of a running element, sa13's middle
pages and sa14's `#parts-band` and `#sidetab`. For tracing only (a gate does not read this): the
margin-box and flow-membership semantics are backlog item G-02 (work package WP-F1), and the
continuation-page semantics are G-15 (WP-F4).

## Targets

| target | matches |
|---|---|
| `{"id": X}` | the element or SVG `<text>` whose author `id` is X (resolve to its source span; a block finding matches when its source lies within that span). For `artifact/local-uri` it matches the URI-bearing attributes of X and of its descendants; an element without any (sa06 `#p-6-2`, sa15 `#gpx-pfad`) can never be matched, and its `why` says so |
| `{"ids": [...]}`, `{"selector": S}`, `{"selectors": [...]}` | the listed elements, or every element matching the CSS selector in the source document |
| `{"within": X}` | any finding whose source lies inside element X |
| `{"document": true}` | the whole document. `except` (a list of targets) carves findings out of it: the entry matches every finding of that rule in the document that matches none of the `except` targets. `except` is used only on `document` targets |
| `{"svg": X, "texts": [...]}` | the listed `<text>` ids whose nearest `<svg>` is X; `{"svg": X, "use": U}` a `<use>` instance |
| `{"uri": {"attribute": A, "value": V}}` | the resource reference with that attribute and raw (authored) value |
| `{"pageOf": {"id": X, "fragment": F, "resolvedPages": [...], "resolvedPagesByFontStack": {...}}}` | a finding whose `page` is in `resolvedPages` |
| `{"pages": "any page not named in mustNotFire"}` | a finding whose `page` is in none of the `resolvedPages` of the rule's `mustNotFire` `pageOf` targets (a page-level allowance) |

Combination. All keys of one target combine with AND: `{"uri": ..., "id": X}` is that attribute
of that element. A list-valued key (`ids`, `selectors`, `texts`, `except`) matches when any of its
items matches (OR). This OR applies only inside a target. The four lists of a rule are not OR
lists: every `mustFire` entry must be matched on its own, and every `mustNotFire` entry must hold on
its own.

Page targets. The canonical report has no page map: `pages` is a count, and the only page a
finding carries is `Finding.page`. So a gate never resolves a page target itself. `pageOf` names
the element (`id` only) and one of `fragment: "first"`, `"last"` or `"middle"` (every fragment
except the first and the last); `fragment` is required and has no default. `resolvedPages` is
already resolved in the expected file: the union, over the three font stacks of
`verification.fontStacks`, of the pages on which the construction probe placed those flow
fragments of X. `resolvedPagesByFontStack` shows the parts. A finding matches when its `page` is in
`resolvedPages`. Where the stacks disagree (sa03: page 6, or page 7 with DejaVu) the set is wider
than any single layout. In no rule do the `mustFire` and `mustNotFire` page sets overlap.

Declines. A required decline that names its targets (`ids`, or `svg` with `texts` or `use`) is
satisfied when each named target is declined with that reason. A required decline on a `document`
or `within` target is satisfied when that rule's declines with that reason inside the target add up
to `count` (the sum of `count` over the matching `notMeasured` rows). An entry with
`measuredAlternative: true` is satisfied per target either by the decline or by a measurement of
that target: an evaluation of that rule for the target with status `measured`, or a finding on it.
A measured target is then judged as if it were listed under `mustFire` or `mustNotFire` according
to its `ifMeasured`, and this counts for the closed-world check too. A decline with
`required: false` is checked only against `permittedDeclineReasons`.

## How a gate consumes this

This is the only gate procedure. `manifest.json` `gate.steps` repeats these five steps verbatim.

1. Read `manifest.json` and verify the SHA-256 and byte length of every file in `files`. Zero documents read is a failure, never a skip.
2. Run each document under the default profile and read the canonical JSON report.
3. If the document ended in exit 3, pass only if 3 is in `expectedExit.set` and the exit reason is `render-unstable`. A render-unstable run withholds its findings and reports no pages by design (`docs/limitations.md`), so the page and rule checks are skipped for that document. Any other exit 3 fails.
4. Otherwise the exit code must be in `expectedExit.set` and the report's `pages` must lie in `pages.range`.
5. Then, per rule: every `mustFire` entry is matched by at least one finding; no finding matches a `mustNotFire` target; every finding is matched by a `mustFire` or `allowed` entry of its rule, or is on a measured target whose `ifMeasured` is `mustFire` (closed world); every `required` decline is satisfied as the paragraph 'Declines' under 'Targets' defines, and a measured target with `ifMeasured: mustNotFire` has no finding; no decline carries a reason outside `permittedDeclineReasons`. `layout/half-empty-page` is not active in the default profile, so any finding of it fails.

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
entry. Errata E1 to E15 (2026-09-24) and E16 to E26 (2026-09-25) came from two independent reviews
before any breaklint run; E16 also applies an orchestrator decision, and E26 was found by the author
during the second round.

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
