# breaklint

Find page-break and layout bugs in HTML-to-PDF output (Paged.js) and in your Playwright pages — measured on the rendered page, with source locations and CI-ready exit codes.

It reports what a browser preview hides: widows and orphans, blocks too tall for a page, tables that lose their header, clipped SVG labels.

breaklint paginates with its own Paged.js 0.4.3 in Chrome; a PDF from Chrome's print, WeasyPrint
or Prince can break pages differently.

[![npm](https://img.shields.io/npm/v/breaklint.svg)](https://www.npmjs.com/package/breaklint)
[![ci](https://github.com/godarg/breaklint/actions/workflows/ci.yml/badge.svg)](https://github.com/godarg/breaklint/actions/workflows/ci.yml)
[![licence](https://img.shields.io/npm/l/breaklint.svg)](https://github.com/godarg/breaklint/blob/v0.11.1/LICENSE)

![Before: a table that must not break leaves printed page 2 empty, exit 1. After: it breaks between rows, exit 0.](https://raw.githubusercontent.com/godarg/breaklint/v0.11.1/assets/breaklint-before-after.png)

*Before:* a `break-inside: avoid` table, 2013 px tall on a 650 px page, leaves page 2 empty below
its heading; exit 1. *After:* its rows may break; exit 0.

## Try it

```bash
npx breaklint --demo
```

No browser needed: the rules run over a stored snapshot with planted bugs, so the demo
exits 1. One of its five findings and the counter line, as printed (`…` marks cuts):

```
error svg/text-overflows-viewport  page 5
  measured   72 px; threshold 0 px (uncalibrated)
  detail     This text extends 72.00 px beyond the SVG viewport …
  …

inputs found: 1 · pages analysed: 5 · rules run: 12 · …
```

**No threshold is calibrated:** fixtures show that each rule does what it says, not that its
threshold suits your documents.

## Install

Node 22.13 or newer, macOS or Linux, and a Chromium-based browser:

```bash
npm i -D breaklint puppeteer-core@^25.16.0 pagedjs@0.4.3 pdfjs-dist@6.2.108
```

breaklint finds an installed Chrome or Chromium; otherwise set
`BREAKLINT_CHROME=/path/to/chrome`. For `checkPage`, `npm i -D breaklint` is enough; the browser
is Playwright's. `--demo` needs only `breaklint`; without `pdfjs-dist`, findings carry no page image.

## Check HTML for PDF

```bash
npx breaklint dist/print/*.html      # the shell expands the glob
npx breaklint --format json --out report.json book.html
```

A finding names its element's file and line in your HTML (not for elements the paginator
creates), as in the run behind the image (`…` marks cuts):

```
error layout/unbreakable-block-too-tall  page 2
  …
  source     …/before.html:24
```

**Typography is checked as German (`de-DE`) by default.** For English, pass `--locale en-US` or
set `"locale"` in `breaklint.config.json`; the `type/*` rules skip text in another `lang`.

`--format` also takes html, sarif, junit and markdown. Each run writes one PNG per page and the
checked PDF to `./breaklint-report`; `--out-dir` moves it. Options and profiles:
[configuration](https://github.com/godarg/breaklint/blob/v0.11.1/docs/configuration.md).

## Check Playwright pages

`checkPage` measures a page your Playwright test has opened; it never navigates or closes it.

```ts
import { test, expect } from '@playwright/test';
import { checkPage } from 'breaklint';

test('dashboard layout', async ({ page }, testInfo) => {
  await page.goto('/dashboard');
  const { ok, report } = await checkPage(page, {
    trust: 'host-controlled-page',   // required: your test owns this page
    networkPolicy: 'host-owned',     // required: your test controls its network
    scenario: 'dashboard',
    output: { dir: testInfo.outputPath('breaklint'), screenshot: 'viewport' },
    failOn: 'error',                 // errors gate; warnings stay in the report
  });
  await testInfo.attach('breaklint.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  expect(ok, 'breaklint could not measure the page').toBe(true);
  // ok is true with findings too; this line fails the test on them:
  expect(report.runVerdict, 'findings: see breaklint.json').toBe('clean');
});
```

Screen checks are uncalibrated: for a first run, drop the last line and read the findings. Runnable example:
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

All docs: [index](https://github.com/godarg/breaklint/blob/v0.11.1/docs/README.md).

## CI and GitHub Action

```yaml
- uses: godarg/breaklint@v0.11.1
  with:
    paths: |
      dist/print/**/*.html
```

The Action fails the step on breaklint's exit code and writes SARIF, JUnit and a step summary;
it needs Bash 4 or newer with globstar.
[CI recipe](https://github.com/godarg/breaklint/blob/v0.11.1/docs/ci-recipe.md): workflow,
permissions, pinning.

## Exit codes

| code | meaning |
|---|---|
| 0 | checked, coverage met, nothing reached the threshold |
| 1 | a finding reached the threshold (experimental print rules never gate) |
| 2 | invalid invocation or input; no report is written |
| 3 | infrastructure: renderer, font, pagination or output failed |
| 4 | too little was measured to judge |

`checkPage` returns the same verdicts without exiting. The subcommands `compare`, `context` and
`bundle` have their own codes:
[reporting](https://github.com/godarg/breaklint/blob/v0.11.1/docs/reporting.md#exit-codes-of-the-subcommands).

## Untrusted HTML

breaklint runs the document's scripts in Chrome (fresh profile, sandbox on) and blocks page
requests except to its own loopback origin. That is no egress control: WebSocket, WebRTC and the
browser's own traffic pass. Check untrusted HTML in a container without network; see [SECURITY.md](https://github.com/godarg/breaklint/blob/v0.11.1/SECURITY.md).

## Limits

- **Uncalibrated.** No threshold is backed by a labelled corpus of real documents.
- **Paged.js 0.4.3 is the measured paginator.** Any other installed version ends with exit 3.
- **Footnotes.** A document using Paged.js footnotes ends with exit 3.
- **macOS and Linux.** Live runs do not work on Windows.
- **Fonts must load.** A failed font stops the run instead of producing phantom findings.
- **Isolate foreign HTML.** The request blocking protects against mistakes, not against attacks.

Not a PDF validator, visual diff or prose linter (see veraPDF, BackstopJS, vale). More
limits: [known limits](https://github.com/godarg/breaklint/blob/v0.11.1/docs/known-limits.md).

## How this was made

breaklint was written with AI assistance: code, tests and documentation. Rules citing a CSS
specification or the German orthography rules were checked against the published text and
against measurements in a real browser. breaklint contains no language model and sends
no document anywhere.

## Help calibrate it

Found a page where breaklint and your eye disagree? The
[community test](https://github.com/godarg/breaklint/blob/v0.11.1/docs/community-testing.md) takes
about ten minutes; use only publishable material.

## License

MIT. Runtime and development dependencies are limited to permissive licences, checked in CI.
