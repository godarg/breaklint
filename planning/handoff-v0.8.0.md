# Handoff — breaklint 0.8.0

Status measured 2026-09-28: **v0.8.0 published on GitHub and npm; website merged and live in DE/EN**. The annotated tag resolves to `e3a3fd986168f43e0b017d4b7db626dcab14eba3`; release run [36472842589](https://github.com/godarg/breaklint/actions/runs/36472842589) completed successfully. This is a dated handoff, not a volatile-state source: use the live commands in §4 to check a later state.

## 1. Integrated work

The integration branch starts at `10765b4` and uses `--no-ff` package merges. `planning/open-work.md` carries the per-item disposition and evidence pointers.

| Package | G-IDs | Code commit / integration merge | Independent review and controls |
|---|---|---|---|
| P2 content and inherited flags | G-85, G-89, G-92, G-103 | `744dab7` / `078536a` | Fresh verifier PASS; real red-to-green content and launch controls. `SECURITY.md` and `docs/limitations.md` changed with the code. |
| G-112 SVG occurrence identity | G-112 | `6979782` / `dbfccaf` | Fresh verifier PASS; the duplicate-target control was red before the fix and green after it. |
| P0 configurable document budget | G-111 | `7b5e2b4`, `188dc20` / `fbf0a7f` | Real red control for the 120 s budget and green unit/config controls. Current source-bound P08 and P05 foreign-tarball acceptance is recorded in §3; the original 175-page bytes are absent. Fresh independent P0 review PASS on the integrated current-product acceptance. |
| P1 Mac gates | G-108, G-109, G-110 | `aac36c5`, `92d1cc9` / `a2e7739` | Mac red-to-green controls; first fresh review found a MEDIUM PATH probe mismatch, corrected in `92d1cc9`; targeted gates and typecheck green. The request permits a second round only for a new BLOCKER/HIGH, so no second round was run. |
| G-113 physical evidence binding | G-113 | `66b438d`, `1c3220c` / `2eaec13` | First verifier found HIGH SID-wide deletion; the repair passed a fresh second review without new BLOCKER/HIGH. Colliding-SID footnote control red before and green after. Isolated P08 generated artifact bound 207/207 pages with raster diff 0. |
| G-114 SVG painted bounds and G-117 descendant paint | G-114, G-117 | `8b7c526`, `adfa124` / `297b0fa` | Two real Chrome red-to-green controls. The first fresh verifier found HIGH G-117; the repair passed the permitted second review with no findings. Formal `engineering-verification` gate PASS on `beb3985`; packed foreign-CWD current P08/P05 acceptance in §3. |
| Live gate count and drift fixture | G-115, G-116 | `caef40a` / `292b390` | Fresh independent @Prog verifier PASS with no findings. The real red gate first expected 1 instead of 2 overlay leaves; two more runs exposed the control-page drift and a diagnostic run exposed a null access in the initial fixture repair. The final unchanged Freeze assertion passed in `render-run` 35/35, full Node 24 live 107/107, `npm test` 839/839, typecheck 0. |

The integration-only test pin correction is `c9e5dfa`: a real red `npm test` run (837/839) was corrected to 839/839 before G-113 was merged. The `docs/status.md` marker now records 677 unit tests, 839 aggregate tests and 107 live tests, measured in the G-115/G-116 worktree; `npm run test:documented-figures` passed on the integration worktree using those generated measurement files, whose source code is byte-identical after the no-ff merge. The ordered 19-command local release gate passed on the PR #33 merge commit and again on the ledger merge commit; exact GitHub CI passed on both. The integrated G-114/G-117 package has two real red-to-green Chrome controls, `npm test` 839/839, full live 107/107 and typecheck green on its frozen branch.

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

Before each load, `pgrep -fl breaklint-chrome-profile` found no orphan Chrome. The return code was read immediately after each command, without a pipe. `pdfinfo` independently counted 207 and 77 pages in the checked PDFs. The 600,000 ms default has 82.6% observed time reserve against current P08 on this Mac; the peak is below 2.0 GB on a 16 GiB system. This supports the document-budget setting for these current inputs, while larger or heavier files remain a memory limitation. The repaired G-114/G-117 package passed its permitted second independent @Prog review and was integrated at `297b0fa`.

## 4. Ordered release and identity evidence

1. Release preparation PR #33 merged as `33d78b9bc920354442051e205cdf1f5ad02ae609`. The preparation checks, including version/lock/trigger alignment, dated-at-tag placeholder, poster pin and `npm pack --dry-run` exclusion of `planning/`, `tests/` and `action/`, were reviewed independently. Exact `main` CI [36458883954](https://github.com/godarg/breaklint/actions/runs/36458883954) and the ordered local gate passed on that merge commit.
2. The Founder reported in the current chat, verbatim: “Haben die Sichtprüfung durchgeführt und keine Anmerkungen. Alles passt”. Ledger round 4 records this positive human judgment for 32/32 cells on the exact PR #33 render, with 152 screen tiles, four PDFs and 27 page rasters. The three known residuals remain named there. No AI review substitutes for that judgment.
3. Ledger PR #35 merged as `6ac2e2e0ae2479cfbe3bab1b290b1f3695dbe3c0`. Exact CI [36467854886](https://github.com/godarg/breaklint/actions/runs/36467854886) passed. All 19 ordered local gate commands passed on this merge commit, as did the packed foreign-CWD consumer; `WI-20260928-breaklint-080-human-ledger/merge-commit-local-gate.json` binds the outputs. No `REVIEW_INPUT_ROOTS` path changed after the Founder's render.
4. Date-only PR #36 changed only the `CHANGELOG.md` heading to `2026-09-28` and merged as `e3a3fd986168f43e0b017d4b7db626dcab14eba3`. Exact CI [36471159267](https://github.com/godarg/breaklint/actions/runs/36471159267) passed. The annotated `v0.8.0` tag was created and pushed once on that commit; tag object `e0795ab7ecbb7afb8d6cf0f5f157db807a4a62c1` peels to `e3a3fd9`.
5. Release run [36472842589](https://github.com/godarg/breaklint/actions/runs/36472842589) passed all four jobs: validate/pack, two clean consumers (Node 24 and 22.13.0), and publish plus GitHub Release. The workflow was the only npm publisher. No tag was moved and no local `npm publish` was used.

Independent after-tag checks, measured 2026-09-28:

| Check | Result |
|---|---|
| npm registry | `breaklint@0.8.0` available; `dist.integrity` = `sha512-ognSD5165I6ryYbNfFqdtfJicA0/KPDki/XKvAJJoTkw74k/Sbik1hO78hQaxjMIm26on3ASHXtCqleJ4yK0uQ==` |
| Tarball identity | npm tarball and GitHub Release asset are byte-identical; SHA-256 `ee339c09815f7ed8bf99d3bac7dc6b053026eb5004d03d8d69e60258f941f335` |
| Provenance | npm SLSA v1 attestation present; `tests/tools/registry-provenance-contract.mjs --verify` bound package digest and Git commit `e3a3fd9`; `npm audit signatures` reported zero invalid or missing entries |
| Fresh foreign install | version 0.8.0; demo returned expected exit 1 with real findings; installed Configuration Contract v1 passed with 53 sourced leaves and four fail-closed controls |
| README poster | `https://raw.githubusercontent.com/godarg/breaklint/v0.8.0/assets/breaklint-film-poster.jpg` returned HTTP 200, JPEG 1920×1080 |
| Public Action ref | Real Ubuntu PR run [36475794152](https://github.com/godarg/breaklint/actions/runs/36475794152) called `uses: godarg/breaklint@v0.8.0`; clean four-page fixture exited 0 and output package version 0.8.0. The one-run workflow was removed in a later branch commit, so it is not in the final register diff. |

Read-only recheck commands: `git ls-remote --tags origin 'refs/tags/v0.8.0*'`; `gh run view 36472842589 --json headSha,status,conclusion,jobs`; `npm view breaklint@0.8.0 version dist.integrity dist.attestations --json`; `gh release view v0.8.0 --json assets`; `curl -I` the pinned poster URL. The signed provenance binds the npm bytes to the tag commit; npm `gitHead` is not the source identity for this publish route.

## 5. Website and consumers

Site PR [#48](https://github.com/godarg/dargel-solutions-site/pull/48) merged as `eb135d3fcf478db39a51acca1114c5ad191409eb` after npm verification. Its final head `007835c` passed both required PR gates; @Brand approved the DE/EN G-114 wording and an independent @Prog verifier found no BLOCKER/HIGH/MEDIUM. The new G-122 site-truth finding and the earlier G-118–G-121 fixes are in `planning/open-work.md`. Site PR #47 was not edited. Both Site `main` checks on the merge commit completed successfully: Gate run 36476171342 and Portfolio refresh gate run 36476171470 (`gh run view`, measured 2026-09-28).

Live `curl` on 2026-09-28 returned HTTP 200 for `https://dargel-solutions.de/breaklint/` and `/en/breaklint/`. Both pages contain the exact 0.8.0 version line, the narrow SVG viewport-edge caveat, and `og:image` ending `breaklint-card.png?v=0.8.0`; neither response contains Cloudflare email-obfuscation markers. Response-body SHA-256: DE `045590e4a34bd3f670602f51a577a24f2a487c6e192a2c8b0d99aa12189c620e`, EN `75ab85e268ec60e77e5e5a37b5909d5ceef223bea26e3d0bbd950ccace4bc7f9`.

Studio at `~/.local/share/dargel/breaklint-studio` is pinned to registry `breaklint: 0.8.0` in manifest and lockfile; installed CLI returns 0.8.0 and demo returns the expected finding exit 1. The exact old manifest remains at `package.json.pre-breaklint-0.8.0.20260928.bak` (SHA-256 `a2d30c89c9050284a77a3ad66645a5695b08a71ab5a0321ec35e8a6c0d2dbd42`). DS_OS frontend is pinned to exact Registry 0.8.0 in local commit `20dbd968925374ff1a85eb28a36a4fa85d8a9bc2`; typecheck, tests, build and the post-build consumer E2E passed (46 passed, four viewport-independent skips). The first E2E run exposed an old `publications-error` Playwright mock that missed the query-bearing URL before breaklint ran. Its matcher now selects the exact pathname; the visible-error assertion was not relaxed. The old matcher was re-run red (exit 1), the final matcher green (exit 0), and a fresh build-verified full run passed. No DS_OS push or deployment was performed. Independent formal DS_OS verification remains pending until its report is recorded.

## 6. Boundaries and retained work

G-91 (browser-owned DoH egress) and G-94 (WebSocket/WebRTC/WebTransport egress) remain open because no current-Chrome CI net-log proof for a fix was obtained. L1 (G-86/88/96/101), F5 (G-78/79/100), and C1/C2/K2 (G-23/93/95/106) remain **herausgefallen** with their branches and review findings in §2 and the register. P4 was not attempted. G-18 memory was measured, not optimised. G-11, G-19/G-20/G-24, G-21/G-22/G-25, G-58 and Windows stay outside this release; `calibrated: false` remains.

A post-tag rerun of the ledger work item's local gate at the historical ledger merge commit `6ac2e2e` fails its release-tag contract because `v0.8.0` now exists on the later date commit; rerunning at `e3a3fd9` changes the work item's `CHANGELOG.md` scope fingerprint and requires a new verifier. The historical 19-command local gate and exact GitHub CI on `6ac2e2e` are preserved with hashes. This is a formal post-tag artifact limitation, not a change to the successful release workflow. Do not alter the tag or relax the gate to make a replay green.

Retain all remote branches. Relevant product branches include `claude/integrate-breaklint-080`, `claude/wp-g114-current-p08-080`, `claude/wp-g114-svg-safe-bounds`, `claude/wp-l1-080`, `prog/p3-f5-disposition-20260928`, `prog/p3-c1c2-k2-disposition-20260928`, `claude/wp-g118-g119-site-disposition` and `claude/wp-g118-g121-site-followup`; relevant Site branches include `prog/breaklint-080-site-20260928`, `prog/breaklint-080-site-followup-20260928` and `prog/breaklint-080-site-precision-20260928`. Tip hashes and any further branches should be measured with `git ls-remote --heads`, not inferred from this list. No remote branch or tag was deleted.
