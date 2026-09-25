# Handoff — breaklint 0.7.0 cycle

Status: **DRAFT, not ready to tag.** This file records where the 0.7.0 cycle stands, what was
proven and by whom, and which decisions the owner has to take before release preparation can
finish. Nothing has been published, tagged, or merged to `main` from this session.

## 1. Where things are

- Integration branch: `claude/inspiring-archimedes-x2xq5t`.
- Integration PR: godarg/breaklint#18 (draft, not merged).
- `package.json` is still `0.6.0`. No version bump, release-workflow pin, dated CHANGELOG heading
  or README poster pin has been made. See §6 for why.

### Integrated work packages (each merged with `--no-ff`; the merge message records the verification)

| package | register items | independent verification | integration merge | CI on the integration head |
|---|---|---|---|---|
| WP-D1 docs truth, release plumbing | G-30 G-40 G-42–G-46 G-52 G-55 G-56 G-67 G-68 | 3 rounds PASS, then an orchestrator delta check | ebf1c91 | run 36077869324 green |
| WP-K3 advice precedence, widows/orphans pin | G-27 G-28 | 2 rounds PASS, then an orchestrator delta check; CI probe #21 green on Chrome 153 | 2cae038 | green |
| WP-E1 GitHub Action, CI recipe, SARIF/JUnit/Markdown | pipeline | PASS; CI probe #22 green (all Action arms); micro-round checked by the orchestrator | 9c97c0d | run 36091216378 green |
| WP-F1 margin-box content leaves flow membership | G-02 G-04 G-06 G-69 G-71 G-72 | 32c2272 FAIL → eee9f06 PASS → 3380781 PASS; CI probe #20 green with evidence binding | d0623d1 | green |
| WP-F4 fill rules judge only pages that end early | G-14 G-15 | 4 rounds PASS, the last with a medium fixed and checked by the orchestrator | 8c3e4fd | run 36094144890 green |
| WP-F1b Snapshot 5 (`display`, `marginCopies`), judge what printed | F1 follow-ups | 75f596d PASS; CI probe #29 green; micro-round e20bed8 checked by the orchestrator | 2a7ba4c | run 36100693632 green |

Schema stamps on the integration head: Report 5 (unchanged), **Snapshot 5** (moved once, by
WP-F1b, with migration and an engine gate), context pack 2, Configuration Contract 1.

### Work packages stopped under the brief's stop condition

The condition: two consecutive verifier rounds, each finding new blocker or high defects. None of
these packages is merged. Each branch and worktree is intact. The owner decides whether each gets
one final round.

| package | register items | last frozen commit | why it stopped (last round) |
|---|---|---|---|
| WP-S1 SVG local viewport (+ WP-S2 bracket on top) | G-10 G-62 G-63 G-73–G-76 (G-09 G-61 G-66) | 2ea9801 (S2: 18e81e4) | CI red on nested SVGs (Chrome 153); outer-SVG clip is pixel-snapped; shadow-DOM and `-webkit-mask-box-image` clipping missed |
| WP-F3 split-block lower bound | G-03 G-07 G-08 G-81 | 8a374a2 | CI red; side-by-side inline-block columns and `::first-line` give false errors |
| WP-R1 report surfaces | G-31–G-39 | ed84d2c | CI red (`selfcheck:live` oversized-card control); phone overflow with real evidence names |
| WP-C1 + WP-C2 output drain, browser floor, lifecycle, egress | G-01 G-23 G-48–G-51 G-59 G-77 G-80 G-85 | 14d62d3 | Chrome 153 DNS-over-HTTPS bypasses the offline resolver lock; inherited `CHROME_EXTRA_FLAGS` reaches the browser |
| WP-F5 footnotes and blank pages | G-78 G-79 | dc664e3 | a footnote clipped at the footnote area's edge still binds its page |
| WP-L1 local-uri absolute paths | G-86 G-88 | 48efb2f | `@import` without whitespace escapes discovery and the new guard (pre-existing mechanism) |
| WP-X cross-check, multicol, residue | G-12 G-13 G-64 G-65 | 9750c5e | CI red (real-document manifest); clip exemption too broad; `body { column-count: 1 }` |

