# `layout/widow`

| | |
|---|---|
| severity | warn |
| threshold | the element's own `widows` value |
| proof source | — |
| calibrated | **no** |

## What is checked

The opening fragment of a block on a page carries fewer lines than the author asked for.

## Why

**`error` is permanently excluded.** CSS Fragmentation Level 3 §4.3 drops the widow/orphan rule when keeping it would leave too few break points. So `lines < widows` does not prove a defect — it may be exactly the relaxation the specification permits, and this version has no way to prove the relaxation was unwarranted.

The earlier justification for the downgrade was itself unmeasured: *in 230 runs no violation occurred*. At `widows: 6; orphans: 6` a 9-line paragraph with room for 8 lines splits 6+3, which **is** a violation — a permitted one, because widows+orphans = 12 exceeds the 9 lines and no conforming split exists. The browser kept `orphans` and relaxed `widows`. A run that fails to produce a case has not shown the case does not exist; this one is now pinned by `tests/live/fragmentation-levers.test.ts`.

## Limits and known false alarms

A block set in the columns of a multi-column ancestor — the container's `column-count` other than `auto` or `1`, or any `column-width` — is declined as `env/multicolumn`, like a block with columns of its own; the decline counts against coverage. `column-count` is not inherited, so through 0.6.0 such a block was measured on the union of its column fragments. A `column-span: all` direct child of the container lies across the columns and is measured. A block with a `column-width` of its own (`columns: 8em`) is in columns as well and is declined the same way; so is every block of a document whose `html` or `body` sets columns. A block on a page withdrawn because content lies past its page box (`env/pagination-residue`: Paged.js left it in its overflow column, and the PDF does not print it) is declined, and the decline counts against coverage.

A block with no visible text line is skipped: there is no text to strand. Without that, a fragment carrying only a figure was reported as a widow with *0 lines* — found by the corpus cross-check, not by review.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

## Remediation

<!-- begin generated remediation: layout/widow -->
A block fragments across a page break and the fragment OPENING the next page carries fewer lines than the block's own 'widows' value (plus any configured extra lines) asks for. Chromium applies a paragraph's 'widows' and 'orphans' when Paged.js splits it; when the paragraph has too few lines at the break to satisfy both, the browser keeps 'orphans' and relaxes 'widows', as CSS Fragmentation Level 3 permits, so this rule is only a warning. Changing the block's 'widows' moves the threshold with it and is not a fix. For paragraphs, keep the block together with 'break-inside: avoid', force an earlier break with 'break-before: page', or reword/re-space the text. If this occurs inside a table row, keep the row together with 'tr { break-inside: avoid; }'.
<!-- end generated remediation: layout/widow -->

> [!NOTE]
> Chromium applies `widows` when Paged.js splits a paragraph. Paged.js 0.4.3 never reads the
> property, but it cuts every page where the browser's own column fragmentation broke, and the
> browser honours `widows` there: over one geometry, `widows` 1, the initial 2 and 5 split a
> 9-line paragraph 8+1, 7+2 and 4+5. `tests/live/fragmentation-levers.test.ts` pins those splits
> and goes red when the browser stops producing them. Earlier versions of this page and of the
> advice said the opposite without having asked the browser.
>
> The value is also this rule's threshold, so changing it moves the threshold and is not a fix.
> What is left for this rule to report is a split the browser had to relax.

## Examples

### Firing case (trigger)

```html
<p style="margin-top: 220mm;">
  This paragraph begins near the bottom of the page.<br>
  It continues for another line.<br>
  And leaves a lone third line on the second page.
</p>
```

### Non-firing case (remedied)

```html
<p style="margin-top: 220mm; break-inside: avoid;">
  This paragraph begins near the bottom of the page.<br>
  It continues for another line.<br>
  And moves entirely to the second page rather than leaving a widow.
</p>
```

