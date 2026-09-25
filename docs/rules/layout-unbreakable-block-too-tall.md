# `layout/unbreakable-block-too-tall`

| | |
|---|---|
| severity | error |
| threshold | the page content box height |
| proof source | A |
| calibrated | **no** |

## What is checked

A block with `break-inside: avoid` is taller than the page it must fit on.

## Why

One of two rules that carry `error`. Two directly measured heights, a structural boundary: a block taller than every page cannot keep its own promise not to break. That is arithmetic, not convention.

## Limits and known false alarms

Multi-column and vertical writing are declined rather than judged. That includes a block set in the columns of a multi-column ancestor (`env/multicolumn`): `column-count` is not inherited, and through 0.6.0 such a block was measured on the union of its column fragments. A block with any fragment on a page withdrawn because content lies past its page box (`env/pagination-residue`: Paged.js left it in its overflow column, and the PDF does not print it) is declined too, because the height of a split block is summed over its fragments. Both declines count against coverage, so either one ends the run in exit 4.

A block the paginator split is judged on all of its fragments, joined by source id. A split block
whose fragments cannot be joined — it has no source id (a `--no-source-map` run, or an element a
script created), or its source id does not account for every fragment the snapshot counted — is
declined as `env/invalid-measurement` rather than judged on one fragment, and the decline counts
against the rule's coverage.

Which records are fragments is decided by the page structure, not by coordinates. A fragment that
bleeds into the page margin (negative margins, a full-bleed figure) still counts. Content in a page
margin box is not part of the flow and is not measured: a `position: running(...)` element is
represented only by its in-flow original, which Paged.js hides with `display: none`. That original
is recorded as `excluded` (`rule/target-in-margin-box`), and a block the author hid as `excluded`
(`rule/target-not-rendered`), both outside the coverage base and never as a measurement of 0 px.
A `display: contents` block generates no box, and `break-inside` does not apply to it: it is
`not-applicable` (`rule/target-generates-no-box`), outside coverage, and its children are
candidates in their own right. A zero-size block that printed visible lines anyway
(`overflow: visible`), or whose lines were not recorded, is declined as `env/invalid-measurement`,
counted against coverage: its box's height is not the height of what printed.

A split block is judged at its first fragment that printed — laid out with a box of its own and
visible — not at fragment 0 as such. Hiding only the first fragment (`display: none`, moving it
where it has no box, `visibility: hidden`) does not hide the block: the earlier fragments are
recorded as `rule/fragment-not-rendered` and the block's height is still the sum over all its
fragments. See `docs/limitations.md`.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

## Remediation

<!-- begin generated remediation: layout/unbreakable-block-too-tall -->
A block with 'break-inside: avoid' is taller than the content box of the page it was laid out on, so the paginator could not keep it whole there. Where it had already been split into three or more fragments, the reported height is the sum of those fragments, which is the height its content needed. Make the block shorter — split it into smaller sections deliberately, or reduce container padding, font size or contained rows. Removing 'break-inside: avoid' also clears the finding, but only because the rule then has no candidate: the block is exactly as tall as before, and it will still be broken, just without having asked not to be.
<!-- end generated remediation: layout/unbreakable-block-too-tall -->

## Examples

### Firing case (trigger)

```html
<!-- Page content height is ~257mm; 300mm block cannot fit -->
<div style="break-inside: avoid; height: 300mm; background: #eee;">
  Content too tall to fit on any single page.
</div>
```

### Non-firing case (remedied)

```html
<!-- Allow the tall block to paginate naturally -->
<div style="break-inside: auto; height: 300mm; background: #eee;">
  Content splits across pages cleanly.
</div>
```

