# HTML reporting

The JSON report is breaklint's canonical record. The HTML report is a self-contained,
evidence-first projection for review, attachment to a build artifact and A4 printing.

## Information order

The first screen answers four questions before it shows implementation detail:

1. What verdict did the run reach?
2. What did that verdict do to the build gate?
3. How many errors, warnings and informational findings exist?
4. Did the measured coverage meet the configured floors?

The four operational states use different headings and sentences, not colour alone:

| Verdict | Heading | Exit |
|---|---|---:|
| `clean` | `Clean run` | 0 |
| `findings` | `Findings block this run` | 1 |
| `infrastructure` | `Checker failed` | 3 |
| `insufficient-coverage` | `Not enough was measured` | 4 |

Infrastructure and coverage failures explicitly say that the result is not clean. Findings still
present in either state are labelled as partial: they do not describe everything the checker might
have found after a trustworthy complete run.

The Coverage Trust summary follows the run verdict, not only the arithmetic of rows produced before
failure. An infrastructure run therefore always says `Not trustworthy`. If partial counters exist,
it reports them as partial measurement, for example `24 of 26 candidates measured before the
checker failed`; it never upgrades those counters to `Coverage met`.

The same verdict-first rule applies to exit 4. A zero-candidate rule has no per-rule floor shortfall
and is therefore represented as `ok: true` in canonical JSON, but a run in which no rule measured a
candidate is still `insufficient-coverage`. Its primary HTML summary says `Not established`, never
`Coverage met`. This preserves both truths instead of allowing a row-level arithmetic fact to
overwrite the run verdict.

## Finding grammar

Each finding is a vertical `article`, in this order:

```text
severity and experimental status
rule and page
complete explanation
document and measured source, if known
measured value and threshold
calibration and proof source
evidence status and ambiguity
```

An unknown source remains unknown. The HTML renderer does not invent a filename or line. Evidence
is clickable only when its path matches the relative page-artifact form minted by breaklint. Other
references remain visible as inert text.

## Untested remediation advice

Every rule in this package declares remediation advice, and no trigger/remedied pair in the package
shows any of it removing its finding (`remediation.tested: false`). The report says so **once**,
directly under the Findings heading, at body size and body-text colour, with the count it applies
to ("this applies to 7 of 7 findings with advice"). Each finding's remediation box then carries a
compact `untested` marker at the advice's own size in body-text colour, instead of a muted
small-print sentence repeated in every finding (seven times in each finding-bearing PDF before).
The surface gate counts the long sentence in each PDF's text — exactly once per finding-bearing
state, never in the clean state — and checks every marker's computed colour and size in every
cell; `broken-untested-repeat` and `broken-untested-marker` are its red controls.

## Responsive and print behaviour

- Findings never use a table or horizontal scrolling.
- Coverage is one aligned table per document: the document path and verdict are the caption, the
  rule id is the row header, candidates, measured, not measured, coverage and floor are
  right-aligned tabular numbers, and the result is text — "Below floor" in words, weight and colour,
  with a strong edge on its row header. It replaced one six-label card per rule (78 repeated labels
  for 13 rules, five printed pages). On narrow screens (≤ 30 rem) the same table becomes a two-line
  grid per row on one shared five-column template, so columns still align and nothing scrolls
  sideways.
- Body text remains 16 CSS pixels and long paths may wrap anywhere.
- Commands and rule ids are `<code>` that cannot break where a break changes what is copied. A
  command such as `--disable layout/widow` is carried in the HTML model apart from the prose around
  it and rendered as one `cli-flag` element; a rule id never breaks at a hyphen inside its name. On a
  narrow screen the only permitted break is after the namespace slash (a `<wbr>`, which adds no
  character); print keeps every command and rule id on one line. The surface gate measures the
  rendered lines of every command and rule id per character in every cell and in print, and reads
  each PDF's text for a line ending inside a flag or rule id (`broken-flag-wrap` and
  `broken-rule-id-wrap` are its red controls). In 0.6.0 the one printed command broke as
  `--` / `disable layout/widow`.
