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
space, plus its `letter-spacing`, times its effective CSS `zoom`, measured with an off-document
canvas once the font is loaded. A rendered space cannot serve: in justified text it collapses at a
line end and is stretched inside a line.

A font a canvas cannot reproduce (`font-variation-settings`, `font-size-adjust`, a numeric
`font-stretch`, synthesised caps other than `small-caps`, a font not loaded yet) is measured from
the layout instead: the gaps between consecutive words on the unjustified last lines of justified
blocks with the same font settings. The natural space is their median, and only when all of them
agree within 0.1 px or 3 %; otherwise the block is declined.

## Limits and known false alarms

- Blocks with an explicit `word-spacing`, and table cells, are out.
- A block whose natural space can be read neither way is declined as `env/invalid-measurement`.
  Where more than half of a document's justified blocks are declined, the run ends with exit 4.
- Right-to-left text is not judged.
- A gap set in an inline element in another font or size is measured against the block's natural
  space (a monospace `<span>` in a serif paragraph read 2.41×).
- A line belongs to the deepest block that records it; a wrapper is measured on its own text.
- Only visible lines are read. Hidden blocks and margin-box content are excluded; a block whose
  lines were not recorded is declined. See [known limits](../known-limits.md).

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

