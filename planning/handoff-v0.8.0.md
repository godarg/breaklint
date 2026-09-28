# Handoff — breaklint 0.8.0

Status on 2026-09-28: **release candidate prepared; the first G-114 review found HIGH G-117, and the repaired package awaits the permitted second independent review and integration before the release-preparation PR merge**. No 0.8.0 tag, npm publication, GitHub release, site deployment or consumer upgrade has been made. This record describes measured work on `claude/integrate-breaklint-080` and the separate `claude/wp-g114-current-p08-080` candidate; it is not a publication claim.

## 1. Integrated work

The integration branch starts at `10765b4` and uses `--no-ff` package merges. `planning/open-work.md` carries the per-item disposition and evidence pointers.

| Package | G-IDs | Code commit / integration merge | Independent review and controls |
|---|---|---|---|
| P2 content and inherited flags | G-85, G-89, G-92, G-103 | `744dab7` / `078536a` | Fresh verifier PASS; real red-to-green content and launch controls. `SECURITY.md` and `docs/limitations.md` changed with the code. |
| G-112 SVG occurrence identity | G-112 | `6979782` / `dbfccaf` | Fresh verifier PASS; the duplicate-target control was red before the fix and green after it. |
| P0 configurable document budget | G-111 | `7b5e2b4`, `188dc20` / `fbf0a7f` | Real red control for the 120 s budget and green unit/config controls. Current source-bound P08 and P05 foreign-tarball acceptance is recorded in §3; the original 175-page bytes are absent. Final independent P0 review is pending. |
| P1 Mac gates | G-108, G-109, G-110 | `aac36c5`, `92d1cc9` / `a2e7739` | Mac red-to-green controls; first fresh review found a MEDIUM PATH probe mismatch, corrected in `92d1cc9`; targeted gates and typecheck green. The request permits a second round only for a new BLOCKER/HIGH, so no second round was run. |
| G-113 physical evidence binding | G-113 | `66b438d`, `1c3220c` / `2eaec13` | First verifier found HIGH SID-wide deletion; the repair passed a fresh second review without new BLOCKER/HIGH. Colliding-SID footnote control red before and green after. Isolated P08 generated artifact bound 207/207 pages with raster diff 0. |
| Live gate count and drift fixture | G-115, G-116 | `caef40a` / `292b390` | Fresh independent @Prog verifier PASS with no findings. The real red gate first expected 1 instead of 2 overlay leaves; two more runs exposed the control-page drift and a diagnostic run exposed a null access in the initial fixture repair. The final unchanged Freeze assertion passed in `render-run` 35/35, full Node 24 live 107/107, `npm test` 839/839, typecheck 0. |

The integration-only test pin correction is `c9e5dfa`: a real red `npm test` run (837/839) was corrected to 839/839 before G-113 was merged. The `docs/status.md` marker now records 677 unit tests, 839 aggregate tests and 107 live tests, measured in the G-115/G-116 worktree; `npm run test:documented-figures` passed on the integration worktree using those generated measurement files, whose source code is byte-identical after the no-ff merge. The exact local release gate is still pending. The separate G-114 current-document candidate has two real red-to-green Chrome controls, `npm test` 839/839, full live 107/107 and typecheck green; it is not integrated until the permitted second frozen review passes.

## 2. Packages that fell out of 0.8.0

These branches remain available remotely; they have not been merged as fixes. Only their register dispositions were ported to the integration branch.

| Package | G-IDs | Remote branch and tip | Reason |
|---|---|---|---|
| L1 | G-86, G-88, G-96, G-101 | `origin/claude/wp-l1-080` at `84e05e4` | CSS discovery and `<base>` resolution are coupled; an isolated whitespace patch would leave silent unstyled measurement. No narrow current-Chrome acceptance. |
| F5 | G-78, G-79, G-100 | `origin/prog/p3-f5-disposition-20260928` at `98b6e84` | Two prior FAIL rounds, second with HIGH false-bound clipped footnote; the final candidate has no independent PASS. |
| C1/C2 and K2 | G-23, G-93, G-95, G-106 | `origin/prog/p3-c1c2-k2-disposition-20260928` at `20c9e69` | The lifecycle changes depend on a broad process-ownership and egress branch; the corpus gate is absent from main. No narrow independently verified port. |
| Former G-114 SVG painted bounds package | G-114 | `origin/claude/wp-g114-svg-safe-bounds` at `e9f780e` (code candidate `e0c9430`) | This *former package* stays withdrawn: its sole fresh verifier returned FAIL/MEDIUM because its frozen register lacked admissible packed P08/P05 evidence. It receives no second round. The new package on the integrated G-113 base and current source-bound P08 is independent work (§3). |