- Keyboard focus uses a visible three-pixel-equivalent outline.
- Landmarks are named and separate: the verdict header is the banner, a contents navigation named
  "Report contents" follows it, the report body is `main`, and the footer is the content info. The
  first keyboard stop is a skip link to `main`, visible when focused. The contents navigation links
  every rendered section, including "Findings (n)" and "Coverage details" — on a phone they start
  three and twelve screens down. Print omits both.
- The report follows the operating-system light/dark preference and honours reduced motion.
- Print forces the light palette, uses an A4 page with 12 mm margins and keeps finding evidence in
  the normal vertical flow. A finding fragments between its units and never inside one: its head
  (severity, rule and message) kept with its facts (six facts in three columns, one unit under
  their rule), and its tail (remediation, note and evidence); a split card repeats its frame on
  both pages. The tail opens with a print-only label, "Finding 07 · `artifact/local-uri` · remediation
  and evidence", so the fragment that begins a page says whose it is; the surface gate rejects any
  page that opens on a bare fact or tail line instead (`broken-continued-label`). Before, a split
  finding could leave its facts' top rule alone at the foot of a page and open the next on a bare
  fact in an unlabelled frame. Whole, page-atomic findings (60–73 % of a page
  each) meant one finding per printed page and pages filled to 29–45 % in 0.6.0. Boxed blocks —
  header, contents, summary, run facts, alert, checker card, empty state, finding, coverage table
  and footer — share one left and one right edge, and each is separated from the next by a gap; the
  72ch measure applies to the text inside them. A coverage row never splits,
  the column header repeats on a continuation page, a caption and column header never end a page
  without the first row, and the last two rows of a table never part.
  Printed content never exceeds the 703 CSS px content box: wider content makes Chrome scale the
  whole printed document down to fit, silently.
- Every printed page carries "Page N of M", and every page from the second a running head with the
  verdict, the exit code and the report's run id (`breaklint · Checker failed · exit 3` /
  `run <runId>`), in CSS `@page` margin boxes inside the 12 mm margin, so the content box is
  unchanged. The run id is also shown in the header's tool line and in the end mark. Because the run
  id is caller-supplied through the API it reaches the page's CSS only through a string escaper that
  emits `[A-Za-z0-9 ._:/-]` literally and everything else as a six-digit hex escape; a technical
  probe prints a hostile run id (`"; } body { display: none } /* </style><script>…`) and must find
  it as literal text in the running head with the report's layout unchanged. The footer prints as
  the end mark ("End of report. … JSON remains the canonical report."), on the final page and never
  alone there. Engines without margin-box support (Chromium before 131) print no folio.
- The clean state prints its findings section too, and every findings lead states the count in
  words ("0 findings. The requested checks completed …", "Partial findings only: 7 findings. …").
  It used to be omitted from print so that the duplicate block could not push one atomic coverage
  card onto a nearly empty terminal page; with coverage as a table that reason is gone, and a
  printed clean report without a findings heading reads as if the section was lost.
- The surface gate reads the furniture back from each PDF's text (renderer, and the verifier
  independently from the documented verdict table and page 1's run id): the folio on every page,
  the running head on every page from 2, the clean state's "Findings" heading and "0 findings", and
  the end mark on the final page only, with report content beside it. `broken-folio`,
  `broken-running-head`, `broken-clean-findings` and `broken-end-mark` are its red controls.

## Design tokens

Both HTML renderers — the report and the bundle view's `report.html` — take every custom property
from one token table, `src/report/html-tokens.ts`, under the breaklint prefix `--bl-`. Until 0.6.0
the report reused the parent brand design system's prefix and the bundle view used unprefixed
names; the decision recorded here is to fork: the report is a public MIT product surface, not an
instance of that design system, no code links the two, and a shared or bare prefix invites silent
cascade collisions when a host page embeds a report. The two renderers keep separate palettes (the
bundle view has an explicit `theme` option and is outside the reviewed matrix) but share the module,
the generator and the lint.