### Work packages still in flight when this draft was written

| package | register items | state |
|---|---|---|
| WP-R2 wrapper widows/orphans, natural space, inline hyphen | G-82 G-83 | round 2 (c502ead) under verification; CI probe #30 |
| WP-B1 named-page break cause | G-99 | round 1 (cae6d1a) under verification; CI probe #32 |
| WP-K1 + WP-K2 self-authored corpus and closed-world gate | G-29 | corpus reviewed (errata E1–E43); gate round 2 (0cbf466) under verification. Locally 15/20 documents pass; the 5 failures need WP-F5 (sa04, sa17) and WP-L1 (sa06, sa15, sa19) |

## 2. Decisions the owner has to take

1. **Stopped packages.** For S1, F3, R1, C1+C2, F5, L1 and X, choose one:
   - one final round with a hard exit, meaning any new blocker or high finding drops the package from 0.7.0 (recommended);
   - drop the package from 0.7.0 and document the gap;
   - a conservative decline-only variant.

   Each package's fix direction for its open findings is recorded in the verifier reports and
   summarised in the owner messages.
2. **Release-blocking items that are not fixed on the integration head:**
   - **G-01:** output through a pipe is silently truncated at 64 KiB. This is fixed only in the stopped WP-C1.
   - **G-31 / G-32:** report-surface blockers. The fix is in the stopped WP-R1, and a genuine review is still owed.
   - **G-79:** documents with footnotes end exit 3. The fix is in the stopped WP-F5.

   A 0.7.0 without these would still carry G-01, which is a silent wrong-output defect.
3. **Report-surface gate path** (open since the start): a human review of the prepared surfaces, an
   owner-approved relaxation, or a documented drop. The gate still requires a rostered human; it was not weakened.
4. **Human-review binding.** Any committer can write a rostered handle into the ledger, and nothing binds it to an authenticated act. The options are a signature (`ssh-keygen -Y verify` against committed `allowed_signers`) or a required approving review by a mapped login. Both touch keys or repository settings.
5. **Corpus gate before F5/L1.** WP-K2's CI job will be red until F5 and L1 land. It must not be weakened: no `continue-on-error`, no expected-failures list. So it can only be integrated after them, or with the owner's explicit call.
6. **Chrome for Testing download.** The request to download it, to run the live path locally, is still open. Local live work used patched Chromium 141, labelled as such everywhere; CI on Chrome 153 was the authority.

## 3. Verification record

Every package was verified by a fresh verifier that had not written the change, at a frozen
commit, with PASS/FAIL graded blocker/high/medium/low. Verifiers were AI agents. No human looked
at any of it, and nothing here claims one did. The orchestrator also ran its own delta checks on
the small final rounds, each with a mutation shown to go red. That is recorded in the merge
messages and in `planning/progress.md`.

The typography lens asked for in the brief was applied only by an agent, inside the WP-R1 round-2
verification, and it is labelled as agent judgement there. It found eight concrete defects: a
doubled header rule, the tail label on unsplit findings, an unbounded measure in remediation
boxes, "1 lines", "CANDI-/DATES", a runt line, an empty cloned frame, and phone density.

## 4. Gate numbers on the integration head

**Local** (unprivileged runner, Node 24, Chromium 141), at the last full run of each package merge:
- typecheck, schema:check, docs:rules:check and test:release-tag: rc 0.
- test:mutants: 13/13.
- npm test: all tests pass except the 9 known environment-bound failures (Chromium 141 live path, VM PID 1). Those 9 are green in CI.

**CI:** the check, action and node-floor jobs are green on every integration head listed in §1.
Exact test counts are in the machine-checked figures marker in `docs/status.md`, which CI's
`test:documented-figures` verifies.

