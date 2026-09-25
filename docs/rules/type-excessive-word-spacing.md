# `type/excessive-word-spacing`

| | |
|---|---|
| severity | warn |
| threshold | > 3.0× the natural space |
| proof source | — |
| calibrated | **no** |

## What is checked

Word gaps in a justified block are far wider than the natural space.

## Why

The threshold is chosen. Word boxes are held for every line of every justified block; an earlier version limited them to a window around page boundaries, which contradicted the rule that needs them. Keeping them all costs a measured 4 221 bytes per page — about 8 MiB over 2 000 pages.

## Limits and known false alarms

A block set in the columns of a multi-column ancestor — the container's `column-count` other than `auto` or `1`, or any `column-width` — is declined as `env/multicolumn`, like a block with columns of its own; the decline counts against coverage. `column-count` is not inherited, so through 0.6.0 such a block was measured on the union of its column fragments. A `column-span: all` direct child of the container lies across the columns and is measured. A block with a `column-width` of its own (`columns: 8em`) is in columns as well and is declined the same way; so is every block of a document whose `html` or `body` sets columns. Its lines would be grouped across the columns, and the column gap read as a word gap. A block on a page withdrawn because content lies past its page box (`env/pagination-residue`: Paged.js left it in its overflow column, and the PDF does not print it) is declined, and the decline counts against coverage.

Blocks with an explicit `word-spacing` are out: the width is a stated intention. Table cells are out: a justified cell has no room to do better.

A justified block that was not rendered — no layout box and no line boxes — has no gaps: the
in-flow original of a running element, hidden with `display: none`, is recorded as `excluded`
(`rule/target-not-rendered`), outside the coverage base. A `display: contents` block has no box but
prints its lines, and it is measured from them like any other block. Text inside a margin box is not
measured. See `docs/limitations.md`.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

## Remediation

<!-- begin generated remediation: type/excessive-word-spacing -->
Justified text produces word spacing exceeding the uncalibrated threshold ('rivers' of whitespace). Use left alignment ('text-align: left;'), insert soft hyphens ('&shy;') into long words, or enable hyphenation with 'hyphens: auto;' together with an HTML 'lang' attribute. Automatic hyphenation happens only where the rendering browser has a hyphenation dictionary for that language; where it has none, 'hyphens: auto' changes nothing and soft hyphens are the lever that works. This rule owns the block-level 'hyphens' setting and the soft hyphens of justified text: where a hyphen, soft or automatic, then falls on a page boundary, 'layout/hyphen-across-page' changes only that word and neither turns hyphenation off nor removes soft hyphens for the block.

**Precedence.** `hyphens` in justified blocks: this rule owns the block-level setting, and [`layout/hyphen-across-page`](layout-hyphen-across-page.md) defers to it, acting only on the affected word.

**Precedence.** Soft hyphens (`&shy;`) in justified blocks: this rule owns where they are inserted, and [`layout/hyphen-across-page`](layout-hyphen-across-page.md) defers to it, acting only on the affected word.
<!-- end generated remediation: type/excessive-word-spacing -->

## Examples

### Firing case (trigger)

```html
<p style="width: 400px; font-size: 16px; text-align: justify; line-height: 1.4;">
  One Two PneumonoultramicroscopicsilicovolcanoconiosisIsAnExtremelyLongUnbrokenWordThatForcesALineBreak right after two words so that line one has a massive gap.
</p>
```

### Non-firing case (remedied)

```html
<p style="width: 400px; font-size: 16px; text-align: left; line-height: 1.4;">
  One Two PneumonoultramicroscopicsilicovolcanoconiosisIsAnExtremelyLongUnbrokenWordThatForcesALineBreak right after two words so that line one has a massive gap.
</p>
```