A stylesheet lint in `npm test` holds both stylesheets to: one prefix, and no parent-system prefix
anywhere in `src/`; every declared token consumed and every `var()` declared; no colour literal
outside the generated token blocks; and dark and print blocks that redefine the complete colour set
of the light block. Every foreground/background pair the report sets text in — including text on
the `soft` background of the alert, the remediation box and the frequency note — is measured
against WCAG AA from the table per theme and, in the surface gate, from computed style in every
cell (`broken-soft-contrast` darkens only `soft` and must fail it). Each lint rule has a red control
in the same test.

## Typography

The report ships no font file and adds no dependency. It declares a system-font strategy in three
roles whose generic families differ, so a missing face can degrade a role but cannot merge two of
them: **display** (h1, h2) is a serif, **body** a sans-serif, **mono** a monospace for identifiers,
paths and measured values. A dense evidence report is almost entirely sans and mono text of similar
size; a serif display face gives headings a second axis of contrast besides size and weight, and
that axis survives the compressed print scale. Until this release display and body were both sans
stacks that resolved to the same face on Linux (Liberation Sans), so the hierarchy collapsed
silently on the platform that generates most reports.

The stacks and the faces each role is declared to resolve to per platform live in
`REPORT_FONT_ROLES` (`src/report/html-tokens.ts`):

| Role | Generic | Linux | macOS | Windows |
|---|---|---|---|---|
| display | serif | Liberation Serif, DejaVu Serif | Iowan Old Style, Charter, Georgia | Georgia, Cambria |
| body | sans-serif | Liberation Sans, DejaVu Sans | Helvetica Neue, Helvetica, Arial | Arial |
| mono | monospace | DejaVu Sans Mono, Liberation Mono | SF Mono, Menlo | Consolas |

Rendering is therefore deliberately not identical across operating systems; the hierarchy is. The
surface gate compares what each role actually resolved to with this declaration, not merely display
against body: in every screen cell and in print the renderer reads the platform font of every
probed element per role from the browser's layout (CDP), and the verifier independently reads the
faces embedded in each PDF (`pdffonts`) and requires every face to belong to exactly one declared
role and each role to be present. A display role that falls back to the body face fails, and so does
one that falls back to a *different* sans (`collapsed-display-font` and `accidental-display-font`
controls). The resolved faces are recorded per cell and summarised as `resolvedFonts` in the render
manifest. Measured on Linux with Chromium 141: display Liberation Serif, body Liberation Sans, mono
DejaVu Sans Mono; the four PDFs embed exactly LiberationSerif-Bold, LiberationSans(-Bold) and
DejaVuSansMono(-Bold). macOS and Windows have not been measured by this gate yet.

## Trust and privacy boundary

The document contains inline CSS only. It has no scripts, external fonts, external stylesheets,
telemetry or network-loaded assets. Its Content Security Policy disables all resources except the
inline stylesheet and same-directory/data images. Paths still pass through the reporter-wide
redaction layer before HTML rendering.

The report can therefore be archived or opened offline. Keep the JSON alongside it when the full
machine-readable record is required.

## Public bounded review bundle

The installed package also exposes three report-only helpers. They accept a canonical document
Report 4 (and the renderer accepts the distinct screen-report profile); they do not acquire
documents, run a browser, or turn report strings into commands.

```ts
import { createContextPack, renderReport, writeReportBundle } from "breaklint";

const context = createContextPack(report, { maxFindings: 40 });
const html = renderReport(report, { theme: "dark" });
const bundle = writeReportBundle(report, {
  outDir: "./breaklint-report",
  evidenceDir: "./run/evidence",
});
```

