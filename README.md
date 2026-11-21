# breaklint

Find page-break and layout bugs in HTML-to-PDF output (Paged.js) and in your Playwright pages — measured on the rendered page, with source locations and CI-ready exit codes.

breaklint reports what a browser preview hides — widows, orphans, blocks too tall for a page,
tables that lose their header, clipped labels — with the measured value, the threshold and where
to look.

[![npm](https://img.shields.io/npm/v/breaklint.svg)](https://www.npmjs.com/package/breaklint)
[![ci](https://github.com/godarg/breaklint/actions/workflows/ci.yml/badge.svg)](https://github.com/godarg/breaklint/actions/workflows/ci.yml)
[![licence](https://img.shields.io/npm/l/breaklint.svg)](https://github.com/godarg/breaklint/blob/v0.11.1/LICENSE)

[![“Perfect in the browser. Broken on page 47.”](https://raw.githubusercontent.com/godarg/breaklint/v0.11.1/assets/breaklint-film-poster.jpg)](https://dargel-solutions.de/en/breaklint/#film)

## Try it

```bash
npx breaklint --demo
```

It needs no browser: the real rules run over a stored page snapshot that contains findings on
purpose, so the demo ends with exit 1. Below is one of its five findings, plus the closing counters, copied from that
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

**No threshold is calibrated.** Fixtures show that each rule does what it says, not that its
threshold suits your documents. Every finding says `uncalibrated`.

## Install

Node 22.13 or newer, macOS or Linux, and a Chromium-based browser:

```bash
npm i -D breaklint puppeteer-core@^25.16.0 pagedjs@0.4.3 pdfjs-dist@6.2.108
```

`--demo` needs only `breaklint`; without `pdfjs-dist`, findings carry no page image.

## Check printed HTML

```bash
npx breaklint dist/print/*.html                          # the shell expands the glob
npx breaklint --format json --out report.json book.html  # also html, sarif, junit, markdown
```

Each run writes one PNG per page and the checked PDF to `./breaklint-report`; `--out-dir` moves it.
Options, profiles and `breaklint.config.json`:
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
    trust: 'host-controlled-page',
    networkPolicy: 'host-owned',
    scenario: 'dashboard',
    output: { dir: testInfo.outputPath('breaklint'), screenshot: 'viewport' },
    failOn: 'error',
  });
  await testInfo.attach('breaklint.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
  expect(ok).toBe(true);                       // report mode: measured enough to judge
  // expect(report.runVerdict).toBe('clean');  // gate mode: no finding at or above failOn
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

| code | `breaklint <files>` | `compare`, `context`, `bundle` |
|---|---|---|
| 0 | checked, coverage met, nothing reached the threshold | output written completely |
| 1 | a non-experimental finding reached the threshold | `compare --fail-on-new`: at least one `new` result |
| 2 | invalid invocation or input; no report is written | invalid invocation or input, or an output that would overwrite an input |
| 3 | infrastructure: renderer, font, pagination or output failed | output not written, or the after report is `infrastructure` |
| 4 | too little was measured to judge | `compare`: after report `insufficient-coverage`, or nothing matchable |

`checkPage` does not exit; its report carries the same verdicts and codes.

## Untrusted HTML

breaklint runs the document's scripts in Chrome (fresh profile, sandbox on) and blocks page
requests except to its own loopback origin. That is not an egress control: WebSocket, WebRTC and
the browser's own traffic are not covered. Check untrusted HTML in a container without network
access; see [SECURITY.md](https://github.com/godarg/breaklint/blob/v0.11.1/SECURITY.md).

## Limits

- **Uncalibrated.** No threshold is backed by a labelled corpus of real documents.
- **Paged.js exactly 0.4.3.** Any other version ends with exit 3.
- **Footnotes.** A document using Paged.js footnotes ends with exit 3.
- **macOS and Linux.** Live runs do not work on Windows.
- **Fonts must load.** A font that fails to load stops the run instead of producing phantom findings.
- **Isolate foreign HTML.** The request blocking protects against mistakes, not against attacks.

What else is declined rather than guessed: [known limits](https://github.com/godarg/breaklint/blob/v0.11.1/docs/known-limits.md).

## How this was made

breaklint was written with AI assistance: code, tests and documentation. Rules that cite a CSS
specification or the German orthography rules were checked against the published text, and their
behaviour against measurements in a real browser. breaklint itself calls no model and no online
service when it checks a document.

## License

MIT. Runtime and development dependencies are limited to permissive licences, checked in CI.
