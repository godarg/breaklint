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
space, plus its `letter-spacing`, times its effective CSS `zoom` (computed font sizes are unzoomed
while every rendered box is zoomed, so without it `zoom: 1.25` scaled every factor). It is measured
in the page with a canvas that is never inserted into the document, through the same captured
references as every other measurement, and only once the font is loaded. It used to be the block's
first rendered space, and in justified text no rendered space is natural: at a line end it
collapses — 0.02 px measured on patched Chromium 141, which made an ordinary gap "540.50× the
natural space" — and inside a justified line it is stretched with its line, which divided a real
six-space gap by itself, so a block with gaps of six and seven spaces was clean. Both are pinned by
`tests/live/rule-targets.test.ts`, against blocks whose unjustified last line shows the natural
space, in twelve font settings.

A font a canvas cannot reproduce is measured from the layout instead: the median gap on the
unjustified last lines of justified blocks set in exactly the same font. That covers
`font-variation-settings` other than a `wght` that restates the computed weight, `font-size-adjust`,
a `font-stretch` that is not a keyword, synthesised caps other than `small-caps` (`all-small-caps`
shrinks the space with the letters: the canvas read 46 % too wide) and a font not loaded when
measured.

Word boxes are held for every line of every justified block; an earlier version limited them to a window around page boundaries, which contradicted the rule that needs them. Keeping them all costs a measured 4 221 bytes per page — about 8 MiB over 2 000 pages.

## Limits and known false alarms

Blocks with an explicit `word-spacing` are out: the width is a stated intention. Table cells are out: a justified cell has no room to do better.

A block whose natural space neither the canvas nor the layout gives — such a font with no justified
block anywhere in the document whose last line carries two words, or whose last lines are justified
too (`text-align-last: justify`) — is declined as `env/invalid-measurement`, counted against
coverage. That is the exit-4 consequence: where more than half of a document's justified blocks
are declined, the rule falls below its 0.5 coverage floor and the run ends
`insufficient-coverage` (exit 4) instead of clean. It used to divide by a third of the font size.

Gaps are measured against the block's own natural space. A gap set in an inline element in another
font or size is measured against it too: on patched Chromium 141 a monospace `<span>` in a serif
paragraph read 2.41× and a 150 % `<span>` 1.50× on natural spaces. An inline element with its own
`word-spacing` is the author's decision, like a block's: its words are one unit in the word boxes,
and no gap inside it is judged.

A line is judged by the block whose font sets it. A justified wrapper records its paragraphs' lines
as well, and once the divisor was the font's own space, a serif `<div>` around a monospace paragraph
reported the paragraph's seven-space gap a second time, as 16.84 of the div's spaces (patched
Chromium 141). A line now belongs to the deepest record that records it — a `display: contents`
paragraph included, whose text is set in its own font — and a wrapper is measured on its own text
only. Whether a line is justified is its block container's `text-align`: a `display: contents`
paragraph with `text-align: left` in a justified `<div>` prints justified lines and is measured.

Gaps are read from a block's VISIBLE lines only, and no block is measured at a factor of 0 for
lines nobody saw. The in-flow original of a running element is `excluded`
(`rule/target-in-margin-box`), a block the author hid `excluded` (`rule/target-not-rendered`), a
block whose lines are all invisible `excluded` (`rule/target-not-visible`) and a block with no line
at all — empty, or image-only — `not-applicable` (`rule/no-text-lines`), all outside the coverage
base; a block whose lines the snapshot did not record is declined as `env/invalid-measurement`,
counted against coverage. A `display: contents` block has no box but prints its lines, and it is
measured from them like any other block. Text inside a margin box is not measured. See
`docs/limitations.md`.

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