`context.json` is a bounded AI-facing projection. It names the canonical run, whether its finding
selection is complete, the number and reason for omitted entries, an untrusted-data notice, and a
fixed operation vocabulary: `inspect-source`, `inspect-evidence`, and `recheck-after-repair`.
It also carries at most 30 actual typed infrastructure and nonmeasurement diagnostics (kind,
reason, and bounded measurement context), plus an omitted count; the full canonical report remains
the source for all events. Host-local path tokens in those details are withheld.
It contains no shell commands or document-controlled executable parameters. For every uniquely
matched target evaluation it retains the canonical status, reason, named measurements, compound
predicate and violation value rather than reconstructing a repair judgement from prose. A supplied
compatible `comparison` is retained unchanged in `context.json` and written as `comparison.json`;
reduced coverage, a missing target, or a disabled rule never becomes `resolved` in the view.

`writeReportBundle` writes `report.json`, `context.json`, and `report.html`. The report JSON is
copied unchanged and remains canonical. A PNG or diagnostic PDF becomes a link only when it is a
regular file below the supplied evidence directory and its current byte length and SHA-256 equal
the integrity record in Report 4. A failed check produces an explicit unavailable-evidence state;
it does not retain a stale image or link. Page-relative target crops use that same verified full
page image and retain the declared `css-page-top-left` coordinate system. Legacy Report 3 input is
shown as legacy: it receives neither a new original-source assertion nor a repair claim.
Screen reports retain their separate route, viewport, target and CSS-viewport coordinate semantics;
they never acquire document page or PDF claims in this view.

Each document card names the original-source status and role, exact verified range when available
(file, line/column and byte interval), integrity digest, coordinate system, and the difference
between an exact range and a verified container. Repair options are finite rule-specific suggestions
with expected effect, shown only for an actionable verified source. The report always exposes the
actual verdict, exit, infrastructure-event count and nonmeasurement count, including an empty
finding list, and lists the same bounded typed diagnostics when they exist. Print keeps a crop and its caption together below 100 mm; a card containing a larger
crop may fragment rather than hide or clip evidence.

## Reproducible render review

The report-surface gate has two explicit modes over the complete matrix in
`.artifacts/report-surfaces/`:

- `npm run test:report-surfaces` and `npm run test:report-surfaces:local` are the strict local
  human gate. They pass only when the **latest** review round in the ledger passed, every one of
  its 32 cells passed under a rostered human reviewer, and it is bound to exactly the current source fingerprint, declared review
  environment, stable artifact fingerprints, visible screen-pixel hashes and physical inventory.
- `npm run test:report-surfaces:technical` is the release/CI technical gate. It renders and
  validates the current platform's complete matrix, validates every round of the separately
  retained human ledger structurally, and prints the latest round's outcome and whether it is
  bound to the current inputs (also into the GitHub job summary when one exists). It never
  transfers a historical human PASS onto changed inputs and does not require a ceremonial
  re-review for a technical release gate.

### Review ledger and declared review environment

`tests/golden/report-surfaces/review-ledger.json` is schema 5: a list of numbered review
**rounds**, each `pass`, `fail` or `pending`. Schema 4 could hold only one all-pass record, and
technical mode rejected any cell that was not `pass`, so the one failed review this gate produced
(2026-09-18) could not be written into it without turning CI red and existed only as prose. The
migration kept the 0.2.3 review unchanged as round 1 (`historical`, pass, all 32 cell records as
they were) and added the 2026-09-18 review as round 2 (`historical-reconstruction`, fail, one
blocker, three high and four medium findings). Round 2 carries only what the public release record
states; per-cell outcomes, reviewer handles, the render fingerprint and the environment were not
recorded at the time, so its `binding` and `cells` are `null` and its two reviewers are
`not-recorded` instead of named after the fact.

A round is validated fail-closed: a `pass` round names a rostered human reviewer, binds an input
fingerprint, a render timestamp and an environment, covers all 32 cells with every cell `pass`, and
records no blocker or high finding; a `fail` round records at least one finding or one failed cell;
a `pending` round carries no outcome. An earlier passing round never carries forward over a later
failed or pending one.

Reviewers are named for what they are, and the human roster is closed:

- `human` is one of the **human review roles `@Brand`, `@Neo` and `@Founder`** and carries nothing
  but `kind` and `handle`. The roster is the constant `HUMAN_REVIEW_ROLES` in
  `tests/tools/report-surface-contract.mjs`; a role is added or removed only by a reviewed change to
  that file, never by editing the ledger, so no reviewer can admit itself by writing the record its
  review is kept in. A self-chosen handle such as `@some-model` labelled `human` is rejected.