## 5. Register status (G-01 … G-103)

- **Fixed and integrated:**
  - G-02, G-04, G-06, G-14, G-15, G-27, G-28, G-30, G-40, G-42–G-46, G-52, G-55, G-56, G-67, G-68, G-69, G-71, G-72 (via WP-D1, K3, F1, F4);
  - the pipeline work of WP-E1;
  - G-87 (resolved: corpus erratum E42 plus G-99) and G-90 (test hardened in WP-F1b).
- **Fixed but not integrated (stopped packages):** G-01, G-03, G-07, G-08, G-09, G-10, G-12, G-13, G-23, G-31–G-39, G-48–G-51, G-59, G-61–G-66, G-73–G-81, G-85, G-86, G-88 (each only partly, as the stop reasons in §1 say).
- **In flight:** G-29 (corpus and gate), G-82, G-83 (WP-R2), G-99 (WP-B1).
- **Open, found late, not yet fixed:** G-89, G-91–G-98, G-100–G-103 (see `planning/open-work.md`).
- **Not attempted this cycle:**
  - G-05 and G-60 (WP-F2, `--no-source-map` join);
  - G-70 (WP-P1, `Function.prototype.call` hardening);
  - G-16, G-17 (docs);
  - G-18 (streaming rasteriser);
  - G-26 (remedy proofs);
  - G-53 (`--bundle`);
  - G-54 (container recipe).
- **Out of scope or parked by decision:** G-11 (M3 research), G-19–G-22, G-24 (multi-OS), G-25 (calibration parked), G-58 (record only).
- **Already fixed on main before this cycle:** G-41, G-47 (G-47 is still to be verified at publish).

## 6. Release preparation: not started, deliberately

The brief's release prep has not been done yet:
- the version bump to 0.7.0;
- the `release.yml` pin and tarball;
- the CHANGELOG `TBD-at-tag` heading;
- the status.md record;
- pinning the README poster URL to `v0.7.0`;
- the `npm pack --dry-run` review;
- an independent release audit.

The reason is that the release's content depends on decision 1 and the blockers in decision 2. A
release prepared now would be re-prepared after those decisions. Once they are taken, the sequence is:

1. Integrate whatever is decided, and re-run CI.
2. Release-prep commit on the integration branch: the version in `package.json` and both root fields of `package-lock.json`, the `release.yml` tag trigger, `## 0.7.0 — TBD-at-tag`, the status.md release record without a publication claim, and the README poster URL pinned to `https://raw.githubusercontent.com/godarg/breaklint/v0.7.0/assets/breaklint-film-poster.jpg`. `npm run test:release-tag` must pass in release-prep mode.
3. Review `npm pack --dry-run`: `planning/`, `corpus/` work files, `action/` and `tests/` must not ship.
4. An independent release audit by a fresh verifier.
5. Owner: merge PR #18 to `main` (no force-push, no history rewrite).
6. A final commit on `main` that dates the heading (`## 0.7.0 — <ISO date>`). CI must be green on that exact commit.
7. Owner: `git tag -a v0.7.0 -m "breaklint 0.7.0" <that commit>`, then `git push origin v0.7.0`. The release workflow publishes and verifies.
8. Post-release checks: `npm view breaklint@0.7.0 dist.integrity` equals the GitHub Release checksum; both clean consumers are green; the README poster URL resolves; the GitHub Action works at `@v0.7.0` only after the npm publish (docs/ci-recipe.md).

## 7. Website facts

To be filled at release time from the release record. Until then, every public fact stays at 0.6.0.

## 8. Housekeeping left for the owner

- Probe branches `claude/ci-probe-*` on the remote belong to closed probe PRs #19–#32. They can be deleted; an earlier attempt to delete one through the git proxy failed.
- Local worktrees of the stopped packages are kept, so that a final round can resume without rework.
