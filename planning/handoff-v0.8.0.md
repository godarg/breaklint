# Handoff — breaklint 0.8.0

Status on 2026-09-28: **integration in progress; release blocked before the release-preparation PR**. No 0.8.0 tag, npm publication, GitHub release, site deployment or consumer upgrade has been made. This record describes measured work on `claude/integrate-breaklint-080`; it is not a publication claim.

## 1. Integrated work

The integration branch starts at `10765b4` and uses `--no-ff` package merges. `planning/open-work.md` carries the per-item disposition and evidence pointers.

| Package | G-IDs | Code commit / integration merge | Independent review and controls |
|---|---|---|---|
| P2 content and inherited flags | G-85, G-89, G-92, G-103 | `744dab7` / `078536a` | Fresh verifier PASS; real red-to-green content and launch controls. `SECURITY.md` and `docs/limitations.md` changed with the code. |
| G-112 SVG occurrence identity | G-112 | `6979782` / `dbfccaf` | Fresh verifier PASS; the duplicate-target control was red before the fix and green after it. |
| P0 configurable document budget | G-111 | `7b5e2b4`, `188dc20` / `fbf0a7f` | Real red control for the 120 s budget and green unit/config controls. The exact 175-page artifact and final foreign-tarball acceptance are pending (§3); the second verifier has not given a final PASS. |
| P1 Mac gates | G-108, G-109, G-110 | `aac36c5`, `92d1cc9` / `a2e7739` | Mac red-to-green controls; first fresh review found a MEDIUM PATH probe mismatch, corrected in `92d1cc9`; targeted gates and typecheck green. The request permits a second round only for a new BLOCKER/HIGH, so no second round was run. |
| G-113 physical evidence binding | G-113 | `66b438d`, `1c3220c` / `2eaec13` | First verifier found HIGH SID-wide deletion; the repair passed a fresh second review without new BLOCKER/HIGH. Colliding-SID footnote control red before and green after. Isolated P08 generated artifact bound 207/207 pages with raster diff 0. |
| Live gate count and drift fixture | G-115, G-116 | `caef40a` / `292b390` | Fresh independent @Prog verifier PASS with no findings. The real red gate first expected 1 instead of 2 overlay leaves; two more runs exposed the control-page drift and a diagnostic run exposed a null access in the initial fixture repair. The final unchanged Freeze assertion passed in `render-run` 35/35, full Node 24 live 107/107, `npm test` 839/839, typecheck 0. |

The integration-only test pin correction is `c9e5dfa`: a real red `npm test` run (837/839) was corrected to 839/839 before G-113 was merged. The `docs/status.md` marker now records 677 unit tests, 839 aggregate tests and 107 live tests, measured in the G-115/G-116 worktree; `npm run test:documented-figures` passed on the integration worktree using those generated measurement files, whose source code is byte-identical after the no-ff merge. The exact local release gate is still pending.

## 2. Packages that fell out of 0.8.0

These branches remain available remotely; they have not been merged as fixes. Only their register dispositions were ported to the integration branch.

| Package | G-IDs | Remote branch and tip | Reason |
|---|---|---|---|
| L1 | G-86, G-88, G-96, G-101 | `origin/claude/wp-l1-080` at `84e05e4` | CSS discovery and `<base>` resolution are coupled; an isolated whitespace patch would leave silent unstyled measurement. No narrow current-Chrome acceptance. |
| F5 | G-78, G-79, G-100 | `origin/prog/p3-f5-disposition-20260928` at `98b6e84` | Two prior FAIL rounds, second with HIGH false-bound clipped footnote; the final candidate has no independent PASS. |
| C1/C2 and K2 | G-23, G-93, G-95, G-106 | `origin/prog/p3-c1c2-k2-disposition-20260928` at `20c9e69` | The lifecycle changes depend on a broad process-ownership and egress branch; the corpus gate is absent from main. No narrow independently verified port. |
| G-114 SVG painted bounds | G-114 | `origin/claude/wp-g114-svg-safe-bounds` at `e9f780e` (code candidate `e0c9430`) | The sole fresh verifier returned FAIL/MEDIUM because the frozen register did not carry admissible packed P08/P05 end-to-end evidence. The request allows a second review only after a new BLOCKER/HIGH. Code was not integrated. |

G-91 secure-DNS egress and G-94 WebSocket/WebRTC/WebTransport egress remain open and documented. No current-Chrome CI net-log proof for a fix was obtained, so no security claim was upgraded. P4 was not attempted while the release blocker remained. The explicitly excluded G-11, G-19–G-25 and G-58 remain outside this release; `calibrated: false` remains in place.

## 3. Real-document blocker

The requested `02_Products/Digital_Products/08_autonomous-agent-team/build/print.html` (175 pages) was absent at the time of measurement. The generated scratch copy `/tmp/breaklint-p0-artifacts/p08/build/print.html` has **207 pages**. The P05 scratch copy has **77 pages**. These are different from the specified P08 acceptance bytes, and this handoff does not substitute one for the other.

The G-113 isolated packed run on the 207-page copy completed in 104.79 s, peaked at 1,988,788,224 bytes RSS on this 16 GiB Mac, and bound 207/207 pages; the overall verdict was **exit 4** because G-114 left 98 of 472 stroked SVG text candidates unmeasured under the 100% rule floor. P05 completed in about 28 s, with roughly 1.5–1.65 GB peak RSS. The configurable default is 600,000 ms, valid bounds are 30,000–1,800,000 ms, and invalid values use exit 2. The 207-page observation has ample time and memory margin, but it does **not** pass the user's P08 exit-0/1 criterion. The G-114 branch's separate packed P08 run measured all 472 candidates, but its code is not part of the integration branch and its sole review failed on the evidence record.

To resume the release, use the actual 175-page `print.html` from the requested product path, install an integration tarball in a foreign directory, and record both P08 and P05 exit status, pages, time and peak RSS. A P08 exit 3 or 4 stops release preparation. A passing measurement still requires the independent P0 review and the release gates below.

## 4. Release steps still required

Follow `docs/releasing.md` in order. Prepare version 0.8.0 in `package.json` and both lockfile root fields, the `v0.8.0` tag trigger, `## 0.8.0 — TBD-at-tag`, the v0.8.0 poster URL, package dry-run review and truthful status marker. Run a fresh independent release audit, repair documentation findings, then open and merge the preparation PR after green CI and run the exact local gate on its merge commit.

The changed `src/` files are within `REVIEW_INPUT_ROOTS`. After the preparation merge, **stop for the Founder's real report-surface review** under `docs/reporting.md`. Only the literal judgment from the current chat may be entered into the ledger. A FAIL is recorded as FAIL and stops the release. If it passes, commit the ledger with the `<!-- review-state -->` sentences, wait for green CI, make the date-only changelog commit, wait for green CI on that exact commit, then set and push the annotated tag. Never move or reuse the tag. After tagging, verify release run, both clean consumers, npm integrity, tarball SHA-256, provenance, poster URL and Action reference; a failure stops without deleting or retagging.

## 5. Other downstream work

The DE/EN website draft is on local branch `prog/breaklint-080-site-20260928` in a separate site worktree, commit `280e6e0`. Its local declared gate passed. It must await real 0.8.0 release facts, the final copy check, both required PR gates and a merge to deploy. Site PR #47 is untouched. Studio and DS_OS consumers remain on their existing versions until npm 0.8.0 is verified. The workspace release note and memory update also remain to be written from final measurements.