G-91 secure-DNS egress and G-94 WebSocket/WebRTC/WebTransport egress are outside the 0.8.0 fix scope under the stated proof condition and remain open product findings. No current-Chrome CI net-log proof for a fix was obtained, so no security claim was upgraded. P4 was not attempted while the release blocker remained. The explicitly excluded G-11, G-19–G-25 and G-58 remain outside this release; `calibrated: false` remains in place.

## 3. Current-product document choice and packed acceptance

The requested `02_Products/Digital_Products/08_autonomous-agent-team/build/print.html` (175 pages in the earlier observation) does not exist in the current product tree. The Founder explicitly delegated choosing the helpful document and where to bind it on 2026-09-28. The source of the choice is P08 `TOOLING_SPEC.md` § **Full-Pass-Portabilitaet**: copy current `build/` inputs byte-for-byte to scratch, verify their hashes, and run the product-local `_tools/make_print_edition.py` there. This produced the current P08 print input from 21 byte-identical copied source files, SHA-256 `7e046a65e6d9f5134bc65b5b63080d86a0df4c75d1b2d513568e78c70e055dcc`; P05 used its current 19 copied source files and shared print generator, SHA-256 `7fd877ce7e07846b7d7242ca87a0c1e62a9d4abe1c3400cc9e20c275e0dd617d`. The source-binding manifests are `print-source-binding.json` in the two scratch roots named below. This is a current-product acceptance, **not** a claim to have run the missing 175-page bytes.

The unchanged integration tarball at `64d7c0a` first established the negative baseline from foreign CWD: P08 exit 4, 207/207 bound pages, SVG 374/472 measured, 104.64 s and 1,766,785,024 B max RSS; P05 exit 0, 77/77 bound pages, 27.76 s and 1,766,588,416 B max RSS. The new G-114 package began with a real Chrome red control (`11 !== 10`) before its production edit and passed the same control after it. Its first independent @Prog review found new HIGH G-117: descendant-only `<tspan>` stroke could bypass the bound. A second Chrome control was red (`10 !== 11`) before repair and green after it, including an outer `<text>` that itself paints nothing. From repaired code commit `adfa124`, the tarball SHA-256 is `88c377987e1dad690c8406e6ab2e4b3f4b29e4874249b69c8c3e6c33935912c6`; it was installed with the pinned renderer peers into `/tmp/breaklint-g117-freeze-accept.b4g6sf`, a foreign directory, and invoked there through its own `node_modules/.bin/breaklint`.

| Packed candidate, current inputs | Exit and verdict | Physical pages and binding | SVG viewport candidates | Wall time | Max RSS | Report SHA-256 |
|---|---|---|---|---:|---:|---|
| P08 (`/var/folders/29/2hf3v_hj0_x7fvgtd0q7wcmw0000gn/T/breaklint-p08-current-3ouqmq6k/product/build/print.html`) | 1, findings | 207/207 | 472/472, floor 1 | 104.15 s | 1,933,590,528 B | `ce67b74baf8933aa1f1db957dea6e70b0bbce69148cc2a5fe59f5c481d422cd0` |
| P05 (`/var/folders/29/2hf3v_hj0_x7fvgtd0q7wcmw0000gn/T/breaklint-p05-current-x23apjrm/product/build/print.html`) | 0, clean | 77/77 | 156/156, floor 1 | 27.65 s | 1,720,860,672 B | `efcef70905a1bc35afd732587d8118ff26475878184ccf38da9947425af82fad` |

Before each load, `pgrep -fl breaklint-chrome-profile` found no orphan Chrome. The return code was read immediately after each command, without a pipe. `pdfinfo` independently counted 207 and 77 pages in the checked PDFs. The 600,000 ms default has 82.6% observed time reserve against current P08 on this Mac; the peak is below 2.0 GB on a 16 GiB system. This supports the document-budget setting for these current inputs, while larger or heavier files remain a memory limitation. The repaired G-114/G-117 candidate requires its permitted second independent @Prog review and integration before the release-preparation PR can merge.

## 4. Release steps still required

