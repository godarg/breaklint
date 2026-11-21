# Report surface: design record and render review

Maintainer documentation. The user-facing description of the reports is
[`docs/reporting.md`](../docs/reporting.md). This page records the design decisions behind the
HTML report (tokens, typography) and the procedure that reviews its rendered surfaces before a
release: the review package, the review ledger and its rostered reviewers.

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
DejaVuSansMono(-Bold). That measurement is from an Ubuntu 24.04 development container
(Chromium 141, Liberation and DejaVu installed). **Not measured (NEEDS-CI):** the GitHub
`ubuntu-24.04` runner image that CI's check job and the release validate job pin — which faces it resolves depends on
its installed font packages, and the gate is expected to fail there rather than pass on an
undeclared face, but no run on it has been read yet; macOS and Windows have not been measured by
this gate either.

## Reproducible render review

The report-surface gate has two explicit modes over the complete matrix in
`.artifacts/report-surfaces/`:

- `npm run test:report-surfaces` and `npm run test:report-surfaces:local` are the strict local
  sight gate. They pass only when the **latest** review round in the ledger passed, every one of
  its 32 cells passed under a rostered reviewer or an explicitly delegated AI reviewer, and it is bound to exactly the current source fingerprint, declared review
  environment, stable artifact fingerprints, visible screen-pixel hashes and physical inventory.
- `npm run test:report-surfaces:technical` is the release/CI technical gate. It renders and
  validates the current platform's complete matrix, validates every round of the separately
  retained review ledger structurally, and prints the latest round's outcome and whether it is
  bound to the current inputs (also into the GitHub job summary when one exists). It never
  transfers a historical rostered PASS onto changed inputs and does not require a ceremonial
  re-review for a technical release gate.

### Review package: what the reviewer opens, checks and records

The strict gate accepts a review under a rostered reviewer handle or the release-specific delegated AI review
documented in `maintainers/releasing.md`. The tooling prepares the surfaces and checks the record;
it never invents a review. A nondelegated agent cannot record passing cells.

**1. Render on the machine you review on.** A review binds the declared environment (browser
product and four-part version, platform, architecture, Node major line, launch arguments,
viewports, print contract). From a clean checkout of the commit under review run `npm ci`, then
`npm run test:report-surfaces:technical`. It renders into `.artifacts/report-surfaces` and must pass
before anything is reviewed. Do not edit a bound input afterwards; any change unbinds the review
and means rendering again. The bound inputs are exactly `REVIEW_INPUT_ROOTS` in
`tests/tools/report-surface-contract.mjs` (a test holds this list against it):
<!-- review-input-roots: .github/workflows/ci.yml, src/acquire/browser.ts, src/config, src/core, src/report, src/rules, examples/demo-snapshot.json, tests/fixtures/report-states.ts, tests/tools/render-report-surfaces.mjs, tests/tools/report-surface-mutations.mjs, tests/tools/verify-report-surfaces.mjs, tests/tools/report-surface-contract.mjs, package.json, package-lock.json -->
`.github/workflows/ci.yml`, `src/acquire/browser.ts`, `src/config`, `src/core`, `src/report`,
`src/rules`, `examples/demo-snapshot.json`, `tests/fixtures/report-states.ts`, the four surface
tools (`tests/tools/render-report-surfaces.mjs`, `tests/tools/report-surface-mutations.mjs`,
`tests/tools/verify-report-surfaces.mjs`, `tests/tools/report-surface-contract.mjs`),
`package.json` and `package-lock.json`.

**2. Open**, in `.artifacts/report-surfaces/`:

- `review-gallery.html` in a browser: every full page, every viewport-height tile and every
  printed page, per state;
- each `<state>--a4.pdf` in a PDF viewer, because the gallery shows rasters, not the PDF;
- `manifest.json`, for the values the round copies.

