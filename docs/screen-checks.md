# Screen checks (Playwright)

`checkPage(page, options)` measures the layout of a page that your Playwright test has already
opened: horizontal overflow, content cut off by its container, SVG text outside its viewport and,
on request, overlapping siblings, small text and small touch targets. It measures the rendered
page in CSS pixels; it does not paginate and makes no page or PDF claims.

Screen checks are **uncalibrated** (0.11 extended their rules and options): start in report mode,
read what they find on your pages, then turn the result into an assertion.

## A test in two steps

```ts
import { test, expect } from '@playwright/test';
import { checkPage } from 'breaklint';

test('account overview', async ({ page }, testInfo) => {
  await page.goto('/account');              // navigation, sign-in and data setup stay yours
  const { ok, report } = await checkPage(page, {
    trust: 'host-controlled-page',          // required: your test owns this page
    networkPolicy: 'host-owned',            // required: your test controls its network
    scenario: 'account-overview',
    output: { dir: testInfo.outputPath('breaklint'), screenshot: 'viewport' },
  });
  await testInfo.attach('breaklint.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });

  expect(ok).toBe(true);                    // step 1, report mode: passes even with findings
  // expect(report.runVerdict).toBe('clean'); // step 2, gate: fails on any finding at or above failOn
});
```

`ok` is `true` when the verdict is `clean` or `findings`, and `false` for `insufficient-coverage`
and `infrastructure`. A runnable version against a static page is in
[`examples/playwright/`](../examples/playwright/layout.spec.ts).

`checkPage` does not import Playwright, navigate, change authentication or network policy, alter
what the page shows, or close it. It reads the page through `evaluate`, `screenshot`, `url`,
`viewportSize` and `context().browser()`.

## Options

The options object is closed: an unknown field, a malformed value or a selector the browser cannot
parse is rejected with a `TypeError` naming the field, before the first measurement.
`SCREEN_OPTIONS_SCHEMA` is the same contract as a JSON Schema.

| option | required | meaning |
|---|---|---|
| `trust` | yes | must be `"host-controlled-page"`: the page belongs to your test |
| `networkPolicy` | yes | must be `"host-owned"`: your test controls the page's network |
| `scenario` | yes | a name for this state of the page; it appears in the report |
| `output.dir` | yes | where the screenshot evidence is written |
| `output.screenshot` | yes | `"viewport"` or `"full-page"` (full-page measures the whole document) |
| `failOn` | no | `"warn"` (default) or `"error"`: the lowest severity that makes the verdict `findings` |
| `geometry.rules` | no | opt-in rules, see below |
| `geometry.allowedScrollContainers`, `geometry.intentionalOverlays` | no | declared exceptions, see below |
| `geometry.stabilizationTimeoutMs` | no | wait for a stable layout, 0–15000 ms (default 2000) |
| `geometry.maxTargets` | no | elements measured, 1–5000 (default 2000); more makes the inventory incomplete |
| `projectId`, `documentId`, `runId` | no | identifiers copied into the report |
| `sourceBinding` | no | binds findings to build containers, see below |

## Rules

| rule | default | severity | finding when |
|---|---|---|---|
| `web/unexpected-horizontal-overflow` | on | error | an element's content is wider than its box (overflow > 0 px) |
| `web/content-clipped` | on | error | visible content is cut by an ancestor with `overflow: hidden` or `clip` |
| `web/svg-text-overflows-viewport` | on | error | SVG text extends more than 1 px beyond the SVG viewport that clips it |
| `web/sibling-overlap` | opt-in: `geometry.rules.siblingOverlap: true` | warn | two visible HTML siblings overlap by more than 2 px |
| `web/small-text` | opt-in: `geometry.rules.smallText` | warn | computed `font-size` of an element with its own text is below 12 px |
| `web/small-touch-target` | opt-in: `geometry.rules.smallTouchTarget` | warn | a link or control is smaller than 24 px in either dimension |

The two size thresholds can be set: `geometry.rules.smallText: { minFontSizePx: 4–72 }` and
`geometry.rules.smallTouchTarget: { minSizePx: 8–96 }`; `true` uses 12 px and 24 px. Every threshold is
uncalibrated and recorded in each measurement.

- **Overflow** is measured on HTML boxes and the outer `<svg>`, not on elements inside it. SVG
  text is judged against its SVG viewport, and one clipped label gives one finding. SVG content cut
  only by its SVG viewport is not `content-clipped`; clipping by an HTML ancestor is reported.