- `agent` carries the label of the model or tool that reviewed (`model`) and optionally a handle
  that is not a human role. An agent may be recorded as a reviewer of a round and may record a
  failed cell; a cell it marks `pass` is rejected, so an agent's review never satisfies the human
  requirement, whether it is the only reviewer or listed beside a human.
- `not-recorded` states that the record of the time did not name the reviewer (`handle: null`).
- Within a round one handle is one reviewer of one kind: a handle listed as both `agent` and
  `human` is rejected, and every reviewer entry is closed over its fields, so a model label cannot
  move into a field of its own.

Every cell that passed must name a `human` reviewer of its round from the roster. The line the
verifier prints and appends to the GitHub job summary ("Report-surface review ledger") names every
reviewer of the latest round with its kind and counts the cells a rostered human passed; it says
"latest human review round N is PASS" only when that count is all 32 cells, and "latest review
round N is …" otherwise.

The render manifest (schema 5) splits the environment in two. `reviewEnvironment` is the
**declared** review environment and is what a review binds: artifact and pixel contract versions,
the browser product and four-part version, platform, architecture, the Node major line, device
scale, the deterministic launch arguments, viewports, themes and the print contract (media, A4,
raster DPI, rasterizer version, content viewport). `observedEnvironment` records the kernel or
Darwin release string and the exact Node version beside it without binding them: neither changes a
pixel, and a binding nobody can re-enter after one operating-system update is not reproducible. A
browser version is measurable when it names a product and a four-part version — `Chromium
141.0.7390.37` and `Google Chrome 152.0.7977.64` both qualify, since any Chromium-based browser is
supported; a bare product name or a user-agent token does not.

Both modes cover:

- four truthful verdict states;
- light and dark at 1440×1000, 768×1024 and 390×844;
- one real A4 PDF per state and an independently rasterized page set for each PDF.

That is 32 review cells. Each tablet and mobile screen cell is also written as viewport-height
tiles (`<cell>--tile-NN.png`, 148 in the canonical matrix) cut from the same decoded pixels as its
full-page PNG — a 390 × 11 649 px strip cannot be judged at fit-to-window scale, its fourteen
844 px tiles can. The verifier re-cuts every tile from the independently decoded full page and
requires the normalized RGBA to match, so tiles add no unbound pixel. `review-gallery.html` in the
same directory presents every full page, tile and printed page per state; it is what a reviewer
opens, and the verifier requires it to reference every artifact. A reviewed screen cell names its
full page and all of its tiles in the ledger.

The renderer also records, per screen cell, the accessibility tree as assistive technology receives
it (CDP): exactly one banner, main and contentinfo landmark, one navigation named "Report
contents", every in-page link resolving to a heading or section, the coverage table keeping its
table and row-header semantics on the phone grid, and the first Tab stop being the skip link with an
outline of at least 2 px. `broken-landmarks` and `broken-skip-link` are its red controls.

The generated manifest records raw SHA-256, byte size, raster dimensions,
PDF page geometry, DOM invariants and the declared and observed environment. Every screen
PNG is also decoded to eight-bit straight RGBA. Fully transparent pixels have their invisible RGB
channels canonicalized to zero; SHA-256 is then computed over the normalized RGBA bytes. The
verifier independently decodes and normalizes the file and rejects a one-channel mutation of one
visible pixel. The exact deterministic Chrome launch arguments—software rasterization, fixed sRGB,
disabled LCD text and deterministic compositor mode—are part of the recorded review environment.
Generated PNG/PDF evidence remains ignored by Git; the generator and the human review ledger are
versioned.

The review gate deliberately keeps two distinct bindings:

- `reviewedRawSha256` in the ledger is the historical audit trail for the exact files the named
  reviewers opened. `renderManifestGeneratedAt` identifies that historical render; neither value
  is treated as a portable equivalence oracle after a fresh render.