The matrix is 32 cells: four states × light/dark × 1440/768/390 px screens, plus one PDF and its
page rasters per state. A screen cell counts as reviewed only when its full page and every one of
its tiles were looked at.

**3. Check**, for every state:

- the verdict, exit code and gate effect are true before any detail, and only clean says "Clean run";
- nothing is illegible in either theme, including the tinted remediation and note boxes;
- headings are in the serif display face, text in sans, identifiers in mono;
- on tablet and phone:
  - nothing is cut off and nothing scrolls sideways;
  - rule ids break only after their slash;
  - paths break after a slash, or inside one segment only when that segment alone is wider than
    its line — judge whether the wrapped real-shaped evidence name reads acceptably;
- coverage columns align with their headers, "Below floor" reads without colour, and no table
  continues onto a page with a single row;
- in print:
  - "Page N of M" on every page, and the running head with the run id from page 2;
  - the end mark on the final page only;
  - no non-final page ends far short;
  - a split finding continues at its labelled tail;
  - a continued table repeats its header under a single rule;
  - the untested-advice caveat appears once;
- whatever the gate cannot see: spacing, hierarchy, anything that reads as broken or misleading.

State in the round's note whether you accept these known residuals:

- the tail label prints on every finding, split or not;
- an over-long evidence name wraps inside itself;
- `ubuntu-24.04` runner font resolution is unmeasured (NEEDS-CI).

**4. Record the round.** Append ONE new round to the ledger, and never edit or remove an earlier
one. It carries:

- `round`: the next number;
- `record: "current"`;
- `outcome`: `pass`, `fail` or `pending`;
- `reviewedAt`: an exact UTC timestamp at or after `manifest.generatedAt`;
- `reviewers`: a rostered reviewer role, or the closed `delegated-ai` receipt described below;
  ordinary agent contributions are recorded as `agent`, never relabelled as a person;
- `binding`: `reviewInputFingerprint` and `renderManifestGeneratedAt` copied from the manifest's
  `reviewInputFingerprint` and `generatedAt`, and `reviewEnvironment` copied whole;
- `physicalArtifactsReviewed`: `manifest.physicalArtifacts`, copied whole;
- `findings`: counts by severity;
- `note`;
- one `cells` entry per manifest artifact.

Each cell entry has:

- `status`: `pass`, `fail` or `not-reviewed`;
- `reviewer`: your handle;
- `reviewedAt`: exact UTC, at or after `manifest.generatedAt`;
- `note`: at least 12 characters;
- `reviewArtifactFingerprint`, copied from the artifact;
- `reviewedArtifacts`:
  - for a screen: its path, then every tile path;
  - for a PDF: its path;
  - for a raster set: every page path;
- `reviewedRawSha256`, the artifact's `sha256` (for a raster set, every page's);
- `reviewedNormalizedRgbaSha256` for screens: `pixels.normalizedRgbaSha256`;
- `reviewedPages` for a PDF and a raster set: 1 … N.

Record the truth:

- If anything fails, record `fail` with the findings counted and the failed cells marked. A failed
  round is valid evidence and keeps the gate red.
- If you stop part-way, record `pending` with every cell `not-reviewed`.
- An agent that helped may be listed with `kind: "agent"` and its `model`. It may record a failed
  cell, never a passed one.
- Never copy an earlier round's cells.

Then run `npm run test:report-surfaces:local`. It passes only when your round passed, every cell
passed under a rostered or explicitly delegated AI reviewer, the round is a current record reviewed after its render, and it is
bound to exactly the current inputs, environment, cell fingerprints, pixels, named artifacts and
inventory; otherwise the message names what differs. Commit the ledger change yourself; the
reviewer of that commit checks who made it (see "What the roster check does not do" below).

### Review ledger and declared review environment

