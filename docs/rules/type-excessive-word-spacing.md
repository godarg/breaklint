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

The threshold is chosen. The natural space it multiplies is the block's own font's advance for one
space, plus its `letter-spacing`, measured in the page with a canvas that is never inserted into the
document, through the same captured references as every other measurement, and only once the font
is loaded. It used to be the block's first rendered space, and in justified text no rendered space
is natural: at a line end it collapses — 0.02 px measured on patched Chromium 141, which made an
ordinary gap "540.50× the natural space" — and inside a justified line it is stretched with its
line, which divided a real six-space gap by itself, so a block with gaps of six and seven spaces
was clean. Both are pinned by
`tests/live/rule-targets.test.ts`, against a block whose unjustified last line shows the natural
space.

Word boxes are held for every line of every justified block; an earlier version limited them to a window around page boundaries, which contradicted the rule that needs them. Keeping them all costs a measured 4 221 bytes per page — about 8 MiB over 2 000 pages.

## Limits and known false alarms

Blocks with an explicit `word-spacing` are out: the width is a stated intention. Table cells are out: a justified cell has no room to do better.

A block whose natural space cannot be measured is declined as `env/invalid-measurement`, counted
against coverage, instead of being divided by a guess (it used to fall back to a third of the font
size, or to leave the rule without being counted): its font is not loaded yet, or it sets
`font-variation-settings`, `font-size-adjust` or a `font-stretch` that is not one of the nine
keywords, none of which a canvas font can reproduce. The natural space is the block's own font's; a
gap beside an inline element set in another font is measured against it too.

A line is judged by the block whose font sets it. A justified wrapper records its paragraphs' lines
as well, and once the divisor was the font's own space, a serif `<div>` around a monospace paragraph
reported the paragraph's seven-space gap a second time, as 16.84 of the div's spaces (patched
Chromium 141). A line now belongs to the deepest record that records it — a `display: contents`
paragraph included, whose text is set in its own font — and a wrapper is measured on its own text
only.

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

