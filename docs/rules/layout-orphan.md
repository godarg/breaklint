# `layout/orphan`

| | |
|---|---|
| severity | warn |
| threshold | the element's own `orphans` value |
| proof source | — |
| calibrated | **no** |

## What is checked

The closing lines of a block on a page are fewer than the author asked for.

## Why

The mirror of `layout/widow`, with the same permanent ceiling of `warn` for the same reason: CSS Fragmentation Level 3 §4.3 lets the browser drop the widow/orphan rule when no conforming split exists, so `lines < orphans` does not prove a defect.

## Limits and known false alarms

A block set in the columns of a multi-column ancestor — the container's `column-count` other than `auto` or `1`, or any `column-width` — is declined as `env/multicolumn`, like a block with columns of its own; the decline counts against coverage. `column-count` is not inherited, so through 0.6.0 such a block was measured on the union of its column fragments. A `column-span: all` direct child of the container lies across the columns and is measured. A block on a page withdrawn because content lies past its page box (`env/pagination-residue`: Paged.js left it in its overflow column, and the PDF does not print it) is declined, and the decline counts against coverage.

Skipped after a forced outgoing break, and on blocks with no visible text line.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

## Remediation

<!-- begin generated remediation: layout/orphan -->
A block fragment ENDS at a page break carrying fewer lines than the block's own 'orphans' value (plus any configured extra lines) asks for. Chromium applies a paragraph's 'widows' and 'orphans' when Paged.js splits it, and moves the whole paragraph to the next page when the page has room for fewer lines than 'orphans'; CSS Fragmentation Level 3 still permits a split that keeps fewer, so this rule is only a warning. Changing the block's 'orphans' moves the threshold with it and is not a fix. For paragraphs, move the block onto the next page with 'break-inside: avoid' or 'break-before: page', or reword/re-space the text. If this occurs inside a table row, keep the row together with 'tr { break-inside: avoid; }'.
<!-- end generated remediation: layout/orphan -->

> [!NOTE]
> Chromium applies `orphans` when Paged.js splits a paragraph. Paged.js 0.4.3 never reads the
> property, but it cuts every page where the browser's own column fragmentation broke, and the
> browser honours `orphans` there. With room for one line of a 9-line paragraph, the fixture's
> `orphans` 1 case splits it 1+8 while the initial 2 and `orphans: 4` move it whole to the next
> page; with room for three lines, the 1 case and the initial value split it 3+6 and
> `orphans: 4` moves it.
> `tests/live/fragmentation-levers.test.ts` pins those splits and goes red when the browser stops
> producing them. Earlier versions of this page and of the advice said the opposite without
> having asked the browser.
>
> The value is also this rule's threshold, so changing it moves the threshold and is not a fix.

## Examples

### Firing case (trigger)

```html
<p style="margin-top: 235mm;">
  First line of paragraph at the very bottom of page 1.<br>
  Remaining lines flow onto page 2.
</p>
```

### Non-firing case (remedied)

```html
<p style="margin-top: 235mm; break-inside: avoid;">
  First line of paragraph moves to page 2.<br>
  Remaining lines flow on page 2.
</p>
```