`tests/golden/report-surfaces/review-ledger.json` (ledger format version 6, its `schemaVersion`)
is a list of numbered review **rounds**, each `pass`, `fail` or `pending`. Ledger format version 4
could hold only one all-pass record, and
technical mode rejected any cell that was not `pass`, so the one failed review this gate produced
(2026-09-18) could not be written into it without turning CI red and existed only as prose. The
migration kept the 0.2.3 review unchanged as round 1 (`historical`, pass, all 32 cell records as
they were) and added the 2026-09-18 review as round 2 (`historical-reconstruction`, fail, one
blocker, three high and four medium findings). Round 2 carries only what the public release record
states; per-cell outcomes, reviewer handles, the render fingerprint and the environment were not
recorded at the time, so its `binding` and `cells` are `null` and its two reviewers are
`not-recorded` instead of named after the fact.

Ledger 6 preserves all prior rounds and adds a separate, explicitly delegated AI reviewer kind.
A round is validated fail-closed: a `pass` round names a rostered or delegated AI reviewer, binds an input
fingerprint, a render timestamp and an environment, covers all 32 cells with every cell `pass`, and
records no blocker or high finding; a `fail` round records at least one finding or one failed cell;
a `pending` round carries no outcome. An earlier passing round never carries forward over a later
failed or pending one.

Reviewers are named for what they are, and the reviewer roster is closed:
<!-- rostered-reviewer-roles: @Brand, @Neo, @Founder -->

- Ledger kind `human` marks one of the **rostered reviewer roles `@Brand`, `@Neo` and `@Founder`**
  and carries nothing but `kind` and `handle`. The value `human` is the ledger's historical field
  name, kept so that rounds 1–9 stay byte-identical; it records which role handle was written, not
  that a person reviewed. A role is part of the maintainer's workflow and may be operated by an
  agent. The roster is the constant `ROSTERED_REVIEW_ROLES` in
  `tests/tools/report-surface-contract.mjs`; a role is added or removed only by a reviewed change to
  that file, never by editing the ledger, so no reviewer can admit itself by writing the record its
  review is kept in. A self-chosen handle such as `@some-model` under kind `human` is rejected.
- `agent` carries the label of the model or tool that reviewed (`model`) and optionally a handle
  that is not a rostered role. An agent may be recorded as a reviewer of a round and may record a
  failed cell; a cell it marks `pass` is rejected, so an agent entry never satisfies the roster
  requirement, whether it is the only reviewer or listed beside a rostered one.
- `delegated-ai` is a separately declared release-specific sight reviewer with the native model
  and received-image receipts described below. It may pass only under the recorded Founder
  delegation; the verifier reports the review kind as `delegatedAI`.
- `not-recorded` states that the record of the time did not name the reviewer (`handle: null`).
- Within a round one handle is one reviewer of one kind: a handle listed as both `agent` and
  `human` (rostered) is rejected, and every reviewer entry is closed over its fields, so a model label cannot
  move into a field of its own.

