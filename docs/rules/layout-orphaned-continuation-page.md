# `layout/orphaned-continuation-page`

| | |
|---|---|
| severity | warn |
| threshold | `netFill < 0.50`, on a page whose last block ends there |
| proof source | — |
| calibrated | **no** |

## What is checked

A page holds nothing but the tail of a block that began earlier.

A page that is neither a parity blank page nor one the author forced open (both are declined) is reported when all three of these hold, and its evaluation in the JSON report records all three:

- `continuation-only` — every block on the page is a continuation of a block that began on an earlier page;
- `ends-on-page` — the page's last block, in document order, is that block's final fragment: the block ends here;
- `net-fill` — the page's net fill is below `maxNetFill`.

## Why

The threshold is chosen. `data-split-from` proves a fragment is a continuation; it does not prove a defect.

`ends-on-page` is not chosen. A page whose last block goes on to the next page was left because its content overflowed it, so it is full by construction, whatever its net fill reads. Without this condition the rule reported every page between the first and the last page of a long block once the leading was generous: net fill counts glyph boxes, not line boxes, and full pages of one long paragraph measured 0.34–0.36 at `line-height: 3` (Chromium 141, Paged.js 0.4.3, the measuring machine's default serif). The condition needs no threshold and no calibration; it follows from how the paginator breaks.

## Limits and known false alarms

Declined after a forced incoming break. Reading the break reason from the computed style is verifiably wrong in both directions: `break-before: page` from a stylesheet reads back as `auto`, while the same declaration written inline survives as `page` and is measured *not* to take effect.

**A full tail page can still be reported.** The page a block ends on is judged by net fill, and net fill counts glyph boxes, not line boxes: with the fonts measured here a page filled to its last line reads 0.51–0.54 at `line-height: 2` and 0.34–0.36 at `line-height: 3`, and the reading depends on the font. So with generous leading, the completely filled last page of a block that is followed by a forced break or by the end of the document falls below 0.50 and is reported. A line-box fill would remove that; it changes the snapshot and the meaning of `maxNetFill`, and it is not in this release.

**A wrapper whose own text ends on the page keeps that page from being judged.** When the page's last block is an element with bare text of its own, and a child of it is carried to the next page, that element continues and the page is not reported, although it may be nearly empty. Measured: a `<section>` whose bare text ends three lines into a page, followed by a `break-inside: avoid` `<figure>` too tall for the rest of it, net fill 0.08 — not reported; before `ends-on-page` existed it was. The same text inside its own `<p>` makes the paragraph the page's last block; it ends there, and the page is reported (measured at the same 0.08).

**"Last" means last in document order.** That is the order in which the collector records the blocks of a page, and the rule relies on it: a wrapper such as `<main>` or `<section>` comes before the paragraph inside it, so the page ends in the paragraph, not in the wrapper. A `position: running()` element that Paged.js clones into a margin box comes before the page area and never counts as last on a page that has content of its own. Footnote areas, which Paged.js places after the page content, were not measured.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

## Remediation

<!-- begin generated remediation: layout/orphaned-continuation-page -->
A continuation page holds only a tiny trailing fragment of an earlier block. Tighten preceding vertical margins, padding, or line-height on earlier pages to pull the remaining lines back, or insert 'break-before: page' earlier to balance content across pages.
<!-- end generated remediation: layout/orphaned-continuation-page -->

## Examples

### Firing case (trigger)

```html
<!-- The last two lines of a long paragraph overflow onto page 2, and the next chapter forces a
     page break right after them: page 2 carries only the end of that paragraph -->
<style>
  h1 { margin-bottom: 4em; }
  p { line-height: 1.5; }
  .chapter { break-before: page; }
</style>
<h1>Chapter one</h1>
<p>…enough text to fill page 1, and two lines more…</p>
<h1 class="chapter">Chapter two</h1>
```

### Non-firing case (remedied)

```html
<!-- A tighter vertical margin above the paragraph on page 1 pulls its last two lines back -->
<style>
  h1 { margin-bottom: 0.5em; }
  p { line-height: 1.5; }
  .chapter { break-before: page; }
</style>
<h1>Chapter one</h1>
<p>…the same text, now ending on page 1…</p>
<h1 class="chapter">Chapter two</h1>
```

### Non-firing case (a continuing block)

```html
<!-- A paragraph that runs over five pages: pages 2 to 4 carry nothing but its continuation,
     and at line-height 3 their net fill reads about 0.35. The paragraph goes on to the next
     page from each of them, so none is judged; only the page it ends on is. -->
<p style="line-height: 3">…five pages of text…</p>
```

