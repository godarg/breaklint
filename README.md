# breaklint

[![npm](https://img.shields.io/npm/v/breaklint.svg)](https://www.npmjs.com/package/breaklint)
[![ci](https://github.com/godarg/breaklint/actions/workflows/ci.yml/badge.svg)](https://github.com/godarg/breaklint/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/breaklint.svg)](https://nodejs.org)
[![licence](https://img.shields.io/npm/l/breaklint.svg)](LICENSE)

`breaklint` is a command-line layout check for people who generate PDFs from HTML: it reports
widows, orphans, blocks too tall to keep together and hyphenation across page breaks, each with
the measured value and the threshold it failed.

[![A still from the 39-second breaklint film, with the line “Perfect in the browser. Broken on page 47.” over a blurred page of layout findings](https://raw.githubusercontent.com/godarg/breaklint/v0.9.0/assets/breaklint-film-poster.jpg)](https://dargel-solutions.de/en/breaklint/#film)

The image links to the project page, which carries the 39-second film about breaklint.

```bash
npx breaklint --demo
```

That command needs no browser and no configuration. It ends with exit 1, because the demo
fixture contains findings on purpose — a demo that ends 0 never shows you what a finding looks
like. Below is one of its five findings, plus the closing counters, copied from that
command's output:

```
error svg/text-overflows-viewport  page 5
  measured   72 px; threshold 0 px (uncalibrated)
  detail     This text extends 72.00 px beyond the SVG viewport and is not drawn. Coordinates are normalised through getScreenCTM().
  remedy     Text rendered inside an SVG extends outside the SVG viewport bounds and is clipped. Enlarge the SVG 'viewBox' or its width/height, or adjust the <text> coordinates ('x', 'y', 'text-anchor'). 'overflow: visible' on the container also clears the finding, but it does not move the text: the viewport then no longer clips, the target becomes non-applicable and this rule stops measuring it. Use that only where the overflow is intended.
             untested: no trigger/remedied pair in this package shows this advice removing this finding
  source     unknown (node produced by the paginator)
  render     unknown (no evidence produced)

inputs found: 1 · pages analysed: 5 · rules run: 12 · rules that measured something: 10 · not measured: 1 · verdict: findings · mode: demo · fail-on: error · gate triggered by: error
```

Two figure and two table checks are opt-in warnings. Figures require a source-bound body and
caption inventory; supported bodies include a single image, inline SVG or source-matched table,
measured separately from the wrapper. Table captions use their authored before/after order and
the first/last actual cell-box body page, including bodies spanning pages. Local figure/table links resolve authored IDs and legacy `<a name>` targets,
with IDs taking precedence. Table continuations require exact source row/cell membership and
concrete cell boxes. Unsupported structures and ambiguous references remain explicit declines.
Free-text numbering, printed page references and pagination cause are outside these checks. The hand-written demo
has no original HTML to inventory: default `--demo` still exits 1; `--profile strict --demo` now exits 4
because those requested figure checks cannot establish their source measurements.

Every finding carries what was measured, what the threshold was, and the word `uncalibrated` —
because no threshold in this project has been calibrated against real documents, and a number
that hides that is worse than no number.

One thing about that output, since the demo invites the assumption: the rule and reporter chain
running there is the real one, but the page it judges is a **hand-written snapshot**, built so
to demonstrate findings from the existing checks in a command that needs no browser. No HTML document stands
behind it: the snapshot names `examples/demo.html` as its document path, but that file does not
exist and never did, which is why the demo's findings carry no source location. The run says which
kind of fixture it used in its own `source` field rather than leaving you to guess. Point the tool
at your own HTML and the same chain measures a real page.

## Install

This documentation describes **version 0.10.0**. The npm command below installs the registry's
current `latest`; check the installed version with `npx breaklint --version`. Publication and
verification records are in [status](docs/status.md), and the release procedure is in
[releasing](docs/releasing.md). The [bounded human example evaluation](docs/evaluation-0.10.md)
records what the selected real examples establish and what remains unknown.

```bash
npm i -D breaklint
```

That is enough for `--demo` and for reading the docs. A run over your own HTML additionally
needs a browser and the paginator; see [Requirements](#requirements).

## Source-bound findings and existing web pages

The installed package now exposes `checkProducedDocuments`, `checkPage`, `compareReports`,
`createContextPack`, `renderReport` and `writeReportBundle`. Live document reports use Report 5, and
the report readers accept Report 4 and 5; the screen profile has a separate contract and checks
visible geometry without pagination.

```js
import { checkPage, writeReportBundle } from 'breaklint';

// `page` is your existing, authenticated Playwright page after scenario setup.
const { report } = await checkPage(page, {
  trust: 'host-controlled-page',
  networkPolicy: 'host-owned',
  scenario: 'account-overview',
  output: { dir: './layout-evidence', screenshot: 'viewport' },
});
await writeReportBundle(report, {
  outDir: './layout-report', evidenceDir: './layout-evidence',
});
```

The adapter keeps navigation, authentication and page ownership with the caller. It records
unsupported paint and missing coverage explicitly. Source selectors alone do not prove a component
position. A host build receipt can verify a component container; producer-bound documents can
carry exact original byte ranges. Both the offline human view and bounded AI context derive from
the same canonical JSON. See [the source and consumer contract](docs/source-bound-findings.md),
[reporting](docs/reporting.md) and [repair comparison](docs/revision-comparison.md). An agent
reading a report should start at [the agent contract](docs/agent-contract.md): which fields are
stable, what each exit code obliges it to do, and which advice this package has not verified.

## Why this exists

Prose linters never see a page. Typesetting systems see the page but do not know German
typographic convention. For documents generated from HTML to PDF, neither exists.

The reason for measuring the rendered page rather than the source is a case that source-level
checking did not catch: a chart passed an XML validity check and a geometry check, and still
came out of the renderer with colliding labels. Whether a page works is decided after
pagination — in the renderer, with the fonts that were actually available.

Prior art, and what it does well: `veraPDF` and `pdfcpu` check whether a PDF conforms to the
standard. `BackstopJS` and `pdf-visual-diff` compare a build against a previous one. `typopo`
corrects German punctuation in plain text, and does it well. `fmitex-widows-and-orphans` checks
widows and orphans in LaTeX, and TeX has reported `Overfull \hbox` for decades. All of these are
useful. None of them judges the layout of an HTML→PDF page on the first build, where there is no
previous version to compare to.

## What is checked

Seventeen rules are registered in 0.10.0. Twelve run by default: two can fail a build;
ten more are advisory unless you request `--fail-on warn`. Five are off by default: the two
figure checks, the two table continuation checks and experimental `layout/half-empty-page`.
Strict mode enables all seventeen. Half-empty-page never gates, even with `--fail-on warn`.
It now checks remaining space against twice a recorded line height, accepts low coverage at a natural
document ending, and declines low coverage at an observed forced ending when there is no late
start. A late start can still warn. These guards do not establish author intent or the cause of
an avoidable gap. Net fill remains glyph/visual-band coverage rather than line-box occupancy.

That split is not caution, it is the burden of proof: only two rules compare directly measured
quantities against a structural boundary.

| rule | what it measures | default |
|---|---|---|
| [`layout/widow`](docs/rules/layout-widow.md) | lines in the opening fragment against the element's own `widows` | warn |
| [`layout/orphan`](docs/rules/layout-orphan.md) | lines in the closing fragment against its own `orphans` | warn |
| [`layout/unbreakable-block-too-tall`](docs/rules/layout-unbreakable-block-too-tall.md) | height of a `break-inside: avoid` block against the page | **error** |
| [`layout/heading-at-page-bottom`](docs/rules/layout-heading-at-page-bottom.md) | space under a heading, in its own line heights | warn |
| [`layout/half-empty-page`](docs/rules/layout-half-empty-page.md) | summed height of semantic bands over the content box | warn, experimental, **off by default** |
| [`layout/orphaned-continuation-page`](docs/rules/layout-orphaned-continuation-page.md) | a page holding only the tail of an earlier block | warn |
| [`layout/hyphen-across-page`](docs/rules/layout-hyphen-across-page.md) | the paginator's hyphenation class at a page boundary | warn |
| [`svg/text-overflows-viewport`](docs/rules/svg-text-overflows-viewport.md) | CTM-normalised text box against the viewport | **error** |
| [`type/spaced-hyphen`](docs/rules/type-spaced-hyphen.md) | a hyphen between spaces where a dash belongs | warn |
| [`type/straight-quotes`](docs/rules/type-straight-quotes.md) | typewriter quotes in typeset prose | warn |
| [`type/short-last-line`](docs/rules/type-short-last-line.md) | width of a paragraph's closing line | warn |
| [`type/excessive-word-spacing`](docs/rules/type-excessive-word-spacing.md) | word gaps against the natural space | warn |
| [`artifact/local-uri`](docs/rules/artifact-local-uri.md) | `file:` URIs and build-machine paths left in the artefact | warn |
| [`figure/caption-separated`](docs/rules/figure-caption-separated.md) | a measured image/SVG or source-matched table body separated from its caption | warn, **off by default** |
| [`figure/dangling-reference`](docs/rules/figure-dangling-reference.md) | local figure/table links with missing authored IDs or legacy named anchors | warn, **off by default** |
| [`layout/table-header-not-repeated`](docs/rules/layout-table-header-not-repeated.md) | an existing header absent from a continuation with visible data | warn, **off by default** |
| [`layout/table-column-drift`](docs/rules/layout-table-column-drift.md) | continuation cell edges against the first visible header's tracks | warn, **off by default** |

**No threshold in this project is calibrated.** `calibrated: false` appears in the type, in
every finding and on every rule page. There is no corpus of real documents with human-checked
truth behind any of these numbers, and saying so is more useful than a number that looks
authoritative.

## What it does not do

- **PDF standard conformity** — use `veraPDF` or `pdfcpu`.
- **Comparison against a previous build** — use `BackstopJS` or `pdf-visual-diff`. This tool
  judges the first build, where there is nothing to compare to.
- **Grammar, spelling and wording** — use `vale`. The four `type/` rules here judge
  typographic characters and measured line geometry on the rendered page, not the prose.
- **Accessibility auditing** — use `pa11y`.
- **PDF as input.** PDF is produced and rasterised here to make evidence, never read as input.

## Limits

**PNG output is evidence, never a comparison basis.** Byte-identical rendering across machines
is not achievable — browser rendering varies with the host OS, version, settings, hardware and
headless mode. The report records an input identity so that reproducibility can eventually be
stated over more than the HTML file alone, but that is an intention rather than a determinism
guarantee today. L-07 remains open: system-font identifiers and the canonical treatment of
dynamically loaded resources are not complete. No check compares output file hashes.

**Findings depend on font availability.** A missing `@font-face` changes metrics, line breaks
and page breaks, and turns a correct page into a phantom half-empty-page finding. The run waits
for `document.fonts.ready` and stops with a non-zero exit if a declared font resource fails,
rather than reporting findings it cannot stand behind.

**Missing image content is never treated as present.** A failed image decode remains fatal unless
the source supplies positive `width` and `height` attributes and Chrome measures a box exactly
equal to both values. Only that fixed-layout case continues with the non-fatal
`image-content-unavailable` diagnostic; replacement text, missing dimensions or authored CSS that
changes the box is not accepted as stable geometry.
Reports retain a resource index and dimensions, never the failed file URL or remote query string.

A successful live document retains a non-fatal `geometry-cross-check-passed` event with candidate,
eligible, checked and required box counts, every semantic exclusion and the maximum delta against
the 0.05 px tolerance. This is positive evidence from Chrome's CDP layout tree, not a second read
from the in-page collector; a zero or truncated required sample is fatal.

**SVG clipping and ink collision are not released rules.** The research modules
`svg/text-clipped` and `svg/text-ink-collision` need isolated, stable pixel passes that production
acquisition does not yet collect. Version 0.3.1 therefore removes them from the CLI registry,
configuration schema, SARIF catalogue and demo instead of counting two rules that answer nothing.
Their real-renderer lab remains explicitly research-only. `svg/text-overflows-viewport` needs only
geometry and measures ordinary solid-fill text. When `getBBox()` cannot prove painted bounds
(for example `<use>`, stroke, clip/mask/filter or a paint server), or CSS on the SVG or an ancestor
makes its axis-aligned border box differ from the clipping viewport, the target declines coverage-relevantly and the error rule
fails closed with exit 4 rather than guessing.

**Their validation foundation is real-renderer, not real-corpus.** M3-0 exercises the ink rules'
known construction and boundary cases in Chrome/Paged.js; it does not establish population
performance or calibrate a threshold. It can validate the integrity and bindings of separately
supplied capture-evidence bytes, but it does not ship an externally governed attestor trust root.
No M3-0 path establishes a calibrated claim; that trust boundary belongs to later real-corpus
work.

**There is no released SVG pixel-collision or clip/mask-ink check.** A prior implementation took
its truth from the same API it was testing and was removed. The replacement lab uses independent
pixel counterfactuals, but production integration still needs an isolated page, a device-scale
contract, bounded target counts and rule-specific completeness checks before either rule can return.

**Paged.js is pinned to exactly 0.4.3.** The break cause is read from attributes the paginator
writes into the tree and does not guarantee as an interface. Any other resolved version stops
the run with exit 3, and no flag overrides that: a report produced on an unmeasured paginator
states things nobody measured.

**Windows is not supported.** Process termination here rests on POSIX process groups. The
termination and profile-cleanup path is measured on macOS; equivalent Linux behaviour has not
yet been established empirically. Windows job objects are neither designed for nor measured.

**The M2/M2d live render path is built.** A live run loads the document through an owned loopback
origin, paginates it, assembles and validates the snapshot, runs the rules, and binds evidence to
the report. `checker-crashed` remains a real exit-3 path for injected driver failures, apparatus
interference and process-boundary faults; it is not a placeholder for an unbuilt live path.
M3-0's SVG validation and calibration foundation exists in the repository, but empirical threshold
calibration and a representative human-labelled real corpus remain unfinished. The
[ten selected human-reviewed examples](docs/evaluation-0.10.md) establish a narrower evaluation.
Packaging and the first npm release
are complete; the post-release trust work and remaining validation boundaries are tracked in
`docs/status.md`.

## Exit codes

| code | meaning |
|---|---|
| 0 | checked, coverage met, nothing reached the threshold |
| 1 | at least one non-experimental finding reached the threshold |
| 2 | invalid invocation: unknown option, bad config, no input, or an input path that does not exist, is not a regular file or is not `.html`/`.htm`; no report is written |
| 3 | infrastructure: no renderer, font failed, pagination aborted, checker crashed, or the output could not be written completely (for example, the stdout reader closed early; with `--out`, a lost confirmation line keeps the verdict's code) |
| 4 | nothing or too little was judged |

Exit code 4 exists because of a measured case. A multi-column document with the widow rule
active produced 6 pages analysed, 1 rule run, 5 candidates, 0 measured, 0 findings — and exit 0.
The single-column control produced 5 measured, coverage 1.0, and also exit 0. From outside the
two runs were identical. Every report therefore carries `inputsFound`, `pagesAnalysed`,
`rulesRun`, `measuredRules` and the sum of unmeasured candidates, in every output format.

## Usage

```bash
breaklint docs/**/*.html                 # the shell does the globbing, not the tool
breaklint --format json --out report.json chapter-*.html
breaklint --fail-on warn manual.html     # gate on the heuristics too, deliberately
breaklint --profile strict manual.html   # warnings gate; every rule requires full coverage
breaklint --only layout/widow,layout/orphan book.html
breaklint --only layout/half-empty-page report.html   # experimental whitespace review
breaklint --only figure/caption-separated,figure/dangling-reference manual.html
breaklint --only layout/table-header-not-repeated,layout/table-column-drift --fail-on warn \
  --format json --out table-report.json manual.html
breaklint --disable layout/hyphen-across-page report.html
breaklint --out-dir build/evidence book.html   # where the page PNGs and the checked PDF go
```

A live run writes its evidence — one PNG per page and the PDF it checked — into
`./breaklint-report` in the working directory unless `--out-dir <dir>` names another; the report's
`evidence[].path` entries are relative to that directory. `--demo` writes none.

A rule you disagree with can be switched off for the whole run — `--disable <rule,...>`, or
`{"rules": {"layout/hyphen-across-page": false}}` in the config file; the same two switches turn
an off-by-default rule on, with `true`. There is deliberately no way to
silence a rule at ONE place in a document: an inline suppression comment would be a claim about a
page that nothing checks, and this tool exists because such claims were wrong.

In GitHub Actions, the composite Action at the root of this repository
(`uses: godarg/breaklint@<ref>`) runs the check as a gate: one run over the HTML paths or bash
globs you give it, a step that fails on breaklint's own exit code (1 to 4 by default; only 1 may
be left ungated), and SARIF for code scanning, JUnit and a Markdown step summary, all rendered
from the one canonical JSON report. It installs the npm release named in that ref's
`package.json`, not the ref's code: a tag works once its npm publish has succeeded, and a branch
ref runs the last release, or fails with exit 3 after a version bump that is not yet published.
Path expansion requires Bash 4 or newer with globstar; macOS `/bin/bash` 3.2 does not provide it.
[`docs/ci-recipe.md`](docs/ci-recipe.md) has a workflow to copy,
the permissions it needs and what each exit code does to the job.

There is no directory recursion and no glob expansion inside the tool. The shell has done this
correctly for fifty years, including symlink cycles.

Input is HTML only (`.html` or `.htm`), and the name decides: a standalone `.svg`, PDF or Markdown
file is rejected by its extension, and anything that is not a regular file — a directory called
`chapter.html` included — is rejected too, each with exit 2 before Chrome starts. The content of a
`.html` file is not sniffed. Inline SVG inside HTML is supported by the released SVG
geometry rule; treating a standalone SVG asset as a paged HTML document would require a separate
MIME, page-size and embedding contract that this version does not claim.

Configuration is fail-closed JSON in `breaklint.config.json`. Unknown fields, rules and options
end with exit 2 before the input is opened. Values resolve as defaults < profile < config < CLI;
the JSON report records the effective value, its origin and a deterministic configuration
fingerprint. Coverage floors can be raised, never lowered, and the two structural error thresholds
cannot be overridden. The complete contract, profiles, examples and generated schema are in
[`docs/configuration.md`](docs/configuration.md). JavaScript configuration would mean executing
code from a foreign repository inside CI, so it is intentionally unsupported.

Coverage totals count **rule-candidate evaluations**, not unique pages, elements or defects.
The same table can be evaluated by both continuation checks. Applicable unmeasured evaluations
are separated from not-applicable targets and unavailable tool capabilities outside the coverage
denominator. Each finding remains separate unless evidence establishes a shared cause; a shared
rule ID does not establish one. Repair advice is marked tested or untested.

The HTML reporter is a self-contained evidence view, not a second source of truth. Its header
distinguishes clean, findings, checker failure and insufficient coverage in words; findings reflow
without a horizontal table on mobile; print uses an A4 layout. What CI verifies about these
surfaces is technical — `test:report-surfaces:technical` checks every current screen and print
cell for decoded pixels, contrast, accessibility and fragmentation. A human review counts only as
a passing round by a rostered reviewer in the review ledger, bound to the current inputs; see its
latest round and [`docs/releasing.md`](docs/releasing.md).
<!-- review-state -->
The following is historical 0.9.0 surface-review evidence, not acceptance of the changed 0.10.0
surfaces. The candidate needs a new input-bound review. For 0.9.0 the record is round 6: four fresh
Claude Opus reviews (actual model
`claude-opus-5-5`) passed all 32 cells on the source after the platform inventory correction,
under the Founder's release-specific AI delegation of 2026-10-04 and targeted-completion
instruction of 2026-10-07. Native receipts bind 222 image reads (24 full screens, 168 viewport
tiles and 30 A4 page rasters); the four PDF cells were judged through every matching raster.
This is AI sight review, not human review. One medium and eighteen low findings have explicit
accepted-risk or follow-up dispositions: split-card frames, identifier wrapping, print disclosure,
ratio wording and short-list continuations remain documented presentation costs. Full desktop
captures were downscaled; fine-text judgement rests on tablet/mobile tiles and A4 evidence.
This local sight review does not establish Ubuntu visual review. The separate Linux technical
diagnostic measured LiberationSerif, LiberationSans and DejaVuSansMono resolution and 3/8/9/9
A4 pages versus macOS 3/9/9/9. JSON remains canonical.
The information contract and the reproducible 32-cell screen/print review are documented in
[`docs/reporting.md`](docs/reporting.md).

## Requirements

Node 22.13 or newer, on macOS or Linux. The floor is exact because `pdfjs-dist@6.2.108` requires
Node 22.13 or Node 24, and the release gate installs the packed package on both Node 22.13 and 24.
A live run additionally needs a Chromium-based browser, `puppeteer-core` at `>=25.8.0 <26` (the
declared peer range) and `pagedjs@0.4.3`. `pdfjs-dist` is what rasterises the produced PDF to bind evidence to findings; a
run without it still measures and still reports, but the findings carry no evidence and the report
says so rather than pretending otherwise. Poppler's `pdftoppm` is **not** used by the tool at all: the live test suite uses
it as an independent rasteriser, so that Chrome is not both the producer and the sole judge of
every PDF. It is never shipped and never called at check time.

```bash
npm i -D puppeteer-core@^25.8.0 pagedjs@0.4.3 pdfjs-dist@6.2.108
```

## Running foreign HTML

This tool executes foreign HTML including its scripts. It uses a fresh browser profile per run,
never asks for the sandbox to be off and has no flag that does, and by default lets no page
request through except to its own loopback origin. That protects against mistakes and badly built
documents. It is **not** an egress control and **not** protection against someone deliberately
attacking the browser:

- The request policy does not cover WebSocket, WebTransport or WebRTC connections a document
  opens, nor the browser's own secure DNS and component updater traffic. Measured on 0.7.0 in the
  default offline mode: a document's WebSocket to another loopback port was delivered and a WebRTC
  STUN request was sent, and the run came back clean.
- breaklint refuses `PUPPETEER_DANGEROUS_NO_SANDBOX` and
  `PUPPETEER_TEST_EXPERIMENTAL_CHROME_FEATURES` before launch and strips `CHROME_EXTRA_FLAGS`
  from Chrome's child environment. Other browser or wrapper variables are not proven safe;
  isolate untrusted documents at the operating-system boundary.

For untrusted third-party HTML, use a container or network namespace with no egress. Details are
in [SECURITY.md](SECURITY.md).

## How this was made

Parts of this repository were written with the help of large language models: the initial
implementation of several rules, most of the test fixtures, and the first draft of this
documentation. The rule definitions document their thresholds and sources; new checks may be implemented and reviewed with AI assistance. Every
rule that cites the German orthography ruleset was checked against the published text of that
ruleset, not against a model's summary of it.

`breaklint` itself uses no model at check time. It performs no inference and contains no API
client — see `package.json`, whose only runtime dependency is a HTML parser, and the offline
network default in `src/config/resolve.ts`.

This notice is voluntary.

## Help test it

The useful report is the page where human judgement and the checker disagree. Anyone can run the
public, unpaid [community test](docs/community-testing.md); there is no application or selection.
Use only material you may publish. Security findings still go through [`SECURITY.md`](SECURITY.md),
never a public issue. Community reports are additional QA, not blind annotations or calibration
evidence, and all fifteen released rules remain `calibrated: false`.

## License

MIT — free for commercial use.

Dependencies are restricted to permissive licences: MIT, ISC, BSD-2-Clause, BSD-3-Clause,
Apache-2.0, 0BSD, Unlicense and CC0-1.0. The check walks the whole installed tree, so runtime
and development dependencies are both covered, and a package with no licence field fails it.
It runs in CI on every push to `main` and on every pull request.