- `reviewArtifactFingerprint` is the strict local transfer gate. It binds the current source/input
  fingerprint, matrix cell, browser/platform/render contract and visible geometry/semantics. Screen
  cells additionally bind their decoded normalized RGBA hash. Print cells bind every independently
  rasterized A4 page by visual hash and dimensions. Raw PDF container bytes are excluded from that
  equivalence decision because browser-generated metadata may change while every visible page
  remains identical.

The verifier independently reconstructs the current source/input fingerprint, every stable artifact
fingerprint and every screen RGBA hash. A local human PASS transfers only when those fingerprints,
pixels and the complete declared review environment are identical. It also runs two negative
controls: changing one bound input in a temporary tree must invalidate the source fingerprint, and
changing one visible RGBA channel must invalidate the screen fingerprint. A new or changed bound
source therefore leaves the latest round unbound until the complete local matrix has been rendered
and reviewed again in a new round. Technical CI still fails on malformed historical review evidence or any technical
defect in its own current matrix; changed source is reported as different rather than mislabeled as
already human-reviewed. The strict local gate remains red until a real reviewer binds the new exact
inputs.

Print verification is outcome-level as well as structural. The renderer measures the actual print
layout at the A4 content width, requires the Coverage Trust verdict to remain on one line, fit
completely inside its own card and have zero bounding-box overlap with the neighbouring summary
card, and rejects any horizontal overflow of the content box.

Coverage tables are checked in the DOM in every screen cell and in print: for every column, each
body cell's text edge — the end edge for a right-aligned column, the start edge otherwise — lies
within 1 px of the others and of the column header's (the header comparison matters: the canonical
counts are single digits, so a body-only comparison could not see a numeric column that lost its
alignment); no cell overflows; in print every row is `break-inside: avoid` and a 13-row table is at
most half an A4 content box tall (measured 475.7 of 1031.8 CSS px).

Each rasterized page is then checked from the PDF itself. The renderer anchors every printed row by
its rule id and result on one PDF text line; the verifier independently reads rows from the
`-layout` text and projects the A4 content edges. Both require every row to be found exactly once,
every page carrying rows to show the column header above its first row, every continuation (a page
with rows but no caption) to carry at least two rows, and each row to be closed by its rule: the
raster rule below the row must cover at least 98 % of each half of the table width with no gap
longer than two raster rows at 110 DPI. The verifier cross-checks the renderer's rows, rule
positions and table edges within 2 raster px. Thirteen rules span at most two pages.

Two technical A4 probes, which are not human-review cells, cover what the canonical states cannot:
the insufficient-coverage state printed with `printBackground: false` must still close all 13 rows
and carry "Below floor" in words (colour is never the only carrier of state), and a long-table probe
(one document, 73 coverage rows) must continue across pages with its header repeated on every page.
The complete visible contract is bound to the review fingerprint.

A CI mutation runner (`npm run test:report-surface-mutants`) executes a genuine failing renderer
process per negative control and requires the expected failure message; the renderer's control
table and the runner's list are held against each other. The coverage controls replaced the
card-era ones one for one when coverage became a table: a wrapped trust verdict with a compressed
table (`broken-coverage`), a four-column trust grid (`broken-trust-geometry`), a forced one-row
continuation (`broken-tail-cohesion`, pinned to that phase), four physical row-rule controls — a
whole rule, its right half, its left half and both (`broken-row-rule`, `broken-right-row-rule`,
`broken-left-row-rule`, `broken-both-row-rule`, each required to cross both thresholds on the named
side) — and, new with the table, a numeric column losing its alignment (`broken-column-alignment`)
and a header that stops repeating (`broken-header-repeat`, on the long-table probe).