Follow `docs/releasing.md` in order. Candidate commit `70a4505` prepared version 0.8.0 in `package.json` and both lockfile root fields, the literal `v0.8.0` tag trigger, `## 0.8.0 — TBD-at-tag`, the v0.8.0 poster URL and a truthful preparation status. `npm run test:release-tag` passed; `npm pack --dry-run --json` listed 190 package files and excluded `planning/`, `tests/` and `action/`. A fresh independent release audit found public security wording and register staleness, repaired in the next commit. The current source-bound packed P08/P05 acceptance is now recorded in §3; the second G-114/G-117 package review, final P0 review, PR CI and exact local gate on the future merge commit still remain.

The changed `src/` files are within `REVIEW_INPUT_ROOTS`. After the preparation merge, **stop for the Founder's real report-surface review** under `docs/reporting.md`. Only the literal judgment from the current chat may be entered into the ledger. A FAIL is recorded as FAIL and stops the release. If it passes, commit the ledger with the `<!-- review-state -->` sentences, wait for green CI, make the date-only changelog commit, wait for green CI on that exact commit, then set and push the annotated tag. Never move or reuse the tag. After tagging, verify release run, both clean consumers, npm integrity, tarball SHA-256, provenance, poster URL and Action reference; a failure stops without deleting or retagging.

## 5. Other downstream work

The DE/EN website draft is on local branch `prog/breaklint-080-site-20260928` in a separate site worktree, commit `280e6e0`. Its local declared gate passed. It must await real 0.8.0 release facts, the final copy check, both required PR gates and a merge to deploy. Site PR #47 is untouched. Studio and DS_OS consumers remain on their existing versions until npm 0.8.0 is verified. The workspace release note and memory update also remain to be written from final measurements.

## 6. Founder report-surface review package — for the future merge commit

This section is a preparation aid, not a review result. It becomes actionable only after the
P08 gate, PR merge and exact local release gate. Record `git rev-parse HEAD` from a clean checkout
of the **release-preparation merge commit**; use that SHA in the chat judgment. On this candidate,
the technical gate passed 32/32 cells and produced 207 physical artifacts (24 full screens, 152
screen tiles, four PDFs and 27 page rasters). Comparison with the 0.7.0 ledger changed the bound
fingerprint of **all 32 cells** and the decoded pixels of all 24 screen cells. Re-render at the
merge commit; these candidate hashes are not transferable.

Commands on the Mac from that clean checkout, in this order:

```bash
git rev-parse HEAD
npm ci --no-audit --no-fund
npm run test:report-surfaces:technical
open .artifacts/report-surfaces/review-gallery.html
open .artifacts/report-surfaces/*--a4.pdf
```

The gallery groups the exact 32 cells as follows; each screen cell includes its full image and
every viewport-height tile. Open `manifest.json` alongside it for the binding and artifact names.

| State to judge | Light screens | Dark screens | Print cells | What must be visible |
|---|---|---|---|---|
| `clean` | desktop · tablet · mobile | desktop · tablet · mobile | PDF · three rasters | “Clean run” only here; all 13 rules and coverage table readable. |
| `findings` | desktop · tablet · mobile | desktop · tablet · mobile | PDF · eight rasters | Finding cards, evidence paths, remediation tint and table continuation. |
| `infrastructure` | desktop · tablet · mobile | desktop · tablet · mobile | PDF · eight rasters | Checker failure verdict and exit 3, with no false clean state. |
| `insufficient-coverage` | desktop · tablet · mobile | desktop · tablet · mobile | PDF · eight rasters | Coverage verdict and exit 4, with “Below floor” legible without colour. |

For each state, check verdict and exit code first; then legibility, font roles, mobile wrapping
and horizontal clipping; then PDF page numbers, running head, final end mark, split findings,
repeated table header and the untested-advice caveat as specified in `docs/reporting.md` §“Review
package”. The known residuals to accept or reject explicitly are: tail label even on unsplit
findings; over-long evidence name wrapping within itself; Ubuntu font resolution unmeasured.
The review can be navigated in about 20 minutes by following the gallery state order, then the
four PDFs; it still requires looking at every tile and printed page.

The Founder supplies a literal **PASS or FAIL**, the merge SHA, cell-specific findings and the
three residual decisions in this chat. The assistant records exactly that judgment as one new
ledger round and runs `npm run test:report-surfaces:local`; no prior round or agent judgment can
stand in for it. A FAIL is entered as FAIL and stops the release.
