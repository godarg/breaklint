# Handoff — breaklint 0.7.0

Status: **release-prepared; not yet tagged.** The owner still has two things to do: merge the
integration PR, and have a rostered human carry out a genuine report-surface review. Nothing has
been published, tagged, or merged to `main` from this session.

- Integration branch: `claude/inspiring-archimedes-x2xq5t`.
- Integration PR: godarg/breaklint#18. It is not merged.
- Author on record: `package.json` has `"author": "Gottlieb Dargel"`, and `LICENSE` reads
  "Copyright (c) 2026 Gottlieb Dargel". Every commit is authored as `godarg`.

## 1. In 0.7.0

Each package was merged with `--no-ff`. The merge message records how it was verified.

| package | register items | independent verification | integration merge |
|---|---|---|---|
| WP-D1 docs truth, release plumbing | G-30 G-40 G-42–G-46 G-52 G-55 G-56 G-67 G-68 | 3 rounds PASS, then an orchestrator delta check | ebf1c91 |
| WP-K3 advice precedence, widows/orphans pin | G-27 G-28 | 2 rounds PASS; CI probe green on Chrome 153 | 2cae038 |
| WP-E1 GitHub Action, CI recipe, SARIF/JUnit/Markdown | pipeline | PASS; CI probe green (all Action arms) | 9c97c0d |
| WP-F1 margin-box content leaves flow membership | G-02 G-04 G-06 G-69 G-71 G-72 | FAIL → PASS → PASS; CI probe green with evidence binding | d0623d1 |
| WP-F4 fill rules judge only pages that end early | G-14 G-15 | 4 rounds PASS | 8c3e4fd |
| WP-F1b Snapshot 5 (`display`, `marginCopies`) | F1 follow-ups | PASS; CI probe green | 2a7ba4c |
| WP-B1 named-page break cause | G-99 G-107 | final round PASS with one medium (a deep-cloned forcing element gave a false forced break), fixed in 0c24a32; orchestrator delta check 36/36, and the mutation turns 1 test red | 2336a4b |
| G-01 / G-77 output drain (extracted from WP-C1) | G-01 G-77 | orchestrator check: piped output 84578 B equals the `--out` size; `head -c 100` gives exit 3 | d7c477d |
| WP-R2 wrapper widows/orphans, natural space | G-82 G-83 G-104 G-105 | final round PASS with two mediums, documented in `docs/limitations.md` (RTL sampler; an unrecorded inline-block that contains a block can give a false orphan) | a1a72b9 |
| WP-R1 report surfaces | G-31–G-39 | final round PASS; micro-round db187c9 (print caption gap, header-rule count control, future-time rejection) | c1e220c |
| Release preparation | — | independent release audit (§3) | f1dc9f2 |

- **Schema stamps:** Report 5 (unchanged); **Snapshot 5** (moved once, by WP-F1b, with migration
  and an engine gate); context pack 2; Configuration Contract 1.
- **CI:**
  - run 36118067384 is green on the R2 merge;
  - run 36122707882 is green on the release-prep head: 830/830 tests and 106/106 live.
  - The run on the head carrying the audit fixes is recorded in the PR #18 description.
- **Release prep (86b1304):**
  - `package.json` and both root fields of `package-lock.json` are at 0.7.0;
  - the `release.yml` tag trigger is `v0.7.0`;
  - CHANGELOG has `## 0.7.0 — TBD-at-tag`;
  - the status.md release record makes no publication claim;
  - the README poster is pinned to `https://raw.githubusercontent.com/godarg/breaklint/v0.7.0/assets/breaklint-film-poster.jpg`;
  - `npm pack --dry-run` lists 190 files. It was reviewed: no `planning/`, `tests/`, `action/` or corpus work files ship.

## 2. Not in 0.7.0

Each of these packages got one final round with a hard exit: any new blocker or high defect
dropped the package. The branches are pushed and intact.

| package | branch (`claude/…`) | tip | why it was dropped |
|---|---|---|---|
| WP-F5 footnotes, blank pages | wp-f5-real-documents | 92a7d3a | a footnote clipped at `.pagedjs_footnote_content` still binds its page |
| WP-X cross-check, multicol, residue | wp-x-geometry | 8dbcea1 | `selfcheck` red; the clip exemption can still be bypassed |
| WP-L1 local-uri absolute paths | wp-l1-local-uri | 992177a | an escaped `@import` gives a silent clean |
| WP-C1 + WP-C2 floor, lifecycle, egress | wp-c1-output-floor, wp-c2-lifecycle | ea3f60a, 73562e2 | Chrome 153 still connects to `[2001:4860:4860::8888]:443` in offline mode |
| WP-S1 (+ S2) SVG local viewport | wp-s1-svg-viewport, wp-s2-svg-bracket | 76f0728, 18e81e4 | Chrome 153 reports nested SVG sizes as `auto`; a `startsWith` spoof; false errors under zoom |
| WP-F3 split-block lower bound | wp-f3-fragment-bound | bb33a6a | self-application ends exit 4; false error on `min-content` |
| WP-K1 + WP-K2 corpus and closed-world gate | wp-k1-corpus, wp-k2-corpus-gate | 6ffba2a, 3c10784 | the gate cannot pass without F5 and L1; it was not weakened |

