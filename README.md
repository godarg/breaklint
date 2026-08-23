# breaklint

[![npm](https://img.shields.io/npm/v/breaklint.svg)](https://www.npmjs.com/package/breaklint)
[![ci](https://github.com/godarg/breaklint/actions/workflows/ci.yml/badge.svg)](https://github.com/godarg/breaklint/actions/workflows/ci.yml)
[![node](https://img.shields.io/node/v/breaklint.svg)](https://nodejs.org)
[![licence](https://img.shields.io/npm/l/breaklint.svg)](LICENSE)

`breaklint` is a command-line layout check for people who generate PDFs from HTML: it reports
half-empty pages, widows, orphans and hyphenation across page breaks, each with the measured
value and the threshold it failed.

```bash
npx breaklint --demo
```

That command needs no browser and no configuration. It ends with exit 1, because the demo
fixture contains findings on purpose — a demo that ends 0 never shows you what a finding looks
like. Below is the first of its eight findings, plus the closing counters, copied from that
command's output:

```
error layout/unbreakable-block-too-tall  page 2
  measured   848 px; threshold 606 px (uncalibrated)
  detail     This block asks not to be broken and is 848.00 px tall; the page content box is
             606.00 px. It cannot fit on any page.
  source     examples/demo.html:31
  render     unknown (no evidence produced)

inputs found: 1 · pages analysed: 5 · rules run: 15 · rules that measured something: 13 ·
not measured: 2 · verdict: findings · mode: demo · fail-on: error · gate triggered by: error
```

Every finding carries what was measured, what the threshold was, and the word `uncalibrated` —
because no threshold in this project has been calibrated against real documents, and a number
that hides that is worse than no number.

One thing about that output, since the demo invites the assumption: the rule and reporter chain
running there is the real one, but the page it judges is a **hand-written snapshot**, built so
that every rule path is reachable in a command that needs no browser. `examples/demo.html` is
the document that snapshot describes; it is not shipped, and the run says which kind of fixture
it used in its own `source` field rather than leaving you to guess. Point the tool at your own
HTML and the same chain measures a real page.

## Install

```bash
npm i -D breaklint
```

That is enough for `--demo` and for reading the docs. A run over your own HTML additionally
needs a browser and the paginator; see [Requirements](#requirements).

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

Fifteen rules. Two of them can fail a build by default; twelve more are advisory unless you ask
for more, with `--fail-on warn`; and one — `layout/half-empty-page` — is experimental and never
moves an exit code at all, not even then. That split is not caution, it is the burden of proof:
only two rules compare directly measured quantities against a structural boundary.

| rule | what it measures | default |
|---|---|---|
| [`layout/widow`](docs/rules/layout-widow.md) | lines in the opening fragment against the element's own `widows` | warn |
| [`layout/orphan`](docs/rules/layout-orphan.md) | lines in the closing fragment against its own `orphans` | warn |
| [`layout/unbreakable-block-too-tall`](docs/rules/layout-unbreakable-block-too-tall.md) | height of a `break-inside: avoid` block against the page | **error** |
| [`layout/heading-at-page-bottom`](docs/rules/layout-heading-at-page-bottom.md) | space under a heading, in its own line heights | warn |
| [`layout/half-empty-page`](docs/rules/layout-half-empty-page.md) | summed height of semantic bands over the content box | warn, experimental |
| [`layout/orphaned-continuation-page`](docs/rules/layout-orphaned-continuation-page.md) | a page holding only the tail of an earlier block | warn |
| [`layout/hyphen-across-page`](docs/rules/layout-hyphen-across-page.md) | the paginator's hyphenation class at a page boundary | warn |
| [`svg/text-overflows-viewport`](docs/rules/svg-text-overflows-viewport.md) | CTM-normalised text box against the viewport | **error** |
| [`svg/text-clipped`](docs/rules/svg-text-clipped.md) | glyph ink removed by a clip path or mask | warn |
| [`svg/text-ink-collision`](docs/rules/svg-text-ink-collision.md) | glyph ink shared with, or covered by, a shape | warn |
| [`type/spaced-hyphen`](docs/rules/type-spaced-hyphen.md) | a hyphen between spaces where a dash belongs | warn |
| [`type/straight-quotes`](docs/rules/type-straight-quotes.md) | typewriter quotes in typeset prose | warn |
| [`type/short-last-line`](docs/rules/type-short-last-line.md) | width of a paragraph's closing line | warn |
| [`type/excessive-word-spacing`](docs/rules/type-excessive-word-spacing.md) | word gaps against the natural space | warn |
| [`artifact/local-uri`](docs/rules/artifact-local-uri.md) | `file:` URIs and build-machine paths left in the artefact | warn |

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

**The two SVG ink rules now have a real-renderer validation foundation, but no real-corpus
calibration.** M3-0 exercises their known construction and boundary cases in Chrome/Paged.js;
it does not establish population performance or calibrate a threshold. Treat a finding from
`svg/text-clipped` or `svg/text-ink-collision` as a reason to look at the page rather than as a
measurement to act on unseen.
M3-0 can validate the integrity and bindings of separately supplied capture-evidence bytes, but it
does not ship an externally governed attestor trust root. Therefore no M3-0 path establishes a
calibrated claim; that trust boundary belongs to later real-corpus work.

**`svg/text-ink-collision` does not detect sub-pixel contact.** A shape can touch a glyph
optically without sharing a device pixel. The earlier check for this took its truth from the
same API it was testing, so it was removed; the removal was right and it cost recall.

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
calibration and a human-labelled real corpus remain unfinished. Packaging and the first npm release
are complete; the post-release trust work and remaining validation boundaries are tracked in
`docs/status.md`.

## Exit codes

| code | meaning |
|---|---|
| 0 | checked, coverage met, nothing reached the threshold |
| 1 | at least one non-experimental finding reached the threshold |
| 2 | invalid invocation: unknown option, bad config, input path does not exist |
| 3 | infrastructure: no renderer, font failed, pagination aborted, checker crashed |
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
breaklint --disable layout/half-empty-page report.html
```

A rule you disagree with can be switched off for the whole run — `--disable <rule,...>`, or
`{"rules": {"layout/half-empty-page": false}}` in the config file. There is deliberately no way to
silence a rule at ONE place in a document: an inline suppression comment would be a claim about a
page that nothing checks, and this tool exists because such claims were wrong.

There is no directory recursion and no glob expansion inside the tool. The shell has done this
correctly for fifty years, including symlink cycles.

Configuration is fail-closed JSON in `breaklint.config.json`. Unknown fields, rules and options
end with exit 2 before the input is opened. Values resolve as defaults < profile < config < CLI;
the JSON report records the effective value, its origin and a deterministic configuration
fingerprint. Coverage floors can be raised, never lowered, and the two structural error thresholds
cannot be overridden. The complete contract, profiles, examples and generated schema are in
[`docs/configuration.md`](docs/configuration.md). JavaScript configuration would mean executing
code from a foreign repository inside CI, so it is intentionally unsupported.

The HTML reporter is a self-contained evidence view, not a second source of truth. Its header
distinguishes clean, findings, checker failure and insufficient coverage in words; findings reflow
without a horizontal table on mobile; print uses a verified A4 layout. JSON remains canonical.
The information contract and the reproducible 32-cell screen/print review are documented in
[`docs/reporting.md`](docs/reporting.md).

## Requirements

Node 22.13 or newer, on macOS or Linux. The floor is exact because `pdfjs-dist@6.2.108` requires
Node 22.13 or Node 24, and the release gate installs the packed package on both Node 22.13 and 24.
A live run additionally needs a Chromium-based browser, `puppeteer-core@25.8.x` and
`pagedjs@0.4.3`. `pdfjs-dist` is what rasterises the produced PDF to bind evidence to findings; a
run without it still measures and still reports, but the findings carry no evidence and the report
says so rather than pretending otherwise. Poppler's `pdftoppm` is **not** used by the tool at all: the live test suite uses
it as an independent rasteriser, so that Chrome is not both the producer and the sole judge of
every PDF. It is never shipped and never called at check time.

```bash
npm i -D puppeteer-core@^25.8.0 pagedjs@0.4.3 pdfjs-dist@6.2.108
```

## Running foreign HTML

This tool executes foreign HTML including its scripts. It uses a fresh browser profile per run,
keeps the sandbox on, has no flag that disables it, and blocks every network request by default.
That protects against mistakes and badly built documents. It is **not** protection against
someone deliberately attacking the browser sandbox — for untrusted third-party HTML, use a
container.

## How this was made

Parts of this repository were written with the help of large language models: the initial
implementation of several rules, most of the test fixtures, and the first draft of this
documentation. The rule set, the thresholds and their sources were chosen by a person. Every
rule that cites the German orthography ruleset was checked against the published text of that
ruleset, not against a model's summary of it.

`breaklint` itself uses no model at check time. It performs no inference and contains no API
client — see `package.json`, whose only runtime dependency is a HTML parser, and the offline
network default in `src/config/resolve.ts`.

This notice is voluntary.

## License

MIT — free for commercial use.

Dependencies are restricted to permissive licences: MIT, ISC, BSD-2-Clause, BSD-3-Clause,
Apache-2.0, 0BSD, Unlicense and CC0-1.0. The check walks the whole installed tree, so runtime
and development dependencies are both covered, and a package with no licence field fails it.
It runs in CI on every push to `main` and on every pull request.
