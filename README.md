# breaklint

Find page-break and layout bugs in HTML-to-PDF output (Paged.js) and in your Playwright pages — measured on the rendered page, with source locations and CI-ready exit codes.

breaklint paginates your HTML itself, with Paged.js 0.4.3 in Chrome. If your PDF comes from
another engine (Chrome's own print, WeasyPrint, Prince), its page breaks can differ from what
breaklint measured.

It reports what a browser preview hides: widows and orphans, blocks too tall for a page, tables that lose their header, clipped SVG labels.

[![npm](https://img.shields.io/npm/v/breaklint.svg)](https://www.npmjs.com/package/breaklint)
[![ci](https://github.com/godarg/breaklint/actions/workflows/ci.yml/badge.svg)](https://github.com/godarg/breaklint/actions/workflows/ci.yml)
[![licence](https://img.shields.io/npm/l/breaklint.svg)](https://github.com/godarg/breaklint/blob/v0.11.1/LICENSE)

![Before: page 2 of a sample report is empty below its heading; a table marked break-inside: avoid is 2013 px tall on a 650 px page, exit 1. After: the table breaks between rows, page 1 holds heading and rows, exit 0.](https://raw.githubusercontent.com/godarg/breaklint/v0.11.1/assets/breaklint-before-after.png)

## Try it

```bash
npx breaklint --demo
```

It needs no browser: the real rules run over a stored page snapshot that contains findings on
purpose, so the demo ends with exit 1. Below is one of its five findings and the closing counters,
shortened where marked `…`, copied from that command's output:

```
error svg/text-overflows-viewport  page 5
  measured   72 px; threshold 0 px (uncalibrated)
  detail     This text extends 72.00 px beyond the SVG viewport …
  remedy     … Enlarge the SVG 'viewBox' or its width/height …
  …

… · pages analysed: 5 · rules run: 12 · … · verdict: findings · …
```

**No threshold is calibrated.** Fixtures show that each rule does what it says, not that its
threshold suits your documents. Every finding says `uncalibrated`.

## Install

Node 22.13 or newer, macOS or Linux, and a Chromium-based browser:

```bash
npm i -D breaklint puppeteer-core@^25.16.0 pagedjs@0.4.3 pdfjs-dist@6.2.108
```

breaklint finds an installed Chrome or Chromium; otherwise set
`BREAKLINT_CHROME=/path/to/chrome`. For `checkPage` in Playwright tests, `npm i -D breaklint` is
enough; the browser is Playwright's. `--demo` needs only `breaklint`; without `pdfjs-dist`,
findings carry no page image.

## Check HTML for PDF

```bash
npx breaklint dist/print/*.html      # the shell expands the glob
npx breaklint --format json --out report.json book.html
```

`--format` also takes html, sarif, junit and markdown. A finding names the file and line of its
element in your HTML, except for elements the paginator creates. Each run writes one PNG per page
and the checked PDF to `./breaklint-report`; `--out-dir` moves it. Options, profiles and
`breaklint.config.json`:
[configuration](https://github.com/godarg/breaklint/blob/v0.11.1/docs/configuration.md).

## Check Playwright pages

`checkPage` measures a page your Playwright test has already opened and signed in to. It does not
navigate or close the page.

```ts
import { test, expect } from '@playwright/test';
import { checkPage } from 'breaklint';

test('dashboard layout', async ({ page }, testInfo) => {
  await page.goto('/dashboard');
  const { ok, report } = await checkPage(page, {
    trust: 'host-controlled-page',   // required: your test owns this page
    networkPolicy: 'host-owned',     // required: your test owns the network
    scenario: 'dashboard',
    output: { dir: testInfo.outputPath('breaklint'), screenshot: 'viewport' },
    failOn: 'error',
  });
  await testInfo.attach('breaklint.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  // report mode: measured enough to judge
  expect(ok).toBe(true);
  // gate mode: no finding at or above failOn
  // expect(report.runVerdict).toBe('clean');
});
```

Screen checks are new and uncalibrated: start in report mode, read the findings, then switch to
the gate. Runnable example:
[`examples/playwright/`](https://github.com/godarg/breaklint/blob/v0.11.1/examples/playwright/layout.spec.ts);
options, rules and exceptions: [screen checks](https://github.com/godarg/breaklint/blob/v0.11.1/docs/screen-checks.md).

## What is checked

Print: seventeen rules. Two fail a build by default; the others warn, and five run only when enabled.

| rule | measures | default |
|---|---|---|
| [`layout/widow`](https://github.com/godarg/breaklint/blob/v0.11.1/docs/rules/layout-widow.md) | lines in the opening fragment against the element's own `widows` | warn |
| [`layout/orphan`](https://github.com/godarg/breaklint/blob/v0.11.1/docs/rules/layout-orphan.md) | lines in the closing fragment against its own `orphans` | warn |
| [`layout/unbreakable-block-too-tall`](https://github.com/godarg/breaklint/blob/v0.11.1/docs/rules/layout-unbreakable-block-too-tall.md) | a `break-inside: avoid` block taller than the page | **error** |
| [`layout/heading-at-page-bottom`](https://github.com/godarg/breaklint/blob/v0.11.1/docs/rules/layout-heading-at-page-bottom.md) | space under a heading at the page foot | warn |
| [`layout/orphaned-continuation-page`](https://github.com/godarg/breaklint/blob/v0.11.1/docs/rules/layout-orphaned-continuation-page.md) | a page holding only the tail of a block | warn |
| [`layout/hyphen-across-page`](https://github.com/godarg/breaklint/blob/v0.11.1/docs/rules/layout-hyphen-across-page.md) | a word hyphenated across a page break | warn |
| [`svg/text-overflows-viewport`](https://github.com/godarg/breaklint/blob/v0.11.1/docs/rules/svg-text-overflows-viewport.md) | SVG text outside its viewport | **error** |
| [`type/spaced-hyphen`](https://github.com/godarg/breaklint/blob/v0.11.1/docs/rules/type-spaced-hyphen.md) | a spaced hyphen where a dash belongs | warn |
| [`type/straight-quotes`](https://github.com/godarg/breaklint/blob/v0.11.1/docs/rules/type-straight-quotes.md) | typewriter quotes in prose | warn |
| [`type/short-last-line`](https://github.com/godarg/breaklint/blob/v0.11.1/docs/rules/type-short-last-line.md) | a very short closing line | warn |
| [`type/excessive-word-spacing`](https://github.com/godarg/breaklint/blob/v0.11.1/docs/rules/type-excessive-word-spacing.md) | stretched word gaps | warn |
| [`artifact/local-uri`](https://github.com/godarg/breaklint/blob/v0.11.1/docs/rules/artifact-local-uri.md) | `file:` URIs and machine paths | warn |
| [`layout/half-empty-page`](https://github.com/godarg/breaklint/blob/v0.11.1/docs/rules/layout-half-empty-page.md) | a page left mostly empty (experimental, never gates) | off |
| [`figure/caption-separated`](https://github.com/godarg/breaklint/blob/v0.11.1/docs/rules/figure-caption-separated.md) | a figure or table on another page than its caption | off |
| [`figure/dangling-reference`](https://github.com/godarg/breaklint/blob/v0.11.1/docs/rules/figure-dangling-reference.md) | a local figure link without a target | off |
| [`layout/table-header-not-repeated`](https://github.com/godarg/breaklint/blob/v0.11.1/docs/rules/layout-table-header-not-repeated.md) | a continued table without its header | off |
| [`layout/table-column-drift`](https://github.com/godarg/breaklint/blob/v0.11.1/docs/rules/layout-table-column-drift.md) | continued columns shifting against the header | off |

`--fail-on warn` lets warnings fail the run; `--profile strict` enables all seventeen.

Screen (`checkPage`): `web/unexpected-horizontal-overflow`, `web/content-clipped` and
`web/svg-text-overflows-viewport` are errors and on by default; `web/sibling-overlap`,
`web/small-text` (under 12 px) and `web/small-touch-target` (under 24 px) are opt-in warnings.

Documentation index: [docs](https://github.com/godarg/breaklint/blob/v0.11.1/docs/README.md).

## CI and GitHub Action

```yaml
- uses: godarg/breaklint@v0.11.1
  with:
    paths: |
      dist/print/**/*.html
```

The Action fails the step on breaklint's exit code and writes SARIF, JUnit and a step summary.
Its path expansion needs Bash 4 or newer with globstar.
[CI recipe](https://github.com/godarg/breaklint/blob/v0.11.1/docs/ci-recipe.md): workflow,
permissions, pinning.

## Exit codes

| code | meaning |
|---|---|
| 0 | checked, coverage met, nothing reached the threshold |
| 1 | a finding reached the threshold |
| 2 | invalid invocation or input; no report is written |
| 3 | infrastructure: renderer, font, pagination or output failed |
| 4 | too little was measured to judge |

`checkPage` returns the same verdicts without exiting. The subcommands `compare`, `context` and
`bundle` have their own codes:
[reporting](https://github.com/godarg/breaklint/blob/v0.11.1/docs/reporting.md#exit-codes-of-the-subcommands).

## Untrusted HTML

breaklint runs the document's scripts in Chrome (fresh profile, sandbox on) and blocks page
requests except to its own loopback origin. That is not an egress control: WebSocket, WebRTC and
the browser's own traffic are not covered. Check untrusted HTML in a container without network
access; see [SECURITY.md](https://github.com/godarg/breaklint/blob/v0.11.1/SECURITY.md).

## Limits

- **Uncalibrated.** No threshold is backed by a labelled corpus of real documents.
- **Paged.js 0.4.3 is the measured paginator.** Any other installed version ends with exit 3.
- **Footnotes.** A document using Paged.js footnotes ends with exit 3.
- **macOS and Linux.** Live runs do not work on Windows.
- **Fonts must load.** A font that fails to load stops the run instead of producing phantom findings.
- **Isolate foreign HTML.** The request blocking protects against mistakes, not against attacks.

Not a PDF validator, visual diff or prose linter: use veraPDF, BackstopJS or vale for those. More
limits: [known limits](https://github.com/godarg/breaklint/blob/v0.11.1/docs/known-limits.md).

## How this was made

breaklint was written with AI assistance: code, tests and documentation. Rules that cite a CSS
specification or the German orthography rules were checked against the published text, and their
behaviour against measurements in a real browser. breaklint contains no language model and sends
no document anywhere.

## Help calibrate it

Found a page where breaklint and your eye disagree? The
[community test](https://github.com/godarg/breaklint/blob/v0.11.1/docs/community-testing.md) takes
about ten minutes; use only material you may publish.

## License

MIT. Runtime and development dependencies are limited to permissive licences, checked in CI.