Every passing cell must name a rostered (`human`) or `delegated-ai` reviewer of its round.
A delegated AI record carries the release-specific Founder delegation (from round 10 on as the
SHA-256 of the session quote and a fixed neutral statement, never the quote), actual model identity
from the native runner output, prompt/output hashes, a native receipt with image count (from round
10 on bound by path and SHA-256 in the maintainers' evidence store, not committed), and
the exact path and SHA-256 of every assigned full-page PNG, tile and printed-page raster.
The strict gate checks the complete received-image inventory and never calls this a rostered pass.
Its latest delegated round must also name the package version in the bound review-input root;
valid historical release-specific delegations stay on record and cannot approve changed inputs.
Preparing a render, an image inventory or a pending round is not a review. Append a new round
only with the actual outcome, native model and image-read receipts after the reviewer has
inspected the frozen artifacts. A pending template contains no passing cells or invented model.
See `maintainers/releasing.md` for the closed receipt fields and the trust limits of this record. The line the
verifier prints and appends to the GitHub job summary ("Report-surface review ledger") names every
reviewer of the latest round with its kind and counts the cells a rostered reviewer passed; it says
"latest rostered review round N is PASS" only when that count is all 32 cells, and "latest review
round N is …" otherwise. It ends with the binding in the same two halves the strict gate checks —
"bound to the current render: inputs yes|no; environment/artifacts yes|no" — so "yes" for the
inputs is never read as a transferable review when the environment, a cell fingerprint, a named
artifact or the physical inventory differs.

**What the roster check does not do.** It proves only that a rostered handle was written into the
ledger. It does not authenticate a person: the ledger is a file in this repository, nothing in it
is signed, and anyone who can commit can write `@Neo`. Who stands behind a rostered handle rests on repository access control and on review of the ledger diff, not on this gate.
This residual is deliberate (owner decision, 0.7.0 cycle) and is printed with every job summary.

Rounds are also ordered in time, fail-closed: `reviewedAt` never decreases from one round to the
next; no `historical` or `historical-reconstruction` record follows a `current` one; a passing
latest round must be a `current` record; and a current round, and each cell it reviewed, carries an
exact UTC `reviewedAt` at or after the `renderManifestGeneratedAt` it binds. No round or cell may be
dated more than ten minutes (clock skew) after the verifying machine's clock. A historical pass moved
to the end of the ledger, or re-bound to today's render, therefore does not pass. Historical rounds
keep the times they were recorded with (round 1's cells predate its render timestamp by minutes).

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
tiles (`<cell>--tile-NN.png`, 168 in the 0.9.0 matrix measured on 2026-10-07) cut from
the same decoded pixels as its full-page PNG. The complete matrix also has 24 full-screen PNGs,
four PDFs. Measured on 2026-10-07, their page counts are 3/9/9/9 on macOS and 3/8/9/9
on Linux, in state order clean/findings/infrastructure/insufficient-coverage: 30 and 29 page
rasters respectively. Independent `pdfinfo` and canonical PNG membership confirm both inventories.
The preceding values describe the historical 0.9.0 matrix. The initial 0.10.0 presentation's
independent physical measurements on 2026-10-07 recorded 158 tiles and 3/8/8/8 printed pages
on both macOS and Linux (27 page rasters). The [Linux diagnostic](https://github.com/godarg/breaklint/actions/runs/37679854862)
rendered all 32 cells and passed its independent inventory oracle; it is technical evidence,
not a visual review. The original first diagnostic timeout is retained as incomplete infrastructure.
Round7's original delegated review failed on a contradictory handwritten insufficient-coverage
fixture and left four desktop cells unread at their downscaled size. The fixture now records its
missing applicable decline, and every screen viewport includes legible tiles. Independent macOS
and [Linux measurements](https://github.com/godarg/breaklint/actions/runs/37686731564) count
212 tiles and the same 27 printed pages. The arithmetic is 23 = 20 + 3 applicable evaluations, with
the affected widow row 2 = 1 + 1; the new fixture reason is explicitly authored presentation data.
This correction changes no production threshold or rule-engine accounting. The failed review
remains on record. The fresh frozen-input second review is round 8: all 32 cells pass, with
263 qualified native image reads and actual model `claude-opus-5-5`. Four medium and 27 low
findings remain explicitly disposed; this is delegated AI local-image sight evidence, without
human or Ubuntu visual acceptance. The strict gate must still verify the actual current binding.
The verifier pins the printed page count of each platform and state separately; it does not derive
it from the renderer manifest. The tile total is not pinned, because it moves with platform fonts
on an unchanged report; the verifier instead requires 24 distinct screen cells, every screen row
covered by exactly one tile from the top to the page end, no image listed twice, raster sets as
long as their PDFs and physical totals equal to what the artifacts list. Long desktop, tablet and mobile pages cannot be judged at fit-to-window
scale; every screen cell therefore supplies viewport-height tiles.
The verifier re-cuts every tile from the independently decoded full page and
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
Generated PNG/PDF evidence remains ignored by Git; the generator and the review ledger are
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
fingerprint and every screen RGBA hash. A local sight-review PASS transfers only when those fingerprints,
pixels and the complete declared review environment are identical. It also runs its own negative
controls, each once per run on a copy of real evidence broken in exactly the way its check exists
for, and fails if a check accepts the copy:

- changing one bound input in a temporary tree must invalidate the source fingerprint;
- changing one visible RGBA channel must invalidate the screen fingerprint;
- a PDF font list without its display faces must fail the font check;
- a tile with one channel of one visible pixel changed, and its manifest entry rewritten to the
  edited tile's hashes (the verifier's round-2 experiment), must fail the re-cut from the full page;
- the review gallery with one tile reference removed must be reported as omitting that tile;
- an inventory with one tile listed in place of another (totals unchanged), or a screen whose tiles
  stop one row short of its page end, must fail the inventory invariants;
- a printed state's page text with the findings lead moved to the next page must fail the
  stranded-heading check;
- a page raster whose lower 55 % is replaced by an empty cloned frame — tinted background, dark
  borders on both column edges, a 4 px accent bar and a rule in two long segments — must read below
  the 60 % text depth. Each element defeats one simplification of the text reading (no inset from
  the column edges, a single run counted as text, no limit on run length); each simplification was
  made in turn and the control failed on it;
- a fill record with a non-final page at 55 % text depth and no forced break after it must fail
  the fill check (the threshold's application, not only its reading);
- page text in which page 2 opens on a bare "Remediation …" line must fail the continuation check;
- a page raster with the rule under one coverage row painted out must fail the row-rule check;
- the verifier's own row positions with one row pushed down by a fifth of the median pitch must
  fail the pitch check;
- the independent break-run measurement (below) of a layout in which every fact keeps with the next
  unit must exceed the 40 % bound.

Removing any of these checks turns the technical gate red on its control (each was removed in turn
and measured red).

**The 40 % unit bound is measured twice, differently.** The renderer builds chains of unbreakable
units. The verifier opens the canonical states' HTML in its own browser process, at the A4 content
width in print media with the declared launch arguments, and finds the break opportunities
instead: every boundary between two adjacent in-flow block siblings, allowed unless a computed
`break-after`/`break-before: avoid` sits on either side of it (on the element or down its last or
first child), an ancestor has `break-inside: avoid`, or the two share a grid or flex row. The
tallest stretch between consecutive allowed breaks must be at most 40 % of the content box, and the
renderer's tallest unit may not exceed it (measured: 359.6–384.8 px against the renderer's
359.6–384.8 px; for infrastructure the stretch includes the finding frame's top border and padding,
383.3 against 364.3 px). The largest empty interval inside a page is not bounded separately: the
fill check bounds the empty space below the last line, and the unit bound bounds what a break can
move, but a tall gap between two lines in the middle of a page would pass both. A new or changed bound
source therefore leaves the latest round unbound until the complete local matrix has been rendered
and reviewed again in a new round. Technical CI still fails on malformed historical review evidence or any technical
defect in its own current matrix; changed source is reported as different rather than mislabeled as
already reviewed. The strict local gate remains red until a real reviewer binds the new exact
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
positions and table edges within 2 raster px. Thirteen rules span at most two pages. Every
printed row is one line, so the distance between consecutive row rules on a page — the row pitch —
must lie within 8 % of the table's median pitch (about 33 raster px, 21.7 pt, in the canonical
states); the verifier measures the pitch from its own rule positions and cross-checks the median
within 2 px. The check exists because the coverage list was a CSS grid: a grid item that fragments
is stretched to its unfragmented grid area, and Blink gave the continuation page's rows the surplus
the repeated header creates (24.8–26.3 pt instead of 21.7 pt, with a second rule under the header).
In print the list is block flow, and the end mark carries no rule of its own, so the table's last
row rule is the only line under it. `broken-row-pitch` restores the grid. The column header is
closed by exactly one rule on every page, counted in the raster between the header text and the
first row: a separate second rule, or a thin rule painted through the strong one (a lighter row
between two darker rows), fails. Print uses separate borders because collapsed borders did the
latter on every continuation page; `broken-border-collapse` restores them. A long document path is
printed as a technical probe (`print-long-document-path/findings`): the print content may not be
wider than the A4 content box, which makes Chrome shrink the whole PDF (a trailing margin on the
caption's path did, 12 px, every page at 98.3 %), and the verifier independently compares word
heights on page 1 with the canonical findings PDF, which a scaled page cannot match
(`broken-caption-gap`).

Two technical A4 probes, which are not sight-review cells, cover what the canonical states cannot:
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
37.3 %), and every non-final page's text reaches 64.0–97.6 % (clean 3 pages, findings 8,
infrastructure 8, insufficient-coverage 8; 43 in 0.6.0). The only fill exemption is a deliberate
section boundary, defined mechanically: the next page begins — past a repeated coverage header,
which a continued table prints first — with an element whose computed `break-before` is `page`,
`left`, `right`, `recto` or `verso`; the canonical report declares none.

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
tail, which still asks not to be broken. The control runs with evidence binding on, as the clean
run does, and it used to require exit 4 on the ground that the oversized box "cannot receive an
in-page evidence mark". The evidence code never did that: the box starts on its page and its start
mark is placed there; only its end mark, below the content box, is refused, and a refused end mark
does not unbind a page on which the same block's start mark is placed (`hasUnplacedTarget` in
`src/render/evidence.ts`). Whether that page binds therefore depends only on whether the browser's
PDF returns every placed mark on it. Measured in CI on current Chrome, the same injection ended
exit 4 on the layout before the round-2 surface changes and exit 1 at `ed84d2c` (CI run 82), where
the tail gained its print label; the earlier exit-4 run left no per-page record of which mark
failed to return. The control now prints the per-page evidence of its run (marks matched, marks
placed, refused marks) and checks whichever outcome the evidence summary reports, completely:
complete evidence must end exit 1 with the error gating the run; partial evidence must end exit 4
with the error still reported. Both require the injected 1600 px block itself to be measured, and
the per-page records to agree with the summary.

