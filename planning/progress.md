# Progress log — breaklint 0.7.0 cycle

A running log of what was done, the evidence, the numbers and the open points. Newest entries are
at the bottom. Every exit code here was read directly after its command, never behind a pipe.

## 2026-09-24 — setup and baseline (`db0e4c0`)

Environment: Linux x86_64 VM, kernel 6.18, 4 vCPU, 15 GiB RAM. Node 24.21.0 and 22.13.0 via nvm.
gitleaks 8.30.1, installed exactly as `ci.yml` does (checksum verified). poppler 24.02, fontTools
4.66. The only browser is Chromium 141.0.7390.37 (Playwright build). Downloading another browser
was not permitted.

Chrome refuses to start as root unless its sandbox is disabled, and breaklint has no flag for that.
All browser work therefore runs as an unprivileged user, with the sandbox on, against an
rsync mirror of the tree. Test repositories use a CI-like git identity without commit signing.

Baseline on the unprivileged runner (Node 24, Chromium 141):

| gate | rc | numbers |
|---|---|---|
| `npm run typecheck` | 0 | |
| `npm run schema:check` | 0 | |
| `npm run docs:rules:check` | 0 | |
| `npm test` | 1 | 571 tests, 562 pass, 9 fail, 60.9 s. All 9 are environment-bound (Chromium 141 live path; process-group cleanup under this VM's PID 1). Green in CI. |
| `npm run test:mutants` | 0 | 13/13 rules killed every mutant |
| `npm run test:licenses` | 0 | |
| `npm run test:secrets` | 0 | |
| `npm run test:advisories` | 0 | as root; needs the registry and the session proxy CA |
| `npm run test:release-tag` | 0 | |
| `npm run build` | 0 | |
| `npm run selfcheck:static` | 0 | |
| `npm run test:report-surfaces:technical` | 1 | renders all 32 cells, then the verifier rejects the browser string "Chromium 141…" (`verify-report-surfaces.mjs:429`). With that regex patched locally: 32/32 cells, 71 artifacts pass. |
| live path (`test:live`, `test:real-document`, `selfcheck:live`) | n/a | cannot complete on Chromium 141 (G-59); CI is the authority |

CI on `main` `db0e4c0`: run 36042721454, green in about 8.5 min.

G-01 reproduced on Linux before triage:
- `--demo --format json | cat | wc -c` gives 65 536 bytes; `--out` gives 82 585.
- Node 22.13 gives the same 65 536.

## 2026-09-24 — triage

Six triage agents, T1–T6. The result is in `planning/open-work.md`:
- 58 register items: 0 refuted outright, 13 worse than registered, 6 changed, 2 partial,
  4 fixed on main;
- G-59 raised during setup;
- 9 new defects, G-60 … G-68.

Four of the new defects give wrong verdicts from the default-gating error rules: G-61, G-62, G-63
and G-04.

Two local instruments make the rules measurable on Chromium 141 without touching the tree:
- near-live: the real in-page apparatus plus the Node engine;
- patched-live: the real CLI with two uncommitted shims and `--no-evidence-binding`.

Their results are labelled as such and confirmed in CI.

## 2026-09-24 — integration base

- `bb76dba` opens `## Unreleased` in CHANGELOG.md. It covers the two post-tag `src` changes
  (e46a1bf, 6af6008) and the G-56 documentation (G-40).
- Draft PR godarg/breaklint#18 was opened from `claude/inspiring-archimedes-x2xq5t`. CI run
  36061832825 on `bb76dba`: check and node-floor both green.

## Wave 1 — started

Implementers are running in parallel, each in its own worktree and on a local branch, with disjoint
file ownership:

| package | items |
|---|---|
| WP-F1 | G-06, G-04, G-02 |
| WP-F4 | G-15, G-14 |
| WP-S1 | G-10, G-62, G-63; Snapshot 4 → 5 |
| WP-C1 | G-01, G-59, G-48 |
| WP-C2 | G-23, G-50, G-51, G-49 |
| WP-R1 | report surfaces, G-31a … G-32 |
| WP-D1 | docs truth and release plumbing |
| WP-K1 | self-authored corpus; ground truth written before any tool run |

Orchestrator decisions taken so far, each recorded so the owner can overturn it:
- **G-01, EPIPE:** a reader that closes early makes the run end with exit 3 (infrastructure: the
  report could not be delivered), never 0 or 1.
- **G-37:** fork the report's design-token namespace to a breaklint prefix. The parent token set
  needed to realign is not available.
- **G-35:** a declared system-font strategy whose display and body roles use different generic
  families, checked against the declaration. No bundled font, no new dependency.
- **G-30:** the residue CI step may not exit 0 having read zero documents. It is retired unless
  WP-D1 finds a reason to keep it.
- **Windows:** support stays parked. An unsupported platform is refused before any browser starts.

## 2026-09-24/25 — wave 1 and 2: implementation and independent verification

Every package ran in its own worktree and on its own local branch. Each was then verified by a
fresh verifier that had not written the change, at a frozen commit. Verifier verdicts (B/H/M/L =
open blocker/high/medium/low at that round):

| package | items | rounds (frozen commit → verdict) | state |
|---|---|---|---|
| WP-D1 docs truth / release plumbing | G-30 G-40 G-42–G-46 G-52 G-55 G-56 G-67 G-68 | 820ac07 PASS (0/0/2/7) → a696126 PASS (0/0/2/4) → 2351cfc PASS (0/0/1/3) → 8dde9b4 orchestrator delta check (mutations red) | **integrated** (ebf1c91) |
| WP-F4 fill rules | G-15 G-14 | 5bd13fc PASS (0/0/1/3) → b92a309 PASS (0/0/2/4) → 1cb0b89 under verification | round 3 |
| WP-F1 margin boxes | G-06 G-04 G-02 (+G-69 G-71 G-72) | 32c2272 **FAIL** (1/1/2/3) → eee9f06 under verification; CI probe #20 green on current Chrome with evidence binding | round 2 |
| WP-C1 output drain / browser floor | G-01 G-59 G-48 (+G-77) | 0507b9f PASS (0/0/0/5; P-1 → G-70 registered) → 7868ef0 **FAIL** (0/1/0/3: CI red because Google Chrome 153 leaves component-updater temp dirs — a genuine leak caught by the new G-48 check; root cause assigned to WP-C2) | micro-round |
| WP-C2 process lifecycle | G-23 G-50 G-51 G-49a/b | 4bd1ca5 **FAIL** (0/1/1/3: a delivered signal can be dropped → exit 0) | round 2 (+G-80) |
| WP-S1 SVG viewport | G-10 G-62 G-63 | 0abb5e9 **FAIL** (0/2/3/4: nested svg overflow:auto false error; contain:paint false clean; style spoofing; rounding flush-label false errors) | round 2 |
| WP-F3 fragment lower bound | G-08 G-03 G-07 | cccd93d **FAIL** (2/1/1/3: multicol descendant and positioned child false errors; figure+caption silent false negative) | round 2 (redesign) |
| WP-R1 report surfaces | G-31a G-32–G-39 | e5b9fed **FAIL** (0/1/1/5: human-reviewer requirement self-declarable; fill metric counts the cloned frame) | round 2 |
| WP-K1 self-authored corpus | G-29 | ee6c16c FAIL (0/2/8/5 ground-truth errors) → c24b677 FAIL (0/1/3/4) | errata round 2 |
| WP-K3 advice precedence / widows probe | G-27 G-28 | b942f2b under verification; CI probe #21 | verifying |
| WP-S2 SVG bracket + ink bound | G-09 G-61 G-66 | implementing on S1 | — |
| WP-E1 CI recipe / Action / SARIF | pipeline | implementing | — |

CI probes (draft PRs, never merged):
- **#19 (C1).** The capability preflight passes on ubuntu-latest's Google Chrome 153: 595/595 tests.
  The job then went red on the leak described above.
- **#20 (F1 round 2).** Green, including the live suite with evidence binding on.

New register items found during this work are G-69 … G-84, listed in `planning/open-work.md`. The
highest-impact pre-existing ones:
- **G-71:** with default settings, every document with a running header, a `position: fixed`
  element or full-bleed content ended exit 4.
- **G-78:** blank parity pages never bind evidence, so exit 4.
- **G-79:** footnotes trip the injection-interference check, so exit 3.
- **G-70:** a document can redirect captured primitives by replacing `Function.prototype.call`.
- **G-80:** Chrome's component updater makes browser-level network requests during runs.

Governance event:
- WP-R1's follow-up was blocked by the session's permission system as weakening a gate. It would
  have let a review round made only by agents (honestly labelled as such) pass the local
  report-surface gate.
- It was not pursued, and the uncommitted diff was discarded.
- The gate keeps requiring a human reviewer (from a closed roster, after R1 round 2).
- The owner decides the next-tag path (§ handoff).

## 2026-09-25 — wave 2 continued

| package | rounds since the last entry | state |
|---|---|---|
| WP-K3 advice precedence | b942f2b PASS (0/0/1/2) → 5277280 PASS (0/0/3/3; allow-list guard) → 55b52a0 orchestrator delta check (registry 15/15; an added lowering sentence refused) | **integrated** (2cae038) |
| WP-E1 Action / CI recipe / SARIF | b3b75af PASS (0/0/2/4; CI probe #22 green, six Action arms on Chrome 153) → 73884e0 orchestrator delta check (marker-newline mutation red) | **integrated** (9c97c0d) |
| WP-F4 fill rules | 1cb0b89 PASS → 745180c PASS (0/0/1/3: the widened first-line window was unconditional → false negatives) → f2b79bd (window widened only for an inline SVG on the line) orchestrator delta check (18/18; SVG-top condition mutation red) | waits for WP-F1 |
| WP-F1 margin boxes | eee9f06 PASS → 3380781 (display:contents, integrity signatures) under verification; CI probe #20 reopened | round 3 |
| WP-S1 SVG viewport | 0abb5e9 FAIL → 2ea9801 **FAIL** (1/4/1/1: CI #23 red on nested SVGs; outer-SVG clip is pixel-snapped; shadow-DOM clipping and `-webkit-mask-box-image` missed; G-70 bypass) | **stopped** — two consecutive rounds with new blocker/high findings; owner decision requested |
| WP-S2 SVG bracket | dd821ee → rebased 18e81e4 on S1 round 2 | paused with S1 |
| WP-F3 split-block bound | cccd93d FAIL → 8a374a2 (content-extent lower bound, flow-hazard declines, inconclusive band; Snapshot 5) under verification; CI probe #24 | round 2 |
| WP-C1 + WP-C2 | C2 4bd1ca5 FAIL → b712dea (signal hold, library hosts, Chrome TMPDIR in profile, resolver lock, G-85, WebRTC) being merged with C1 ea3f60a and the integration head | round 2 |
| WP-K1 corpus | 9f55ead final pre-run review PASS (0/0/3/5) → e82315e errata E27–E35 | done; integrates with WP-K2 |
| WP-K2 corpus gate | implementing on e82315e | — |
| WP-F5 blank pages / footnotes | implementing on eee9f06 | — |
| WP-R1 report surfaces | f6af039 round 2 implementing | — |

New register items:
- **G-85:** puppeteer-core honours `PUPPETEER_DANGEROUS_NO_SANDBOX` and adds the sandbox-disabling switch, which contradicted SECURITY.md. It was found by the WP-C2 implementer; the fix is in WP-C2.
- **WebRTC:** a document's `RTCPeerConnection` sent STUN to a non-loopback address under the default offline launch. Closed in WP-C2 with a profile preference; the TURN-over-TCP case under `--allow-network` remains, documented.

Probe PRs #20 (reopened for F1 round 3), #21 and #22 were commented and closed without merging.

## 2026-09-25 — wave 3: integrations, stops, and new packages

Integration branch `claude/inspiring-archimedes-x2xq5t` (draft PR godarg/breaklint#18):

| head | adds | CI |
|---|---|---|
| 2cae038 | WP-K3 | green |
| 9c97c0d / 5a2aef0 | WP-E1 (+ progress log) | run 36091216378 green (check, action, node-floor) |
| d0623d1 | WP-F1 (3380781 + integration merge bfbeadb) | green |
| 8c3e4fd | WP-F4 (bce1e79) | run 36094144890 green |
| 2a7ba4c | WP-F1b (e20bed8; Snapshot 4 → 5) | run 36100693632 green |

Verdicts since the last entry (frozen commit → verdict, B/H/M/L open):

| package | rounds | state |
|---|---|---|
| WP-F1 | 3380781 PASS (0/0/2/5); CI #20 green incl. evidence binding | integrated |
| WP-F1b | 75f596d PASS (0/0/1/4; CI #29 green) → e20bed8 orchestrator delta check | integrated |
| WP-F4 | 745180c PASS → f2b79bd delta check → bce1e79 merge | integrated |
| WP-C1+C2 | 14d62d3 **FAIL** (0/2/3/3: Chrome 153 DoH egress past the resolver lock; inherited CHROME_EXTRA_FLAGS reaches the browser) | **stopped** (second consecutive FAIL with new high) |
| WP-F3 | 8a374a2 **FAIL** (1/2/4/3) | **stopped** |
| WP-R1 | ed84d2c **FAIL** (0/2/3/4) | **stopped** |
| WP-F5 | 1fa776a FAIL (1/1/3/4) → dc664e3 **FAIL** (0/1/0/4; CI #27 green, block-footnote pages bind; new: a footnote clipped at the area's bottom edge still binds) | **stopped** |
| WP-L1 | c5b3709 PASS (0/0/4/6) → 2352abf FAIL (0/1/1/4) → 48efb2f **FAIL** (0/1/1/4; `@import` without whitespace escapes discovery, pre-existing) | **stopped** |
| WP-X | 52e9446 FAIL (1/0/3/6) → 9750c5e **FAIL** (1/2/1/6) | **stopped** |
| WP-K2 | af300ec FAIL (0/2/2/4) → 0cbf466 under verification | 15/20 locally; the 5 failures need F5 and L1 |
| WP-R2 | 1ab49f7 FAIL (0/2/2/6) → c502ead under verification; CI #30 | round 2 |
| WP-B1 | G-99 named-page break cause | implementing |

Corpus errata E27–E43 were recorded by the corpus author from the reviewers' specification questions. None of them used breaklint output. E42 moved sa03's caption page from mustFire to mustNotFire, citing the rule page's definition.

Every stop above is the brief's stop condition ("two verifier rounds that keep finding new blocker/high defects"). Each was reported to the owner with a recommendation: one final round with a hard exit rule. New register items are G-85 … G-103; see scratchpad REGISTER-ADDENDUM, to be copied into open-work.md at handoff.
