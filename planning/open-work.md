# Open work — triage of the 2026-09-24 known-gap register

Triage date: 2026-09-24. Tree: `db0e4c0` (= `origin/main`, v0.6.0 + 10 commits).
Method: six independent triage agents (T1–T6), each re-verifying its register items against the
code with file:line citations, and by measurement where it was cheap. The register was treated as
evidence, not authority. The full per-item records (fix designs, test strategies, sharpened "done
when") are the triage working files. This page is their consolidated, public summary.

## Measurement environment and its limits

- Linux x86_64 VM, kernel 6.18, Node 24.21.0 (the engines floor, 22.13.0, was also checked where it
  matters), Paged.js 0.4.3, poppler 24.02.
- **Browser: Chromium 141.0.7390.37**, the only one available. Downloading another was not
  permitted. The supported path cannot complete a live run on it (register item G-59):
  - the `FontFaceSet` global is absent, which breaks the primitives capture;
  - pdfjs-dist 6.2.108 needs `Map.prototype.getOrInsert(Computed)` and `Math.sumPrecise`.
- Triage therefore used two instruments:
  - **near-live**: the real apparatus (primitives, collector, snapshot source, Paged.js) in the
    browser and the real engine and rules in Node;
  - **patched-live**: the real CLI with two local shims that are never committed, run with
    `--no-evidence-binding`.

  Every live number below is a patched-Chromium-141 number. The live evidence path is proved only
  by CI on current Chrome (PR #18). Items marked **NEEDS-CI** cannot be settled here.
- Chrome refuses to run as root without disabling its sandbox. breaklint has no flag for that, and
  none was added. All browser work ran as an unprivileged user with the sandbox on.
- This VM's PID 1 reaps orphans only after 1.0–1.96 s. That turned out to be product-relevant
  (G-23).

## Counts

58 register items, plus G-59, raised by the orchestrator during setup, plus 9 new defects found
during triage (G-60 … G-68).

| status | count | ids |
|---|---|---|
| confirmed as registered | 29 | G-01, G-04, G-08, G-11, G-16, G-17, G-19, G-20, G-21, G-22, G-24, G-26, G-27, G-29, G-33, G-35, G-36, G-38, G-39, G-43, G-45, G-46, G-48, G-49, G-50, G-52, G-53, G-54, G-55 |
| confirmed, worse or wider than registered | 13 | G-03, G-06, G-09, G-10, G-15, G-18, G-23, G-30, G-32, G-34, G-40, G-42, G-51 |
| changed (mechanism or claim differs) | 6 | G-05, G-12, G-13, G-14, G-28, G-44 |
| partial (half the claim refuted) | 2 | G-07 (the sum is not an upper bound either), G-37 (the parent token set is not available to check "redefines two, adds five") |
| fixed on main, unreleased | 4 | G-02, G-41, G-47, G-56 |
| confirmed, not fixable from here | 1 | G-58 (no external reports) |
| parked by owner decision | 1 | G-25 (calibration) |
| duplicates | 2 | G-57 = G-09 port; G-31 = the gate verdict over G-32…G-39 |
| refuted outright | 0 | — |
| **total register** | **58** | plus G-59 (confirmed, orchestrator) and G-60…G-68 (new) |

No register item was refuted outright. Several design premises inside items were:

- G-07: the fragment sum is not an upper bound.
- G-09: fill box + stroke-width/2 is not an upper bound under miter joins, and the text box is not
  a lower bound of ink.
- G-14: 0.686 is not a ceiling.
- G-28: `widows`/`orphans` are not inert under Paged.js on Chromium 141.

## New defects found during triage

| id | defect | severity | from |
|---|---|---|---|
| G-60 | `--no-source-map` ends exit 3 on almost every real document. The sid-less source join (`snapshot.ts:965-991`) matches only first fragments and compares whitespace-sensitive text, so any split block, or any pretty-printed container, throws. | high (feature) | T1 |
| G-61 | False `error` from `svg/text-overflows-viewport`: the rule compares the typographic cell box, not ink. A label whose ink is 1–2 px inside the viewport is reported "1.00 px beyond … not drawn". | high | T2 |
| G-62 | False clean: a label clipped inside a nested `<svg>` ends exit 0, because the nested viewport is read as the union of its content. | high | T2 |
| G-63 | False `error`: keyword `overflow-clip-margin` (`content-box 20px`) is parsed with `parseFloat`, which gives NaN, treated as 0. | medium | T2 |
| G-64 | Silent content loss: text Paged.js strands in its overflow column is missing from the PDF (20 of 1136 words on the public residue fixture) and is never reported. | high | T2 |
| G-65 | The geometry cross-check compares a fragment union with CDP's first fragment, so a column-split or overflow-split box ends the whole run exit 3, and the event can blame the wrong page. | high | T2 |
| G-66 | `<tspan>` stroke, `url()` paint, `text-shadow` and decoration are never inspected; such labels are measured as plain text. | medium | T2 |
| G-67 | `--out-dir` is parsed and applied, but is absent from `--help` and the docs, and untested. Every live run silently writes evidence to `./breaklint-report`. | medium | T6 |
| G-68 | A directory named `x.html` starts Chrome and ends exit 3 "resource byte limit exceeded" instead of exit 2. | low–medium | T6 |

Wider scope folded into existing ids:

- **G-06**: margin-box clones also corrupt the collector. Measured: 18 false widow/orphan warnings
  from one running header, a parity-blank page classified `overflow`/`forced`, a false
  orphaned-continuation-page on that blank page, and three page findings sharing one fingerprint,
  which breaks the AGENTS fingerprint invariant.
- **G-23**: zombies are counted as live processes. Under a non-reaping parent (Docker without
  `--init`, container jobs, node as PID 1) every live run ends exit 3. Measured 20/20.
- **G-31**: the verifier's browser-string check rejects Chromium-based browsers. The ledger cannot
  record a failed round. Its environment binding pins the kernel string and the exact Node patch
  version. `report.html` in the bundle is a second, unreviewed surface.
- **G-18**: a 500-page document ends exit 3 on the 120 s document timeout at a 7.9 GiB peak, although
  `MAX_PAGES` is 2000. The timeout-versus-page-limit question is an owner decision.
- **G-27**: `&shy;` is offered as a lever, but Paged.js re-hyphenates after a soft hyphen, so the
  lever can re-create the finding.
- **G-40**: the published 0.6.0 tarball's CHANGELOG and status page still say "unreleased".

## Register status (all ids)

Severity is the re-assessed one. The last column says what this release does with the item.

| id | verdict | sev | plan |
|---|---|---|---|
| G-01 | confirmed: 65 536 B through a pipe in all 6 formats, exit code kept, so the truncation is silent | high | WP-C1 |
| G-02 | fixed on main, unreleased; the fix itself caused G-04 | high (0.6.0) | WP-F1 (ancestry replaces coordinates), CHANGELOG |
| G-03 | confirmed; two fragments is the common case for blocks 1–2 pages tall | high | WP-F3 (content-extent lower bound) |
| G-04 | confirmed, main-only regression against 0.6.0; blocks the release | medium | WP-F1 |
| G-05 | changed: the join throws first (see G-60); the summation gap is reachable only after that | medium | WP-F2 |
| G-06 | confirmed, wider (see above) | high | WP-F1 |
| G-07 | partial: overstatement confirmed (+46 px), "upper bound" refuted | low–medium | WP-F3 |
| G-08 | confirmed; the one existing contract test pins G-03 as intended behaviour | low | WP-F3 |
| G-09 | confirmed; prototype bound unsound under miter joins | high | WP-S2 (miter-aware bracket) |
| G-10 | confirmed | medium | WP-S1 (local viewport space, CDP content-quad oracle) |
| G-11 | confirmed, research only | medium | not in this release (M3 work) |
| G-12 | changed: the public fixture fails the cross-check (G-65), not `render-unstable`; table drift is page-local | high | WP-X (per-page withdrawal) |
| G-13 | changed: decline keyed on the block's own `column-count`, so contents are measured wrongly (exit 0) or kill the run (exit 3) | high | WP-X |
| G-14 | changed: not a ceiling; the finding message repeats a false claim | low | WP-F4 (message + docs); new measure parked (calibration) |
| G-15 | confirmed on current code: full middle pages fire at line-height ≥ 2.0–2.2 | medium | WP-F4 (structural tail guard) |
| G-16 | confirmed, undisclosed: page counts agree 17/17, break lines shift 3/17 | medium | docs in this release |
| G-17 | confirmed; 0.4.3 is still npm latest | low | docs |
| G-18 | confirmed and measured: about 15.7 MiB per page during comparison; 500 pages fails | medium | wave 3 if capacity (streaming + memory ceiling) |
| G-19 | confirmed | low | out of scope (needs multi-OS) |
| G-20 | confirmed | low | out of scope (multi-OS data) |
| G-21 | confirmed, documented | low | out of scope |
| G-22 | confirmed, documented | low | out of scope |
| G-23 | confirmed, product defect (zombies) | medium–high | WP-C2 |
| G-24 | confirmed | low | out of scope beyond recording Linux data |
| G-25 | parked | high | parked by owner decision; nothing claimed |
| G-26 | confirmed; 4 pairs feasible | medium | wave 3 (`test:remedy-proofs`, NEEDS-CI) |
| G-27 | confirmed, plus the `&shy;` defect | medium | wave 3 (precedence as a validated field) |
| G-28 | changed: widows/orphans honoured through Paged.js' multicol page area on Chromium 141 | low / docs medium | wave 3 (CI probe, then docs, advice and guard) |
| G-29 | confirmed | medium | WP-K1 (self-authored corpus) + gate |
| G-30 | confirmed, stronger: NO CLAIM even with a root | medium | WP-D1 |
| G-31 | confirmed; no faithful binding possible on this VM | blocker | WP-R1 tooling, then an independent review |
| G-32 | confirmed; root cause is page-atomic findings | blocker | WP-R1 |
| G-33 | confirmed (mobile 390 × 7 959–15 659 px) | high | WP-R1 |
| G-34 | confirmed (deliberate, pinned by tests) | high | WP-R1 |
| G-35 | confirmed (Liberation Sans for both roles here) | high | WP-R1 |
| G-36 | confirmed | medium | WP-R1 |
| G-37 | partial | medium | WP-R1 (fork to a breaklint prefix; decision recorded) |
| G-38 | confirmed (a hierarchy problem, not a contrast failure) | medium | WP-R1 |
| G-39 | confirmed | medium | WP-R1 |
| G-40 | confirmed (plus published "unreleased" wording) | medium | Unreleased section opened (bb76dba); WP-D1 check |
| G-41 | fixed on main, unreleased | medium | WP-D1 (packed-README guard, G-52) |
| G-42 | confirmed, more instances | medium–high | WP-D1 |
| G-43 | confirmed in 7 docs and 2 shipped `.d.ts` | low–medium | WP-D1 |
| G-44 | changed: `.md` gives exit 2 today; Markdown inside `.html` paginates | low–medium | WP-D1 |
| G-45 | confirmed | low | WP-D1 |
| G-46 | confirmed (28 literals, no check) | low–medium | WP-D1 |
| G-47 | fixed on main | low | verify at publish (run attempt 1) |
| G-48 | confirmed: 12 dirs per `npm test` from 3 files | low | WP-C1 |
| G-49 | confirmed; root cause NEEDS-CI | medium | WP-C2 (a, b); CI data |
| G-50 | confirmed | low | WP-C2 |
| G-51 | confirmed on Linux: SIGKILL leaves 12–13 Chrome processes | medium | WP-C2 |
| G-52 | confirmed | low–medium | WP-D1 |
| G-53 | confirmed | low | wave 3 (`--bundle`) |
| G-54 | confirmed; needs G-59 | low | wave 3 if capacity (container recipe) |
| G-55 | confirmed, documented | low | WP-D1 (pin by test) |
| G-56 | fixed on main, unreleased | low | WP-D1 (normative doc sentence) |
| G-57 | confirmed, duplicate of G-09 | medium | WP-S2 |
| G-58 | confirmed | medium | record only |
| G-59 | confirmed, two parts | medium–high | WP-C1 |
| G-60 | new | high | WP-F2 |
| G-61 | new | high | WP-S2 (ink lower bound) |
| G-62 | new | high | WP-S1 |
| G-63 | new | medium | WP-S1 |
| G-64 | new | high | WP-X (decline pages now; reporting needs a new rule later) |
| G-65 | new | high | WP-X |
| G-66 | new | medium | WP-S2 |
| G-67 | new | medium | WP-D1 |
| G-68 | new | low–medium | WP-D1 |

## Work packages and dependencies

Packages are serialized where they share hotspot files: `src/measure/snapshot.ts`,
`src/paginate/collector.ts`, `src/acquire/render-run.ts` and the SVG rule. The snapshot schema stamp
moves 4 → 5 at most once in this release (WP-S1).

```
wave 1 (parallel, disjoint files)
  WP-F1  G-06 G-04 G-02            collector + snapshot block queries; rule filter removal
  WP-F4  G-15 G-14                 continuation-page / half-empty-page rules
  WP-S1  G-10 G-62 G-63            SVG section of snapshot.ts, primitives, SVG rule; Snapshot 5
  WP-C1  G-01 G-59 G-48            CLI output tail, font capture, rasteriser preflight
  WP-C2  G-23 G-50 G-51 G-49a/b    browser.ts / producer.ts lifecycle; CI soak step
  WP-R1  G-31a G-37 G-35 G-39 G-38 G-36 G-33 G-34 G-32   report surfaces
  WP-D1  G-46 G-40 G-52 G-30 G-43 G-42 G-44 G-45 G-55 G-56 G-67 G-68 + docs sweep
  WP-K1  G-29 corpus authoring (ground truth written before any tool run)

wave 2 (after its predecessors land)
  WP-F2  G-05 G-60                 after F1 (clones share data-ref)
  WP-F3  G-08 → G-03 G-07          after F1; contract test red first
  WP-S2  G-09/G-57 G-61 G-66       after S1 (same SVG block, local space)
  WP-X   G-65 → G-13 → G-12 G-64   after F1 and S1 (render-run, cross-check, blocks)
  WP-K2  corpus gate               after K1 freezes ground truth; admitted to CI

wave 3 (capacity-dependent)
  G-27 G-28 → G-26 (remedy proofs)   G-53 (--bundle)   CI recipe / GitHub Action + SARIF
  G-18 (streaming rasteriser)        G-16/G-17 docs     G-54 (container recipe)

release
  independent surface review (two reviewers, one with a typography lens) → ledger rebind only on PASS
  release-prep commit (0.7.0) → independent release audit → handoff
```

## Out of scope for this release, with reasons

- G-11: production ink pass (M3).
- G-19, G-20, G-24: need a second OS and font stack.
- G-21, G-22: documented limits.
- G-25: calibration, parked by owner decision; `calibrated: false` stays everywhere.
- G-58: needs outside users.
- Windows support: parked. WP-C2 only moves the refusal before any browser start.

## Items found after triage (during implementation and verification)

| id | defect | found by | severity | package |
|---|---|---|---|---|
| G-69 | Page anchors from wrappers spanning pages: page findings share fingerprints | F1 impl / F1 verifier | medium | WP-F1 r2 |
| G-70 | Replacing Function.prototype.call redirects every captured primitive (fonts, rects…) — tamper-resistance claim false | C1 verifier (P-1) | high | WP-P1 |
| G-71 | Evidence overlay reads margin-box clones and bleeding fragments as unplaced → pages unbound → exit 4 for any document with running()/fixed/full-bleed under default settings (pre-existing on main) | F1 verifier | high | WP-F1 r2 |
| G-72 | Post-pagination integrity check collects margin clones → sid order mismatch → exit 3 for common running layouts (heading before running element, running element in section, 16 margin boxes, string-set+element(), block footnotes) | F1 verifier | medium–high | WP-F1 r2 |
| G-73 | SVG clip inputs read via style[key] spoofable by shadowing CSSStyleDeclaration.prototype | S1 verifier | medium | WP-S1 r2 |
| G-74 | contain: paint / content-visibility / clip-path|mask on root / HTML-ancestor clipping with overflow visible → false clean | S1 verifier | high | WP-S1 r2 |
| G-75 | SVG overshoot rounding: flush labels reported as errors 3–5 % of the time; float noise | S1 verifier | medium (false error class) | WP-S1 r2 |
| G-76 | Per-glyph `rotate` attribute puts ink past getBBox → false clean | S1 verifier | low–medium | WP-S1 r2 |
| G-77 | Event loop drains while main() pending → exit 0 | C2 impl | medium | WP-C1 |
| G-78 | Parity-blank pages never bind evidence → every document with a blank page exits 4 with evidence binding on (pre-existing) | F1 impl r2 | high (real documents) | WP-F5 |
| G-79 | Paged.js per-run random href on footnote references → injection-interference exit 3 for any document with footnotes (pre-existing) | F1 impl r2 | high (real documents) | WP-F5 |
| G-80 | Chrome component updater: browser-level network egress during runs (not covered by page-level offline policy) + temp dirs left in TMPDIR (puppeteer-core 25.8 dropped --disable-component-update) | C1 verifier (CI Chrome 153) | medium (security claim) | WP-C2 r2 |
| G-81 | ≥3-fragment structural sum can false-error via Paged.js duplication (302.53 px block, 4 fragments, 798.98 px error on base) | F3 impl | high (pre-existing false error) | WP-F3 |
| G-82 | Wrapper block (section/div) crossing a page break judged by its own default widows/orphans against descendants' lines → false layout/widow / layout/orphan even when the inner paragraph sets widows: 1 | K3 impl | medium | open (after F1) |
| G-83 | type/excessive-word-spacing measures the natural space at the block's first whitespace; a collapsed line-end space (~0.02 px) gives false gaps of 361× / 1082× | K3 impl | medium | open |
| G-84 | Paged.js soft-hyphen split carries a letter back; the appended hyphen glyph can wrap into the overflow column → geometry cross-check refuses the document | K3 impl | low (upstream) | document |