The portable bundle keeps `report.json` as the historical capture record. `context.json` adds `bundleEvidence` contract version 1 with current per-finding asset availability; `bundle.json` lists every copied PNG/PDF and its SHA-256 and byte length. A missing or tampered local asset remains `missing-or-integrity-failed` in both HTML and AI context. A historical report comparison is not a fresh verification of local bundle assets. Overflow crops show the visible intersection while preserving the original target coordinates.

<!-- review-state -->
For 0.11.0 the current record is round 9: four fresh Claude Opus reviews (actual model
`claude-opus-5-5`) passed all 32 cells under the Founder's release-specific AI delegation of
2026-11-21. Native receipts bind 265 image reads (24 full screens, 214 desktop/tablet/mobile
viewport tiles and 27 A4 page rasters across 3/8/8/8 pages); the four PDF cells were judged
through every matching raster. Rounds 1–8 remain preserved unchanged.
This is delegated AI sight review, not human review. Six medium and 21 low advisory findings
have explicit non-blocking dispositions (mobile two-row coverage header, A4 keep-together card
page balance, long identifier/hash wrapping, desktop remediation measure width, and print tail
labels); zero blocker or high findings were reported. Fine-text judgement rests on native
viewport tiles and A4 rasters. This local macOS arm64 Node 24 sight review does not establish
human or Ubuntu visual review; Linux CI technical verification separately confirms 212 viewport
tiles and 3/8/8/8 A4 pages versus macOS 214 tiles and 3/8/8/8 pages. JSON remains canonical.
