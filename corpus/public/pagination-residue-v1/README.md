# pagination-residue-v1 — a hash-only corpus record

**There are no documents in this directory, and that is the point.**

## What this records

Six real documents on which breaklint cannot produce a report, and must say why. Each carries at
least one page where Paged.js left a table box in an overflow column of the multi-column
fragmentainer it builds out of `.pagedjs_page_content` — content it could not place on a page,
sitting one whole column pitch to the right, invisible behind an `overflow: hidden` sheet. Because
`page.pdf()` renders in print media with a re-sized fragmentainer, an unsplittable table row is
laid out somewhere else there and stays moved. The PDF then does not reproduce the geometry the
rules measured, so the state is withdrawn and the run ends in exit 3 — `render-unstable`, with the
elements, their source ids, the pages and the pitch named.

Measured over the eighteen chapters of the bundle these six came from, twice — on the 2026-09-05
bytes and again on the 2026-09-06 rebuild that changed five of the six documents. Both times:
**6 of 6** documents carrying table residue ended in exit 3 with `render-unstable`, and **0 of the
remaining 12** did. Two of those twelve carry residue of other kinds — one `<p>` in
`08-gates-caps-stop-conditions`, one `<span>` and one `<em>` in `12-four-times-wrong` — and
produced a report, because ordinary block and inline content re-fragments to the same boxes.

Twelve is a small number, and the run behind it is one bundle, one Paged.js build and one Chrome.
The split is what was measured, not a law that has been shown to hold elsewhere.

**Those two documents also say nothing about their residue.** Residue reaches the report only
through the fatal event, so a document that carries it and still reconciles ends in exit 0 with no
mention of the content the paginator left off the page. That is a known gap in this build, not a
statement that the two documents are clean.

## Why the bytes are not here

They are chapters of a paid product. Together they are 26 434 of that bundle's 66 336 running
words — 39.8 % — counted over the `<main>` element of all eighteen shipped HTML documents with
markup, script and entities removed, on the bytes recorded below. (The 0.4.0 record carried
27 492 of 69 017 from the product's own count; the share is the same to one decimal, and the pair
above is the one this repository can re-derive.) This repository is public and MIT-licensed. The
product's own licence architecture deliberately keeps delivered bytes out of its public companion
repository; copying 39.8 % of its running text into an MIT repository would cut straight across
that, and a public Git history is not revocable.

`docs/validation/corpus-contract-v1.md` already defines the shape for this: a redacted public
record keeps the artifact path null and is therefore ineligible on its own, while an authorised
private run supplies an opaque path below an external artifact root, and the validator reads those
bytes and verifies the recorded SHA-256. *"A hash-only public record documents existence without
pretending that an unavailable artifact was verified."*

## What CI actually runs

`tests/fixtures/fragmentainer-residue.html`. It was reduced from the `index` document below until
nothing of the product remained, and it still reproduces the class: no `@page`, no print
stylesheet, no `break-inside`, no script — a default-letter page, a 68ch measure and a table that
crosses a page boundary. That fixture, not this record, is the regression protection, and it must
stay that way: a gate that can only run on bytes most contributors cannot obtain is not a gate.

Without an artifact root the corpus gate prints `SKIPPED` and makes no success claim. It never
reports the six as verified when it has not read them.

## Running the full gate

Unpack the admitted bundle somewhere outside this repository and point the gate at it:

```bash
BREAKLINT_RESIDUE_CORPUS_ROOT=/path/to/unpacked-bundle npm run test:pagination-residue
```

The directory must contain the six documents named in `manifest.json[].externalArtifact` and the
shared `styles.css`, at the top level. Every file is checked against its recorded SHA-256 before
Chrome starts, and **all** mismatches are named in one message; a byte that drifted is a red gate,
not a re-recorded expectation. (The gate used to stop at the first drifted digest. On the
2026-09-06 rebuild five of the six had drifted and it reported one, leaving the other four to be
re-derived by hand.)

The red control works the same way. Without a root it proves red-to-green on the public fixture
alone, which is sufficient:

```bash
npm run test:pagination-residue:red-control
```

## What this record is not

Not calibration evidence. Not an external trust root. Not a claim that anyone but the admitting
party has seen these bytes.