- **Sibling overlap** is off by default because intentional layering is common. Name an intended
  overlay, such as a badge, in `intentionalOverlays`.
- **Small text** reads the computed font size; scaling through an SVG `viewBox` or a CSS
  `transform` is not applied, so scaled text can be reported too small or missed.
- **Small touch targets** is a size heuristic, not a WCAG 2.5.8 check. A link inside running text
  (a block with other letters or digits outside links and buttons) is exempt. Links in a navigation
  landmark, link rows separated only by `|`, `·` or `›`, and a link that is the only text of its
  block are measured.

With `failOn: "error"`, warnings stay in the report and do not make the verdict `findings`.

## Exceptions

Both exception lists take `{ selector, reason, scope? }`.

- **`allowedScrollContainers`** — an element that scrolls sideways on purpose. Only its own
  horizontal overflow and the clipping it causes are exempt; its descendants are still measured.
  A wide child that overflows by itself (a long `<pre>` line, for example) is still reported: name
  it too, or fix it.
- **`intentionalOverlays`** — an element that covers others on purpose, such as an open dialog.
  Its whole subtree is exempt.
- **`scope`** — `"scenario"` (default) reports an exception that matched nothing
  (`screen-exception-unused`); `"suite"` keeps the count but stays quiet, for exceptions shared by
  many tests.
- **`html` and `body`** — an exception that matches either would exempt the whole page. It emits
  `screen-exception-too-broad`, and the verdict is `insufficient-coverage`.

## Stabilization

Before measuring, `checkPage` waits for document fonts and then for two identical layout samples
taken while no font is loading, within `stabilizationTimeoutMs`. If that does not happen, the run
reports why — `screen-stabilization-timeout`, `screen-stabilization-attempt-limit` (20 samples),
`screen-fonts-not-ready` or `screen-capture-drift` (two samples really differed) — and does not
claim a clean result. `capture.stabilizationEndedBy` names how the wait ended. `0` waits for
nothing and is reported as a timeout. A page that does not answer the first sample ends as
`infrastructure`, without a screenshot.

Capture signatures (`capture.before`, `stable`, `after`) are keyed per run: they compare within
one run, not across runs. A text change in the drift details records only the text lengths.

## Source locations

Without `sourceBinding`, a finding names its element by selector and DOM path. With it, breaklint
can name the source file of a build container in three levels:

| level | meaning |
|---|---|
| `unknown` | no binding was requested |
| `declared` | containers were named, but the build could not be proven |
| `verified-container-only` | the page was proven to come from the receipted build; the finding names the container's file, never a source line |

A binding is verified only when breaklint reads the host's build receipt (Next.js output receipt
version 1, or the framework-agnostic output receipt version 2) and every source and output digest
in it, before and after the screenshot, and the page renders both the build ID
(`compiledBuildAttribute`) and the output ID (`compiledOutputAttribute`) on the element
`compiledBuildSelector` selects. Without the rendered output ID, or when it differs, the binding
stays `declared`: two builds of the same sources share a build ID. With an output receipt of
version 2, name a `buildMarkerPath`. Without one, the receipt's `buildId` must equal its
`filesSha256`, and the page must render that hash, which a page listed in `files` cannot hold. [`source-bound-findings.md`](source-bound-findings.md)
describes the receipts.

## Reports

`checkPage` returns `{ ok, report }`. The report has `profileKind: "screen"` and `schemaVersion: 2`;
breaklint's readers (`renderReport`, `writeReportBundle`, `createContextPack`, and the CLI's
`context` and `bundle`) accept Screen 1 and 2. It records the route, viewport and coordinate system
(`css-viewport-pixels` or `css-document-pixels`), browser version, screenshot hash and size, every
target evaluation, coverage counts and typed events, and `runVerdict` and `exitCode` as the CLI
would report them. [`reporting.md`](reporting.md) describes the formats.

## What is not measured

- Elements that are not rendered: hidden, off-viewport (in a viewport capture), the body of a
  closed `<details>`, content under `content-visibility: hidden`, and elements whose effective
  opacity is 0. They are excluded, never reported as fine.
- Non-axis-aligned transforms, masks, clip paths and running animations: the affected targets are
  not measured, and the page gets no clean verdict.
- Ordinary vertical scrolling and general visual occlusion.
- Colour contrast and accessibility in general; use an accessibility checker for that.

More limits, for print and screen: [`known-limits.md`](known-limits.md).