**Known defects that ship in 0.7.0.** Each is disclosed in `docs/limitations.md` and `SECURITY.md`,
or in the register.

- **Network (G-80, G-91, G-94):**
  - the offline mode blocks page requests, but not browser-level egress (secure DNS, the component updater);
  - `--allow-network` does not limit WebSocket, WebRTC or WebTransport.
- **Sandbox environment (G-85, G-92):** these variables disable Chrome's sandbox:
  - `PUPPETEER_DANGEROUS_NO_SANDBOX`;
  - `PUPPETEER_TEST_EXPERIMENTAL_CHROME_FEATURES`;
  - an inherited `CHROME_EXTRA_FLAGS`.
- **Footnotes and blank pages (G-79, G-78):** documents with footnotes can end exit 3.
- **Silent content loss:**
  - G-103: `body { column-count: 1 }` loses content;
  - G-89: a `display: contents` heading split across a page loses its continuation.

## 3. Release audit

- **Audit:** an independent audit by a fresh AI verifier at f1dc9f2.
- **Verdict: NOT READY, for documentation only.** Mechanics, package contents, schema honesty,
  gates and CI all passed.
- **Findings:**
  - H1: network-blocking overclaim;
  - H2: sandbox overclaim;
  - M1: `docs/releasing.md` pre-tag steps lack the human review, and still offer to drop the gate;
  - M2: sentences that become false after the review;
  - M3: G-103 and G-89 were not disclosed;
  - L1–L4, L6, L7: wording, citations, the poster mention, and the stale PR description.
- **Fix:** docs-only, on branch `wp/release-docs`, merged into the integration branch. The merge
  commit is named in the PR #18 description. No gate, ledger or `REVIEW_INPUT_ROOTS` entry was touched.

Every verifier this cycle was an AI agent. No human has looked at any of it, and nothing here
claims otherwise.

## 4. Owner steps before the tag

1. Merge PR #18 into `main`. Do not force-push or rewrite history.
2. A rostered human (`docs/reporting.md`, the review package, steps 1–4) reviews the report
   surfaces on that exact commit.
3. Commit the review ledger. In the same commit, update the sentences that `docs/reporting.md`
   lists as becoming false after the review.
4. Confirm CI is green on `main`.
5. Make a date-only commit: `## 0.7.0 — TBD-at-tag` becomes `## 0.7.0 — <ISO date>`.
6. Confirm CI is green on exactly that commit.
7. Create and push the annotated tag:
   `git tag -a v0.7.0 -m "breaklint 0.7.0" <that commit>` and then `git push origin v0.7.0`.
   The release workflow publishes and verifies.

**Residual, by owner decision.** The review ledger names a rostered handle. Nothing
cryptographically binds that handle to the person who actually reviewed: there is no signature and
no required review. Any committer could write it. This is documented and accepted.

## 5. Post-release checks

- `npm view breaklint@0.7.0 dist.integrity` equals the checksum on the GitHub Release.
- Both clean-consumer jobs in the release workflow are green.
- The README poster URL resolves at `v0.7.0`.
- `uses: godarg/breaklint@v0.7.0` works only after the npm publish (`docs/ci-recipe.md`).

## 6. Website facts (valid once the tag is published)

- breaklint 0.7.0, MIT licence, author Gottlieb Dargel.
- Requires Node ≥ 22.13. Paginator: Paged.js 0.4.3 in headless Chrome.
- Report schema 5, Snapshot 5, Configuration Contract 1.
- 13 rules. The two proof-source-A error rules have fixed thresholds.
- Exit codes: 0 clean, 1 findings, 2 usage, 3 infrastructure, 4 insufficient coverage.
- New in 0.7.0:
  - a GitHub Action and a CI recipe;
  - SARIF, JUnit and Markdown reporters;
  - pipe-safe output;
  - named-page break causes;
  - margin-box content is no longer counted as body flow.
- Caveats to state honestly:
  - offline mode does not block browser-level egress;
  - sandbox-disabling environment variables are honoured;
  - footnotes and multicol bodies can fail;
  - the report surfaces were reviewed by a human only if step 2 of §4 took place.

## 7. Not done

- Dropped packages (§2): F5, X, L1, C1+C2, S1+S2, F3, K1+K2.
- Not attempted:
  - G-05 and G-60 (WP-F2);
  - G-70 (WP-P1);
  - G-16 and G-17 (docs);
  - G-18 (streaming rasteriser);
  - G-26 (remedy proofs);
  - G-53 (`--bundle`);
  - G-54 (container recipe).
- Open register items: G-84, G-86, G-88, G-89, G-91–G-98, G-100–G-103, G-106 (`planning/open-work.md`).
  Where the register's status column predates the final round, the tables in §1 and §2 of this
  handoff take precedence.
- Housekeeping for the owner:
  - The remote probe branches `claude/ci-probe-*` (closed PRs #19–#32) can be deleted. The session's
    delete was refused (HTTP 403 through the git proxy).
  - Once they are no longer needed, the dropped-package branches listed in §2 can be deleted as well.
