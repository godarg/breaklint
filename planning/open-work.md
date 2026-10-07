# Open work — triage of the 2026-09-24 known-gap register

Triage date: 2026-09-24. Tree: `db0e4c0` (= `origin/main`, v0.6.0 + 10 commits).
Method: six independent triage agents (T1–T6), each re-verifying its register items against the
code with file:line citations, and by measurement where it was cheap. The register was treated as
evidence, not authority. The full per-item records (fix designs, test strategies, sharpened "done
when") are the triage working files. This page is their consolidated, public summary.

## 2026-09-28 L1 package decision for 0.8.0

⛔ Supersedes the L1 plan cells for G-86, G-88, G-96 and G-101 below. The package is
**dropped from 0.8.0**, with evidence branch `claude/wp-l1-080`. This is a scope decision,
not a claim that any of the four defects is fixed. Measured against `origin/main` at
`10765b4` with `git show a1d8380 -- src/acquire/render-run.ts`,
`git show d2d519e --stat` and source inspection on 2026-09-28:

| id | 0.8.0 outcome | blocking finding |
|---|---|---|
| G-86 | dropped with L1 | The isolated rule change is not a complete L1 package while the resource and base paths below remain unresolved. No 0.8.0 fix was committed on this branch. |
| G-88 | dropped with L1 | The earlier L1 branch added base-aware capture in `c44238c` and reverted it in `a1d8380`: Paged.js requested an imported sheet from the document origin after Chrome had resolved it against `<base>`. The resulting uncaptured request returned 403 and allowed an unstyled measurement. The old branch's final limitations still disclose over-capture and two conservative false exit-3 cases. Current Chrome behavior was not remeasured here: **UNBEKANNT**. |
| G-96 | dropped with L1 | A failed paginator stylesheet request must be tied to both resource discovery and the browser's observed request role. The previous base-aware change exposed a silent unstyled measurement; taking only its route guard would leave the base mismatch. |
| G-101 | dropped with L1 | The previous branch's fix replaced three regex readers (discovery, stylesheet guard, local-URI collector) with a shared 201-line CSS reference scanner in `d2d519e`, including escape decoding. This is a parser and provenance change, not a narrow whitespace patch. No current Chrome/CI acceptance was run for that candidate. |

The four items remain open for a separately specified package with a browser-request oracle and
new independent verification. The original historical triage rows below are retained as evidence;
their former plan cells are superseded by this decision.

## 2026-10-05 scoped remeasurement for the 0.9 investigation

⛔ Supersedes the historical current-status interpretation of G-01, G-03, G-07, G-12,
G-89, G-99 and G-102 below only to the extent stated in this table. The historical
measurements and stopped-package records remain intact. No item is universally closed
by this checkpoint, and no 0.9 implementation or release acceptance is claimed.

Measured with the unchanged registry `breaklint@0.8.0`, Paged.js 0.4.3,
Chrome 154.0.8037.97 and separately bound Node 24.21.0 / 22.13.0 processes.
Self-authored controls and private command/exit/hash receipts precede these conclusions.
The counts elsewhere in this register describe their dated historical investigations.

| id | current scoped evidence | remaining work |
|---|---|---|
| G-01 | changed: 120 stock full-reader pairs across six formats and two runtimes retain the expected direct CLI exit 1, consumer exit 0 and narrowly projected byte equality. Stock JSON is below the preregistered 262,144-byte stress floor. A separate self-authored JSON control produces 442,353-byte `--out` reports: ten triples per runtime retain complete slow-reader output and early-close CLI/consumer exits 3/0. Twenty preclosed `--out` confirmation channels retain complete reports and their distinct diagnostic. | Qualify stress for the other five formats and the existing greater-than-1-MiB early-close gate. Do not infer a universal pipe guarantee from the JSON control or silently replace the historical 65,536-byte observation. |
| G-03 | still open: a compound figure/table control retains a three-fragment figure height sum; its first fragment lies beyond the physical page. Fifty one-line caption/table-cell candidates each have an off-sheet fragment and a visible fragment. The outside-figure comparison changes ownership and is not an accepted repair. | Prove unique physical fragment/content extent independently before changing two-fragment behavior. Retained fragment heights and generated rule messages are not independent oracles. |
| G-07 | still open: the compound control sums 2,580.07 px against a 971.33 px content box, including a 949.13 px off-sheet fragment. This does not establish the unsplit physical height or a truthful scaling remedy. | The historical +46 px observation and refuted upper-bound premise remain dated evidence. Establish physical attribution and an independently measured remedy before claiming a fix. |
| G-12 | still open: the corrected whole-table control has two bound PDF pages but retains exit 4 in all three acquisitions. A separate genuinely tall figure control fails the geometry cross-check in all four arms and produces no diagnostic PDF. | Keep coverage refusal, cross-check failure and missing repeated table headings distinct. Do not withdraw a page or clear a gate using these controls alone. |
| G-89 | existing 0.8 guard reverified statically: nonempty print headings with `display: contents` produce the named infrastructure refusal. The existing live test checks that refusal and exit 3, not survival of every authored word. | Proposed independently authored long/short heading and ordinary-block controls are not yet measured. A refusal is not a general text-preservation guarantee. |
| G-99 | still open: the compound control's retained overflow classification does not test named-page transitions or expose the actual pagination token. | Remeasure named-page boundaries with actual decision evidence. No named-page fix or forced-break classification is established here. |
| G-102 | historical stopped WP-X branch finding, not present as that exemption in the shipped 0.8 residue code. The current census measures stranded boxes; SID presence, first ordering and line records do not prove full token survival. | The proposed rounded/unclipped and intentionally hidden text controls remain unmeasured. Keep the stopped-branch defect distinct from a demonstrated shipped-package loss. |

## Historical measurement environment and its limits

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
| G-23 | confirmed, product defect (zombies) | medium–high | herausgefallen (0.8.0): the Linux `/proc` defunct-process proof and no-reap soak in `claude/wp-c2-lifecycle` tip `73562e2` depend on its broad process-ownership rewrite; companion `claude/wp-c1-output-floor` tip `ea3f60a` does not isolate the fix. No independent post-final verification; defect remains open. |
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
| G-78 | Parity-blank pages never bind evidence → every document with a blank page exits 4 with evidence binding on (pre-existing) | F1 impl r2 | high (real documents) | herausgefallen (0.8.0): `claude/wp-f5-real-documents` tip `92a7d3a` contains a blank-page proof, but F5 had two consecutive FAIL reviews, the second with HIGH G-100 in the same evidence path. The final tip has no independent verifier verdict; the product defect remains open on main. |
| G-79 | Paged.js per-run random href on footnote references → injection-interference exit 3 for any document with footnotes (pre-existing) | F1 impl r2 | high (real documents) | herausgefallen (0.8.0): `claude/wp-f5-real-documents` tip `92a7d3a` contains a footnote repair, but the two F5 reviews ended FAIL and the second found HIGH G-100 in footnote evidence binding. No independent review accepted the final tip; the product defect remains open on main. |
| G-80 | Chrome component updater: browser-level network egress during runs (not covered by page-level offline policy) + temp dirs left in TMPDIR (puppeteer-core 25.8 dropped --disable-component-update) | C1 verifier (CI Chrome 153) | medium (security claim) | WP-C2 r2 |
| G-81 | ≥3-fragment structural sum can false-error via Paged.js duplication (302.53 px block, 4 fragments, 798.98 px error on base) | F3 impl | high (pre-existing false error) | WP-F3 |
| G-82 | Wrapper block (section/div) crossing a page break judged by its own default widows/orphans against descendants' lines → false layout/widow / layout/orphan even when the inner paragraph sets widows: 1 | K3 impl | medium | open (after F1) |
| G-83 | type/excessive-word-spacing measures the natural space at the block's first whitespace; a collapsed line-end space (~0.02 px) gives false gaps of 361× / 1082× | K3 impl | medium | open |
| G-84 | Paged.js soft-hyphen split carries a letter back; the appended hyphen glyph can wrap into the overflow column → geometry cross-check refuses the document | K3 impl | low (upstream) | document |
| G-85 | puppeteer-core honours PUPPETEER_DANGEROUS_NO_SANDBOX (adds --no-sandbox) and PUPPETEER_TEST_EXPERIMENTAL_CHROME_FEATURES; SECURITY.md "no flag turns it off" false; plus document WebRTC STUN egress under offline mode | C2 impl r2 | high (security claim) | behoben (0.8.0): `744dab7` refuses a launch when either inherited variable is present; red/green security control and independent P2 verifier PASS. WebRTC egress remains G-94. |
| G-86 | artifact/local-uri skips scheme-less absolute/root-relative paths (/var/…, /opt/…) — snapshot scheme "" skipped before the absolute-path test; contradicts the rule page | K2 impl (corpus gate) | medium (false clean, warn rule) | ⛔ superseded by 2026-09-28 L1 decision above: dropped from 0.8.0 |
| G-87 | sa03 caption `pageOf` target (#cap-hourly) not fired | K2 impl | resolved | two causes: the entry contradicted the rule definition (corpus erratum E42) and G-99 declined the page (WP-B1) |
| G-88 | Local asset capture (discoverLocalAssetClosure / htmlResourceReferences) ignores <base href>: under an http(s) base it captures local files the browser never requests, while the browser's real requests go to the network | L1 impl | low–medium (source identity / acquisition truth) | ⛔ superseded by 2026-09-28 L1 decision above: dropped from 0.8.0 |
| G-89 | `display: contents` heading split across a page break loses its continuation in Paged.js (17 of 89 words printed), exit 0, no check catches it (pre-existing) | F1 r3 verifier | medium (silent content loss) | behoben (0.8.0): `744dab7` detects the affected heading and refuses silent clean with exit 3; red/green control and independent P2 verifier PASS. |
| G-90 | "rejects late scripted content" live test flaky (≈3/42, also on base): detection only via paired-control asymmetry | F1 r3 verifier | low | WP-F1b |
| G-91 | Offline mode: Chrome 153 secure-DNS (DoH to [2001:4860:4860::8888]:443) bypasses the host-resolver lock → browser-level egress (caught by C2's own net-log test on CI) | C2 r2 verifier | high (security claim) | außerhalb des Umfangs (0.8.0): no independently verified current-Chrome CI net-log fix. The stopped C2 branch is not merged; the product finding remains open and the egress limit remains documented. |
| G-92 | Inherited CHROME_EXTRA_FLAGS reaches the browser: --no-sandbox disables the sandbox, --remote-debugging-port opens an unauthenticated DevTools port (pre-existing; G-85 class) | C2 r2 verifier | high (security claim) | behoben (0.8.0): `744dab7` neutralizes inherited Chrome flags before launch; red/green control and independent P2 verifier PASS. |
| G-93 | Signal delivered between the render's hold release and process.exit is dropped (3–44 ms window) → verdict exit instead of death by signal | C2 r2 verifier | medium | herausgefallen (0.8.0): `claude/wp-c2-lifecycle` tip `73562e2` uses a shared interrupt hold across browser, render, CLI and producer; the final tip also mixes egress/sandbox changes and has no independent post-final verification. No narrow lifecycle-only port; defect remains open. |
| G-94 | The request-interception policy does not cover WebSocket / WebTransport / WebRTC / iframe TCP — in the default offline mode as well as with --allow-network (release audit 2026-09-25 on 0.7.0, offline default: WebSocket to a non-tool loopback port delivered, WebRTC STUN sent, verdict clean). Pre-existing; SECURITY.md "network is blocked by default" and "exactly one origin" overclaimed — corrected in docs for 0.7.0, not fixed in code | C2 r2 verifier; release audit | high (security claim) | außerhalb des Umfangs (0.8.0): no independently verified current-Chrome CI net-log fix. The product finding stays open, with the egress limit in `SECURITY.md` and `docs/limitations.md`. |
| G-95 | SIGTERM to an API host leaves the detached source producer alive (pre-existing, producer.ts:682) | C2 r2 verifier | medium | herausgefallen (0.8.0): the producer cleanup in `claude/wp-c2-lifecycle` tip `73562e2` depends on G-93's shared interrupt hold and process-group ownership; no isolated, independently verified port exists. Defect remains open. |
| G-96 | A paginator stylesheet/@import request answered 403 by the loopback server raises no infrastructure event → report over an unstyled document (fail-open; exposed by L1 r2's discovery change, mechanism pre-existing for any uncaptured resource) | L1 r2 verifier | high (in the exposing config) | ⛔ superseded by 2026-09-28 L1 decision above: dropped from 0.8.0 |
| G-97 | Lone tall avoid div with only inline text after an h1 ends exit 3 `document-not-quiescent` ("collector reconciliation failed: 1 unreconciled") — the WP-E1 note, after G-65 is fixed | WP-X impl | medium (real documents) | open |
| G-98 | Paged.js carries a structured block footnote to a page of its own + non-fatal break-cause-undetermined | F5 impl/verifier | low (upstream) | document |
| G-99 | Break-cause classification inside a named-page region: named page read from the page's first source node (a continuing wrapper) → every boundary in/after the region reads `forced`; the real change missed → false env/forced-break declines, exit 4 (sa03) | K2 impl (investigation) | medium–high | WP-B1 |
| G-100 | F5 r2: a footnote fragment clipped away at the footnote-area bottom edge still binds its page (start mark placed on the edge in the non-clipping page-box layer) — false "bound" | F5 r2 verifier | high | herausgefallen (0.8.0): the second F5 review found this HIGH at `dc664e3`; `claude/wp-f5-real-documents` tip `92a7d3a` then refused edge marks and added one clipped-footnote fixture, but has no independent final verifier. A clip with a start mark farther inside the area remains untested, so the false-bound risk is not closed. |
| G-101 | CSS `@import` without whitespace (`@import"/x.css"`) escapes resource discovery, the stylesheet fail-closed guard and the local-uri collector → clean exit over an unstyled document under an allow-listed https base (pre-existing regex `\s+`) | L1 r3 verifier | high (narrow config) | ⛔ superseded by 2026-09-28 L1 decision above: dropped from 0.8.0 |
| G-102 | WP-X r2 clip exemption: any clip-path/clip on an ancestor exempts stranded text from the residue census → exit 0 with text missing from the PDF (e.g. rounded-corner `clip-path: inset(0 round 12px)`) | X r2 verifier | high | WP-X (stopped) |
| G-103 | `body { column-count: 1 }` / `columns: 1` makes body a multicol container; Paged.js lays pages into it → PDF 1 page / half the words, report 2 pages, exit 0 (pre-existing) | X r2 verifier | high | behoben (0.8.0): `744dab7` detects the affected body and refuses silent clean with exit 3; red/green control and independent P2 verifier PASS. |
| G-104 | WP-R2 r2: word-spacing layout fallback samples gaps that are not natural spaces (author word-spacing, other-font inline text, container text-align-last) → divisor inflated, real findings hidden | R2 r2 verifier | high | WP-R2 (stopped) |
| G-105 | WP-R2 r2: floats on both sides at the top of a page → own-run undercount → false widow at default settings | R2 r2 verifier | medium | WP-R2 (stopped) |
| G-106 | K2 r2: corpus gate kills/inspects only the CLI's process group; Chrome runs in its own session, so timeouts orphan it and survivors go unreported (docs claim otherwise) | K2 r2 verifier | high (tooling) | herausgefallen (0.8.0): `claude/wp-k2-corpus-gate` tip `3c10784` adds process ownership and unit tests, but the corpus gate is absent from `origin/main` and K2 remains blocked by F5/L1. There is no integrated gate to repair or verify; the branch-only defect remains open. |
| G-107 | B1 r1: single-name page assumed to carry that name at both edges → false `forced` when leaving a nested named region (Paged.js compares nodeBefore's nearest data-page) | B1 r1 verifier | high | WP-B1 r2 |
| G-108 | Post-0.7.0 macOS gate: the GitHub Action requires bash ≥ 4 (globstar); on macOS `/bin/bash` 3.2 it stops with exit 3 ("bash without globstar"). Fail-closed, but the requirement is not documented in `action.yml`, `docs/ci-recipe.md` or README; 14 Action tests are red on a stock Mac | 2026-09-25 local release gate, macOS arm64 | medium | behoben (0.8.0): `aac36c5` documents bash ≥ 4 and makes the 14 Action tests skip with platform reason on macOS; red/green Mac gate, independent P1 review and targeted rerun after `92d1cc9`. |
| G-109 | Post-0.7.0 macOS gate: `test:report-surface-mutants` expects the Linux fallback message "display role resolved to DejaVu Sans"; on macOS the control cannot produce it and the script fails — a platform-bound negative control, not a surface defect | 2026-09-25 local release gate, macOS arm64 | low | behoben (0.8.0): `aac36c5` uses a platform-neutral negative control; red/green Mac gate and independent P1 review. |
| G-110 | Post-0.7.0 macOS gate: `node tools/make-mark-font.mjs --check` needs python3 `fontTools`; `docs/releasing.md` lists it, but no preflight names the missing module before the check runs | 2026-09-25 local release gate, macOS arm64 | low | behoben (0.8.0): `aac36c5` preflight names missing `fontTools`; red/green Mac gate and independent P1 review. |
| G-111 | Fixed, undocumented 120 s document budget (`DOCUMENT_TIMEOUT_MS`, `PRODUCER_TIMEOUT_MS`): a 175-page real print edition ends exit 3 `checker-crashed` ("timed out after 120000 ms") in both 0.5.0 and 0.7.0 on macOS arm64 under load ~6; the same document measured completely with 0.2.3 on 2026-08-27. Not configurable, not named in `docs/configuration.md` or `docs/limitations.md`; a 77-page document takes ~115 s, so the ceiling sits close to ordinary product sizes | 2026-09-25 consumer comparison, private real-document corpus; current P08 and P05 packed runs on 2026-09-28 | high | behoben (0.8.0): `7b5e2b4` + `188dc20` (merge `fbf0a7f`) give a validated 30,000–1,800,000 ms budget, 600,000 ms default, invalid-value exit 2 and a budget-bearing exit-3 message; the real 120 s control was red before the fix. The specified old 175-page file no longer exists. The Founder delegated document choice on 2026-09-28; P08 `TOOLING_SPEC.md` § Full-Pass-Portabilitaet provided the source-preserving regeneration method. From repaired G-114/G-117 code commit `adfa124`, the packed foreign-CWD current P08 run ended exit 1 on 207/207 bound pages in 104.15 s, max RSS 1,933,590,528 B; P05 ended exit 0 on 77/77 bound pages in 27.65 s, max RSS 1,720,860,672 B. These observations do not claim a run of the missing 175-page bytes. |
| G-112 | Repeated physical copies of one SVG text source share `sourceAddressKey`; `svg/text-overflows-viewport` uses only its within-SVG text index as occurrence key and trips the duplicate-target invariant instead of judging both copies. The current P08 generated print artefact (207 pages, 2026-09-28) ends exit 3 after acquisition. | 2026-09-28 foreign-tarball P08 run, `/usr/bin/time -l`, rule-evaluation red control | high (real document) | behoben (0.8.0): `6979782` gives physical copies distinct occurrence identities; real red/green control and independent G-112 verifier PASS. |
| G-113 | The overlay bounds source fragments against `.pagedjs_page`, which is only the 800 px preview viewport while `.pagedjs_pagebox` is the 1122.5 px physical A4 box. Continuation end marks at the measured content edge are refused, and Paged.js' side-fragmentainer clones of an avoid-break block are counted as phantom fragments even when printable copies with both marks occur on the next two pages. On the 2026-09-28 P08 artefact this left pages 135 and 163 unbound (205/207). | 2026-09-28 Chrome 153 geometry probe and before/after P08 reports (`/tmp/bl-integrated-p08.json`, `/private/tmp/g113-r2-p08-report.json`); live red/green controls including a clipped footnote sharing the deferred clone's SID | high (evidence coverage) | fixed on `claude/wp-g113-overlay-binding` at `1c3220c`: physical pagebox, observed boundary mark checked in PDF, deferred clone exclusion only when the whole avoid-break ancestor is off-sheet and a complete later mark pair exists. After independent review found SID-wide suppression could erase a clipped footnote, the second-round repair excludes only the exact deferred mark objects; colliding-SID footnote marks remain unplaced. Isolated P08 run: evidence 207/207 bound, pages 135/163 bound, raster diff 0; exit 4 remains solely G-114. Independent second review PASS without new BLOCKER/HIGH. |
| G-114 | Visible SVG text strokes in the regenerated P08 print document made `svg/text-overflows-viewport` decline 98 of 472 candidates (374 measured, exit 4). A safe, interior-only painted-bounds upper envelope is needed; strokes at or near the viewport boundary must remain undecidable. | 2026-09-28 red Chrome fixture and frozen foreign-CWD packed P08/P05 reports in `WI-20260928-breaklint-g114-current-p08` | high (real document, coverage) | behoben (0.8.0): code `adfa124`, no-ff merge `297b0fa`, independent second review PASS: the previous isolated `e0c9430` package remains withdrawn after its MEDIUM review. On the new integrated G-113 base, the Chrome control failed 11 != 10 before code and passed after it. The first independent review found new HIGH G-117, repaired in `adfa124` with a separate real red-to-green control. The repaired packed foreign-CWD current P08 ended exit 1 with 472/472 SVG targets and 207/207 pages bound; P05 ended exit 0 with 156/156 SVG targets and 77/77 pages bound. A boundary-touching stroke still declines, preserving the floor of 1. The old 175-page P08 file was absent; the current 207-page input is source-bound under P08 `TOOLING_SPEC.md` § Full-Pass-Portabilitaet. |
| G-115 | The G-113 overlay regression adds a second real Chrome leaf, but `tests/tools/live-run.mjs` still declares one. The structured live runner refuses the file (`leaf pass denominator was 2, expected 1`), so the Mac live gate is red even though both assertions pass. | 2026-09-28 integration live run, `WI-20260928-breaklint-g115/evidence/red-live.log`, exit 1 | medium (gate) | behoben (0.8.0): `caef40a` changes only the declared leaf count from 1 to 2; strict event and exit checks remain. After the G-116 fixture repair the full Node 24 live gate passed 10/10 suites, 107/107 tests. Fresh independent @Prog review PASS, merged as `292b390`. |
| G-116 | The `layout-drift-chaos.html` live fixture drifts in its un-injected §10.5 control page. Two full live runs reach `document-not-quiescent` in the control and return before the test's existing freeze-retry assertion, making the Mac live gate persistently red. | 2026-09-28 Node 22/24 real Chrome probes and two full live logs, `WI-20260928-breaklint-g115/evidence/` | medium (gate) | behoben (0.8.0): `caef40a` waits for the paginated source-mapped target before starting drift; the un-injected control stays still. The unchanged assertion reached real freeze retries (4), no snapshot, exit-3 infrastructure result. Targeted render-run passed 35/35 and full Node 24 live gate passed 107/107. Fresh independent @Prog review PASS, merged as `292b390`. |
| G-117 | A thick stroke painted only on a `<tspan>` descendant bypassed G-114's conservative envelope when the outer `<text>` had `stroke:none`. The parent fill box was measured although `getBBox()` excludes the descendant stroke, allowing a false clean SVG verdict. | 2026-09-28 first independent G-114 verifier HIGH; real Chrome red `10 !== 11` on child-only stroke, then green controls with both painted and unpainted outer `<text>` | high (silent false clean) | behoben (0.8.0): code `adfa124`, no-ff merge `297b0fa`, independent second review PASS: the collector now counts descendant paint for target admission and declines child stroke, paint servers and other effects before measuring the parent box. The strict SVG floor stays 1. `npm test` 839/839 and full live 107/107 passed; packed current P08/P05 remain exit 1/0 with 207/207 and 77/77 bound pages. |
| G-118 | The first 0.8.0 DE/EN website draft and `llms.txt` carried 8/12, 10/12 and 8/8 success totals from earlier releases without a 0.8.0 corpus rerun. Its `scripts/check.js` required those strings while admitting remeasurement was future work. | 2026-09-28 two independent reviews of dropped site branch `prog/breaklint-080-site-20260928` tip `49f2129`; separate follow-up commit `61a70b0` | high (public claim) | behoben (site follow-up `61a70b0`): DE/EN/llms remove the totals; a new contract test was red on the pre-fix site main (exit 1) and green 2/2 on the fix. Fresh independent @Prog review PASS; the original package remains dropped and its remote branch is retained. PR #48 merged as `eb135d3` after npm 0.8.0 verification; live DE/EN both HTTP 200 with version, G-114 caveat and no Cloudflare email-obfuscation residue. |
| G-119 | The first 0.8.0 website draft claimed repeated SVG text was handled without naming the known running-margin-box failure. Repeated inline SVG `<text>` cloned into running margin boxes shares a target ID and still ends `checker-crashed` exit 3. | 2026-09-28 second independent review of dropped site branch `prog/breaklint-080-site-20260928` tip `49f2129`; follow-up site commits `61a70b0` and `8b1b47c` | high (public claim) | behoben (site follow-up `61a70b0`, precision `8b1b47c`): DE/EN/llms name inline SVG in running margin boxes, the shared target ID and exit 3. The new copy contract was red before and green 2/2 after; both separate site packages received independent @Prog PASS. The old site package remains dropped; PR #48 merged as `eb135d3` after npm 0.8.0 verification; live DE/EN checked. |
| G-120 | The first G-118/G-119 follow-up caveat mentioned SVG text in running margin boxes but omitted the measured preconditions: inline SVG and page clones sharing a target ID. | 2026-09-28 independent first review of site follow-up commit `61a70b0`, `WI-20260928-breaklint-site-followup` | medium (public precision) | behoben (`8b1b47c`): DE/EN/llms now give both preconditions and the `checker-crashed` exit-3 result. The tightened copy contract was red 1/2 at `61a70b0` and green 2/2 at `8b1b47c`; fresh independent @Prog review PASS without findings. PR #48 merged as `eb135d3` after registry verification; live DE/EN checked. |
| G-121 | The first G-118/G-119 follow-up guard rejected old corpus totals only as words with plain spaces; `8/12`, `10/12`, `8/8` and HTML `&nbsp;` variants passed the release-truth check. | 2026-09-28 independent first review of site follow-up `61a70b0`; real pre-fix mutated `node scripts/check.js` exit 0, `WI-20260928-breaklint-site-precision/evidence/` | medium (gate regression) | behoben (`8b1b47c`): guard and contract test normalize HTML and Unicode NBSP and reject the word/slash forms. The pre-fix real mutation falsely passed; six post-fix injected variants each returned exit 1 and the clean site check passed. Full local Site gates passed, fresh independent @Prog review PASS without findings. PR #48 merged as `eb135d3`; live DE/EN checked. |
| G-122 | The final 0.8.0 website copy named SVG occurrence handling but omitted G-114’s narrow visible-stroke proof and the boundary-touch case that remains unmeasured and ends exit 4; readers could infer broader viewport coverage than released. | 2026-09-28 independent final Site verifier MEDIUM on `ac0d201`, `WI-20260928-breaklint-site-svg-truth` | medium (public release truth) | behoben (site `007835c`, PR #48 merge `eb135d3`): DE/EN/llms name supported stroke/transform prerequisites, strict interior bound, boundary-touch exit 4 and no exact painted-bounds/overflow claim. Final committed contract run against old Site pages red 2/3, on fix green 3/3; full local Site suite 1197 pass/0 fail/2 skip, @Brand GO, fresh independent @Prog PASS. Live DE/EN HTTP 200, version 0.8.0, og:image v0.8.0 and no Cloudflare email-obfuscation residue. |

## 2026-10-06 additional measured work and explicit limits

| id | issue | evidence | severity | disposition |
|---|---|---|---|---|
| G-123 | The synthetic fixture driver destroyed the PDF document proxy although the installed API exposes destruction on the loading task. | Source3 real native acquisition stopped with `doc.destroy is not a function`; Source4 task-helper tests and three mutations, frozen commit `5cbe6eb`, fresh narrow independent audit PASS. | high (evidence tooling) | Changed on the package branch; integration, real fixture anatomy, paint and full qualification pending. Both original native stops remain recorded. |
| G-124 | Ordered nested error causes may be lost across the browser-to-Node exception boundary in the fixture driver. | Fresh Source4 independent static audit, medium; helper-local cause ordering is tested, cross-realm cause serialization is unmeasured. | medium (diagnostics) | Still open; accepted limitation for valid-PDF fixture acquisition. Errors still stop the native operation. No complete lifecycle or serialized-cause claim. |
| G-125 | Continuation pages of a multi-page table can omit local column headings. | Private rendered-page confirmations from multiple independent families. Product source bytes stay private; a self-authored public oracle is pending. | high (reader context) | Still open; new rule/design proposal requires public fixture, accounted candidates and label-set precision before activation. |
| G-126 | A table's column tracks can change across a page break and weaken row-to-column interpretation. | Private full-context rendered-page confirmation; source cause and delivered-file correspondence remain unresolved. | medium (reader interpretation) | Still open capability question; separate from missing repeated headers and outside the preregistered B.2 recall denominator. |
| G-127 | The synthetic driver resolved native relative PDF/PNG references against its CWD instead of each producer's export root. | The first Source4 acquisition stopped during artifact binding. The frozen two-file path/error-guard follow-up has discriminating reds, 27 passing package tests, killed guard mutants and a changed-test compiler negative/restoration proof. A fresh independent audit is PASS with zero blocker/high/medium and six low findings. | high (evidence tooling) | Partial: the bounded local guard follow-up at 1c14427468bc88504a15acc63b559353989d700a is independently reviewed; AC1–AC7 are supported and AC8 remains open. No integration or complete experiment acceptance is established. Earlier invalid-copy/protocol stops, original worktree typecheck exit127 and omitted runtime prebinding remain recorded. The original hundred-run experiment remains stopped with zero qualified cases and anatomy remains unqualified. |
| G-128 | The synthetic anatomy comparator can describe an inter-element formatting-separator difference as lost or duplicated source text. | In the first saved case, the individual heading and body strings remain exact; all non-whitespace characters retain their order. The placed container join omits exactly one authored inter-element line feed, so the existing flat-text comparison fails. Saved observer-off/on comparable projections agree; this is read-only analysis, not a new witness classification. | medium (evidence classification) | Still open. The exact paginator mutation cause and expected empty-fragment/paint qualification remain unknown. The attempted three-page visual review failed before image Reads/model tokens and supplies no visual verdict. No comparator, normalization, digest or handwritten fixture expectation changed, and arbitrary whitespace may not be discarded. The original case remains not comparable; no blanket text-loss or G-128 closure follows. |

G-06 and G-12 remain open. The new synthetic-driver audit does not establish a
collector correction or clear the earlier whole-table coverage refusal.

## 2026-10-07 focused release disposition

The maintainer replaced the exhaustive review process with `planning/finish-0.9.md`.
This does not close any uncorrected product defect. Integration at `eeddff5` has no source
changes relative to 0.8.0; private response-classification tooling is not product code.

- G-06/G-12: remain open. Existing margin-flow filtering is already on main; it does not
  establish a fix for newly observed off-sheet/staging fragments or whole-table coverage refusal.
- G-83/G-104/G-105: existing line ownership and natural-space sampling fixes are already in
  main (ancestor `1640d4411f66206abe96e3a6d5d39e83787778b0`). Newly alleged residual cases
  need a discriminating public reproduction; no new port or blanket closure is credited.
- G-99/G-107: token-based named-page handling is already in main (ancestor
  `0c24a323cae2b95f891d631908a14bf87133e364`). Newly unbound observations are not evidence
  that this implementation is absent; its remaining limits stay open.
- G-89/G-102: 0.8.0 refusals remain in force; no general PDF completeness guarantee is added.
- G-91/G-94: remain open and documented. There is no new current-Chrome net-log fix.

The two new figure checks and counted human-report measurement reasons are separate bounded
packages. Their supported acquisition and test results will be recorded after implementation.

## Focused 0.9 follow-up entries

| id | problem | disposition |
|---|---|---|
| G-129 | Figure bodies and captions lacked a shared authored index and local fragment witnesses. | The 0.9 candidate adds a bounded single-image figure check, off by default at warning severity. Unsupported or ambiguous bodies are counted as declined. Complex bodies, tables, numbering and free-text references remain open capabilities. |
| G-130 | Human reports made counted declined candidates difficult to see after coverage met its floor. | The 0.9 candidate shows counted reasons in console, HTML and Markdown, up to three deterministic next checks and rule counts while retaining every finding. This is navigation, not an estimated reader-impact score or cause diagnosis. |
| G-131 | A delegated AI visual review had no distinct, hash-bound receipt contract and could only be represented incorrectly as a human or a failing ordinary agent. | Ledger 6 introduces a distinct delegated-ai kind with release-specific delegation, native model/output receipt and complete image inventory. Ordinary agent entries remain unable to pass; historical rounds are unchanged. The record is not provider authentication or proof of perception. |

| G-132 | An unavailable source inventory emitted figure records with empty source IDs, invalidating the entire snapshot and suppressing existing rules in no-source-map runs. | Fixed in `5a6bbc5`: omit the optional inventory unless acquisition is complete and every figure/reference source belongs to the acquired source map. Existing checks remain measurable; requested unavailable figure checks decline with exit 4. Present malformed external inventories still fail with exit 3. Original live failure, discriminating unit red, two killed guard mutants and restored legacy findings are retained; the complete live suite then passed 112/112 on `f8108579`. |

| G-133 | Next-check and grouped-rule links targeted finding articles although the accessible report-navigation contract requires a heading or section. | Fixed in `890e07d`: links target the existing finding heading; original technical gate and discriminating DOM tests were red, the old-target mutation failed, and the complete technical gate passed at `a7fc2607`. Article identities and labels remain unchanged. |
| G-134 | A declined-candidate count could print as an isolated, unlabelled final digit, defeating the existing text-depth witness. | Fixed in `755708c`: an explicit nonwrapping “Count N” label keeps value and meaning together. The original PDF red and independent pixel diagnosis are retained; DOM tests and old-layout mutation discriminate the change. The complete technical print gate passed at `a7fc2607` without changing its classifier or 1-percent tolerance. |

| G-135 | The historical grid-container row-pitch mutation survived after report pagination changed; the unchanged ±8% check was no longer exercised by that injection. | Changed the control in `tests/tools/render-report-surfaces.mjs` to stretch the second row of the first coverage body. Measured 2026-10-07: the current clean table has median 35 px and range 34–36 px; the targeted injection produces `layout/orphan` pitch 57 px and the genuine named rejection. Reverting to the old grid injection returns renderer exit 0 and fails the expected-red assertion; restored source is byte-exact. The deleted original mutant's detailed geometry remains unknown. No classifier, threshold or tolerance changed. The complete original 34-control suite passed on `0da4d74`. |

| G-136 | The long-remediation mutation still triggered the unbreakable-unit bound, but its earlier text-depth phase disappeared after navigation changed preceding page content. | Re-established the same two-condition counterexample by starting its first finding on a fresh page and extending only the injected synthetic prose. Measured original: unit 654.3 px (63.4%), without the required underfilled-page rejection; stronger prose alone: 827.8 px (80.2%), also without that phase. The anchored current control produces page text depth 34.1%, framed ink 99.9% and tail 827.8 px, satisfying the unchanged rejection regex and continuation-label requirement. Returning to the original control fails the expected-phase assertion, followed by byte-exact restoration. No bound, timeout, assertion or product style changed. |

| G-137 | The private exit-4 sight checklist conflated a real floor shortfall with no established candidate measurement. | Refuted against unchanged `html-model.ts` and the existing reporting contract: the former correctly says “Below required floor”, the latter “Not established”. The original failed judgement remains retained; a fresh corrected state review passed without code changes. |
| G-138 | Next-check coverage floors display a ratio while the adjacent callout/table use percentages; some metadata labels and mobile header tiers need clearer units. | Still open, medium/low surface follow-up. Exit 4 and actual 50% versus required 100% remain explicit. No false clean verdict is established. |
| G-139 | Print disclosure affordances, recurring tail labels and identifier wrapping retain small presentation costs. | Explicit accepted-risk/follow-up dispositions in delegated AI rounds 5 and 6; all data, evidence identities and labelled continuations remain present. Round 6 also retains the measured split-card-frame spacing, ratio wording and short-list continuation costs. |

| G-140 | Two historical review regression tests incorrectly required the whole ledger to stop at its fourth round. | Fixed after the actual ordered test failure: the original first-four digest and all human-review assertions are preserved, and the fifth delegated round is separately checked without human-pass transfer. Original red, 53-leaf green, stale-test red mutation and restored green are retained; no rendered-input or gate logic changed. |

| G-141 | The 0.9 report inventory used the measured macOS total of 30 A4 rasters as a universal Linux expectation. | Changed to fixed platform/state inventory assertions after CI run 37594360825 and isolated unchanged-renderer run [37597727752](https://github.com/godarg/breaklint/actions/runs/37597727752) independently confirmed Linux 3/8/9/9 pages versus macOS 3/9/9/9. Native `pdfinfo`, PNG membership/hashes and all preceding semantic/pixel/print checks agree; screens 24, tiles 168 and PDFs 4 are identical. No content bound or tolerance is relaxed. Fresh source-bound round 6 sight evidence passed all 32 cells after the correction. The complete final release gates remain required. The isolated diagnostic workflow is superseded by this measured correction; its native evidence is retained privately before its one-off branch is eligible for cleanup. |


## 2026-10-07 — publication audit advisories retained as open work

The 0.9.0 release accepted these bounded audit risks with disclosure. None is a completed fix;
the experimental figure rules remain warnings and default-off. The canonical report remains
JSON. Each follow-up must retain source/evidence accounting and the existing coverage gates.

| id | problem | disposition |
|---|---|---|
| G-142 | Strict enables the new figure checks and requires complete coverage. Unsupported non-image figure bodies or unavailable source inventories can therefore change an unchanged strict document from exit 0/1 to exit 4. | Still open, medium. The release notes disclose the boundary, including unsupported source constructs and `--no-source-map`. Determine supported applicability and non-image figure classification with independent fixtures before changing the core; never convert an unavailable measurement into a clean result. |
| G-143 | The authored fragment target inventory includes `id` attributes but not legacy `<a name>` targets, so the opt-in `figure/dangling-reference` rule can report those legacy targets as missing. | Still open, low. Disclosed for 0.9.0; use an authored `id` when enabling this experimental check. Expanding the inventory needs source-bound fixtures for legacy targets without inventing IDs or claiming complete HTML fragment coverage. |
| G-144 | Human next-check text can count outside-coverage declines as not measured while using the reduced candidate denominator, producing confusing wording such as “1/1 measured; 2 not measured”. | Still open, low. Canonical JSON retains the separate accounted values. Clarify the display in a bounded follow-up while keeping every decline and its reason visible; this wording does not establish precision, recall or calibration. |

## 2026-10-07 — completed published-tag Action witness

⛔ Superseded: the one-off `codex/breaklint-090-action-reference-smoke` branch is superseded by the successful [published v0.9.0 Action smoke, run 37608861377](https://github.com/godarg/breaklint/actions/runs/37608861377).

The single push of commit `7ff5480cc89f9f6c0590720a2f693887cbe827b9`, based on release commit `af794dc0e10a7b739d8430f54f8bdbf92cc85db1`, exercised `uses: godarg/breaklint@v0.9.0` against the unchanged self-authored `tests/fixtures/action/clean.html`. Attempt 1 completed successfully on 2026-10-07 at 10:40:08 UTC. The actual Action carrier and canonical schema-5 JSON report agree on installed version `0.9.0`, exit `0` and verdict `clean`: one input, four analysed pages, twelve enabled rules, three measured rules and zero findings. The report input hash matches the authored fixture; all four retained page rasters and its diagnostic PDF match their recorded hashes. The report does not assert a delivered-product binding.

The named artifact `breaklint-090-published-action-smoke` (id `11476376497`, 170,236 service-reported bytes) and its ten original members are retained privately with the complete native logs and command exits. The service reports artifact digest `sha256:76c88eae4479c84ed7599410e95013ea74b5f43837bd09d14f77b65b51c6ef30`; this service ZIP digest is retained separately from the independently recorded member hashes. An initial CLI lookup returned HTTP 404 because the temporary workflow was absent from the default branch; the retained read-only correction identified the same successful run by its exact branch, commit, event, workflow path and attempt. No second push or workflow rerun occurred.

This isolated workflow is a release end-to-end witness, not a product feature, and must not be merged into `main`. After this supersession record is adopted and the private evidence retained, its clean branch/worktree are eligible for cleanup. This smoke does not establish population precision, recall, broad product quality or an independent acceptance of the full mission.
