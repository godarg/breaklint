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

- Skipped after a forced outgoing break ([break cause](../known-limits.md#the-break-cause-of-a-page-boundary))
  and on blocks without a visible text line.
- Only the block's own lines count, and only the run the break split, exactly as for
  [`layout/widow`](layout-widow.md): a `<section>` whose second paragraph moved whole to the next
  page is not reported for its first paragraph's last line.
- The known false alarms of `layout/widow` apply here too; see the
  [measurement record](https://github.com/godarg/breaklint/blob/main/maintainers/rule-notes/layout-orphan.md).

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