Page content checks reject empty non-cover pages. **Page fill** is the depth of a page's last
line of text: the bottom of the lowest text line whose box lies between the 12 mm top and bottom
margins, as a share of the content-box height (1031.8 CSS px), read by the renderer from the PDF's
own text layer (`pdftotext -bbox-layout`). The verifier reads it independently from the raster: the
last row inside the content box, inset 8 CSS px from its edges, in which dark pixels (luminance
below 100) form at least two runs no longer than 36 CSS px each; the two readings must agree within
1 % of the content box. Frame borders, accent bars, tinted backgrounds and the running head and
folio are not text and do not count. That is the point of the definition: a split finding repeats
its frame on the next page (`box-decoration-break: clone`) and a fragment that breaks is stretched
to the end of its page, so an ink reading counted an empty frame as content — the verifier's
`x-longer-remediation` experiment left 44 % of a page empty inside finding 01's frame and measured
99.9 % "full". Ink depth, frames included, is still recorded beside each text depth.

Every page except the last must reach **60 %**. The bound is paired with a second one: the tallest
run of content that may not break is at most **40 %** of the content box (412.7 CSS px), and the
failure names it. A unit is every outermost element with a computed `break-inside: avoid` and every
heading outside one; units on one row (grid cells) are one unit; and consecutive units glued by a
computed `break-after: avoid` on the first (or an ancestor it ends) or `break-before: avoid` on the
second (or an ancestor it starts) are one unit, because the browser has to move them together — a
section heading, a finding's head and its first row of facts leave the same hole as one element of
their combined height. With no such unit taller than 40 %, a page that ends early because its next
unit did not fit is still 60 % full; the fill gate catches whatever the unit bound cannot see. Before
this bound the findings heading carried the untested-advice caveat inside its heading group, and
heading + caveat + the first finding's head and facts formed one 456–481 px chain (44–47 %); the
heading group and caveat are now one unbreakable intro that does not keep with the first finding.
Measured on Chromium 141 / linux the tallest unit is the report header (359.6–384.8 px, at most
37.3 %), and every non-final page's text reaches 71.8–98.7 % (clean 3 pages, findings 7,
infrastructure 8, insufficient-coverage 8; 43 in 0.6.0). The only fill exemption is a deliberate
section boundary, defined mechanically: the next page begins with an element whose computed
`break-before` is `page`, `left`, `right`, `recto` or `verso` — the canonical report declares none.

Keep-with-next is checked from the PDF text: every section heading shares its page with the first
line of the unit it introduces, and every coverage caption with its table's first row (the verifier
holds its own table of documented section openings; both start looking at the "Run summary"
heading, because the banner's h1 may wrap so that a line reads just "Findings"). Boxed-block edges
and gaps are checked in the DOM of every screen cell and in print. Red controls:

- `broken-page-fill` prints page-atomic findings with a gap the next one cannot fit beside (shortest
  page 32.4 %; the runner requires 45 % or less, so the control proves the bound with a margin);
- `broken-long-remediation` grows finding 01's remediation to about 46 % of a page: the text depth
  of page 2 falls to 56.0 % while its ink depth stays 99.9 %, and the unit bound names "finding 01
  tail" (473.8 px);
- `broken-keep-chain` glues every fact to the next unit: no element grows, but the head, facts and
  tail become one 690.8 px chain that only a chain-aware bound sees;
- `broken-alert-width` restores the narrow alert ("right spread 527.31 px" on a desktop),
  `broken-alert-gap` removes its gap, and `broken-heading-keep` forces the first coverage row away
  from its caption.

`selfcheck:live` runs the report's own HTML through the real paginator and must catch an injected
block that promises not to break and cannot keep the promise. That control used to inject into a
whole finding card; since findings fragment between units, the card is no longer a candidate of the
rule (measured: the old injection now ends clean, exit 0), so the control injects into a finding's
tail, which still asks not to be broken.

The portable bundle keeps `report.json` as the historical capture record. `context.json` adds `bundleEvidence` contract version 1 with current per-finding asset availability; `bundle.json` lists every copied PNG/PDF and its SHA-256 and byte length. A missing or tampered local asset remains `missing-or-integrity-failed` in both HTML and AI context. A historical report comparison is not a fresh verification of local bundle assets. Overflow crops show the visible intersection while preserving the original target coordinates.
