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

## 2026-09-25 — cycle closed by the owner

Final verdicts: WP-R2 c502ead FAIL (0/1/1/4) → stopped. WP-K2 0cbf466 FAIL (0/1/0/3) → stopped. WP-B1 cae6d1a
FAIL (0/1/1/3); round 2 was stopped unfinished when the cycle closed. The integration branch holds WP-D1, K3, E1, F1,
F1b and F4, and it is green on CI. All unintegrated package branches are pushed as `claude/wp-*`. The handoff is
`planning/handoff-v0.7.0.md`.

---

# 0.9 mission progress

## 2026-10-04 — preparation

- Founder authorised a conditional 0.9 release, website integration and consumer updates; delivered product repairs and announcements remain outside scope.
- Fresh remote fetch and GitHub main query agree with clean starting commit `98e33c006cd6a0ef6a596caa5f18062b0ee74175`. Registry reports `latest: 0.8.0`.
- The private master workplan passed its mechanical workplan gate before editing implementation. The public measurement expectations are registered in `expectations-0.9.md` before product baseline and A/B runs.
- The real visual probe passed both runners, each 4/4 with a completed no-image control: observed Gemini `gemini-3.8-flash`, observed Grok `grok-4.7`. Original output and audit records remain private.
- Three read-only Codex subagents inventory repository contracts, product producer paths and site/consumer interfaces. They do not count as independent candidate judges.
- Phase A pending: frozen private inventory, registry installation, all-rules/default runs, hit packs, complete three-family adjudication and full recall sweep. No candidate implementation, release or improvement claim yet.

## 2026-10-04 — acquisition preparation and protocol audit checkpoint

- The clean foreign-CWD baseline installation contains registry `breaklint@0.8.0` and exact renderer peers `pagedjs@0.4.3`, `pdfjs-dist@6.2.108`, `puppeteer-core@25.8.0`. Node 24.21.0 and Chrome 154.0.8037.97 were measured for this mission.
- The voluntary text-only protocol-document audit produced two `FAIL` results from fresh `claude-opus-5-5` sessions. That audit thread is stopped; no third retry and no claim of software acceptance. Raw findings, frozen artifacts, hashes and dispositions remain in the private work item.
- Before the first product acquisition, private execution details were registered and committed: unanimous labels or evidence adjudication; a matched nonimplementing three-family precision panel for both arms; fresh labels for every candidate finding; source/object/mechanism matching; all adjudication attempts retained; binding cost observations cannot be replaced by a favourable flake series. The original numeric release criteria are unchanged. This acquisition registration does not replace the commissioned design, code, blind A/B or release audits.
- Portable copies exist for all ten requested print products. Four inputs were generated through their documented producers in scratch, with input hashes and original-file parity checks. Six Studio inputs await their registered producer invocation. No original delivered product bytes were changed.
- The unchanged website build passed in private scratch after the complete documented input list was copied. The initial incomplete-copy failure is retained as preparation evidence. No website deployment or consumer change occurred.
- Stock CLI reports and extra internal snapshot acquisitions have distinct identities. Version 0.8.0 offers no public full-snapshot export; a second acquisition is never described as same-acquisition evidence. Screen API coverage is its two fixed screen rules; print configuration arms do not apply to it.
- G-ID inventory contains 122 unique identifiers across historical tables and later dispositions. This is not an assertion that 122 defects remain open. Triage remains evidence-bound; no item has been declared fixed by this preparation.

## 2026-10-04 — first print acquisitions and recall start

The ten core private print inputs have their first required all-rules and default acquisitions recorded. Each arm analysed 786 pages across the available inputs; 785 were bound. The all-rules arm reported 538 findings and the default arm 141. Both arms have five exit-0 inputs, one exit-1 input, two exit-4 inputs and two exit-3 inputs. These are raw alerts and infrastructure/coverage outcomes, not quality labels or release metrics. Failed acquisitions retain their original commands and outputs; no thresholds, package bytes or time budgets were changed.

All 16 available acquisition PDFs were rendered at 110 dpi, with 1,572 page derivatives tied to their own PDF hashes. The four exit-3 arms produced no diagnostic PDF; their absence remains explicit. Stock CLI/public producer reports do not export the full snapshot. A separate private adapter passed its self-authored stock/raw/producer controls and mutations; independent acceptance is pending. Its first verifier preflight stopped before any model request because the stable source files were inside their own work-item directory. Sources were moved byte-for-byte outside that directory, with the gate unchanged.

The first private input has a committed disjoint recall assignment and a seeded, rounded-up 20% swapped overlap. Fresh Claude Opus and read-only Codex runs have started pixel review. Reported recall candidates remain unconfirmed until second-family and source evidence agree. Neither a label set, candidate implementation, A/B pass nor release has been declared.

## 2026-10-04 — private evidence acceptance and visual boundary checkpoint

The private snapshot adapter has a fresh independent `claude-opus-5-5` PASS with no blocker/high findings. Its two medium and six low observations remain explicit accepted risks; none is claimed fixed. The unchanged source also passed the workspace finish gate. The first gate attempt failed with a dependency-missing Python; the same declared tests passed using the existing dependency-equipped interpreter, without editing a gate or test declaration.

The first Studio-mode diagnostic capture matches the public Studio baseline on input hash, resolved configuration, all 37 finding fields and 49 bound pages. A distinct raw stock CLI acquisition checks the same produced HTML/CSS and matches the geometric rule values, while retaining its truthful unavailable original-source provenance. The private host had an approximately five-minute idle process tail after capture completion; its elapsed time is not substituted for binding stock performance observations. This cause is still unknown.

CLI stderr alone did not preserve Codex image-tool calls. Two fresh random-code controls scored 4/4; direct observation of the temporary isolated rollout proves actual image-tool calls and emitted image replies. Qualified page reviews now preserve each image call ID and the exact decoded pixel hash. Earlier attempts without that trace remain visually UNKNOWN, with an explicit correction to the initial stderr interpretation. No context-isolation, sandbox or runner guard changed. The vision-probe Grok attribution is refined by its observed model-usage event to `grok-4.7-build`; `grok-4.7` was the requested alias.

A private legal provider block was detected during local recall/source checking. One earlier full-page Claude review had already included it. Further product-material model requests are paused while privacy-safe evidence boundaries are checked; personal values are not reproduced in this public record. Completed outputs remain retained. No label set or complete review coverage is claimed. Independent local work continues, including a preregistered public-screen-API measurement host with self-authored controls and the binding stock performance series. No 0.9 implementation or release has started.

## 2026-10-04 — acquisition cost series and scoped review resumption

The binding first-three stock observations are complete for the large EN and DE inputs. All-rules median elapsed time is 117.15 s (EN) and 132.90 s (DE); default medians are 114.54 s and 134.88 s. Maximum command RSS is recorded separately for each arm. All twelve original command outputs, initial and final orphan checks, package pins and input hashes are retained. These command RSS values do not establish a sum of all descendant process memory. No favourable rerun replaced an observation.

Seven further private same-acquisition captures retain 501 findings and 737 newly rendered pages at 110 dpi. Together with the first capture, all eight available print inputs now have their own diagnostic pixel acquisitions. Two remain partial/ineligible for label evidence; their findings and exclusions are retained. Raw-mode captures preserve unavailable original-authoring provenance. This capture series is not a replacement for stock performance measurements.

Local targeted privacy-boundary checks cover the eight stock ALL diagnostic PDFs plus the distinct first private capture. Their full provider objects and continuations are excluded from foreign reviews. The pending first-input recall resumes only on a recorded set of inspected pages, with two explicitly labeled opaque bands whose outside pixels remain identical to the original. These excluded regions do not count as a full-page PASS. Full source/snapshot transfers remain on hold. This targeted known-identity/provider/contact/address check is not universal PII clearance.

The private screen acquisition host has a fresh independent `claude-opus-5-5` PASS and direct workspace finish0. Its two medium and four low observations remain accepted restricted-use risks: initial viewport only, observed issued resources only, unknown source binding and unproved WebSocket/WebRTC isolation. A full-page PNG is not whole-page rule coverage. A positive HTML/JavaScript network-pattern check precedes site captures.

The private hit-pack builder received a first independent FAIL: an unbound raster manifest could pass altered pixels. Five concrete tests fail against the unchanged implementation. A second-round hand oracle was committed before repair; further red reproductions precede the fix. Product hit packs remain blocked until the repaired scope receives its second and last independent audit with no open blocker/high. No new runtime dependency, public candidate implementation, label-set metrics, blind A/B judgement or release is claimed.

## 2026-10-04 — screen baseline and first confirmed recall miss

All 180 preregistered screen scenarios over 90 routes are recorded, each with its own direct command exit and time/RSS output. The public checker returned exit4 in every scenario because coverage remained insufficient; the restricted private host retained exit3. All 180 reports and rendered PNGs exist, but none is an eligible complete capture. Across 77,296 candidate evaluations, 6,680 were measured, 65,462 excluded and 5,154 not measured with `evidence/paint-unsupported`. Source identities remain unknown. Four overflow error findings require independent judgement. Full-page pixels do not enlarge initial-viewport rule coverage.

Issued-resource failures, three host geometry drifts and blocked originless image requests remain in the original evidence. The originless requests observed in this series were data images, not demonstrated external-server contacts. No request was newly permitted, no gate was relaxed and no scenario was rerun. Inputs, installed package/peer bytes and host sources were unchanged. Performance records describe individual command maxima, not summed descendant memory.

A baseline table continuation is now a confirmed diagnostic recall miss: the first fragment shows column headings, while the continuation has differing values without repeated headings. Independent `claude-opus-5-5`, `gpt-6.1-sol`, `grok-4.7-build` and `gemini-3.8-flash` reviews saw the corresponding pixels. Existing authored `thead` and static header repetition declarations do not identify the rendering cause; computed table/container styles still need measurement. This observation does not establish a defect in seller-delivered files. The first Gemini request failed on HTTP503; the later unchanged request succeeded. Approximate coordinates from the model are not adopted as measured geometry. No recall denominator or release metric is frozen by this single confirmation.

The private evidence derivation's expanded 23-test suite and all 24 targeted full-suite mutations completed under a bound installed Python/module inventory. An earlier surviving mutation and earlier unbound runtime observations remain retained. The second independent audit is pending; technical test success is not package acceptance. Full product hit adjudication, the remaining recall ranges and secondary HTML surfaces are still open. No public 0.9 implementation or release has begun.

## Evidence derivation package stop

The second fresh independent code audit found a new original-source integrity defect in the private derivation package. Its verified-source branch does not compare the declared original digest and byte length with the retained authoring bytes. A self-authored reproduction accepted both wrong claims while the package source remained unchanged. The package stops under the mission two-round limit; no third audit, repaired successor or product labels from this implementation. Earlier positive tests and mutation controls remain technical observations, not independent acceptance.

The auditor actually received three of the eight supplied synthetic PNGs and returned nine findings despite the requested eight-finding limit. These coverage and request-limit deviations are retained. The public checker remains unchanged. Inventory, individually bound source/pixel evidence and recall work continue; release metrics and publication are still open.


## 2026-10-05 — complete secondary screen baseline and strict review qualification

The remaining 206 HTML inputs now have 412 single-acquisition screen scenarios. The public checker returned exit 0 in 85, exit 1 in 1, and exit 4 in 326; the restricted host accepted 32 and retained exit 3 in 380. There are 34 unjudged findings. Coverage accounts for 70,432 rule candidates: 8,436 measured, 37,284 excluded, 24,108 not measured, and 604 omitted. Six captures drifted. Twelve planned XHTML scenarios were rejected as unsupported input; two other inventory groups have no HTML. These exceptions are retained rather than renamed or silently excluded.

Across both screen series, 38 findings are associated with seven captures. Only eight findings declare canonical pixel binding; 30 explicitly lack it because their captures drifted. Every source identity remains unknown. Existing full-page PNGs do not enlarge initial-viewport rule coverage or turn a restricted capture into a complete check. Source and pixel privacy inspection remains required before foreign-model review.

Three individually derived baseline widow panels have a qualified grok-4.7-build pixel review. A read-only gpt-6.1-sol call retains three exact image-hash/call witnesses, but the strict preregistered operational recipe returned 1 after an additional mistyped image path; its responses remain unqualified raw judgments. A Claude request stopped on the shared weekly quota. Gemini returned via fallback without the mission-required literal image-count success marker, so its answers remain visually UNKNOWN despite matching audit counts. No runner, context guard or release criterion was changed. Four further fixed whitespace panels are prepared with minimal source excerpts; the oversized two-image Grok batch remains blocked and separately registered single-image batches preserve the same original pixels.

Self-authored table/header and shifted-inline-text reproductions have handwritten expectations committed before measurement. An initial set of 15 table invocations failed before browser launch because its consumer working directory lacked renderer-peer resolution. The failed series remains intact. A separately committed correction changes only the working directory and fresh output paths, reusing the measured pinned registry install; inputs, expected values, rules, timeouts and peer bytes are not edited. New acquisition and hypothesis analysis are pending. No candidate implementation, frozen label set, A/B pass, publication or consumer update is claimed.

## 2026-10-05 — retained counterexamples and scoped pixel judgments

The corrected self-authored series completed 23 acquisitions against the unchanged registry package. All 23 own diagnostic PDFs were rendered at 110 dpi (38 pages). The shifted-inline primary has two visible physical lines but three retained collector lines; its handwritten oracle is RED. The baseline, real-third-line and standalone-inline controls retain their expected 2/3/1 counts. These are stored collector observations, not new rule tests or independent package acceptance. All eight shifted-inline command exits remain 0. The whole-table control retains exit 4 in all three arms, despite its two written/bound PDF pages; no coverage outcome was overridden.

Ten diagnostic table pixels show the expected distinction: natural continuation loses its authored column headings, while two separately authored tables each have headings. The whole-table and two wrapper variations keep their table together on the following page, so those variations do not establish table-header continuation causes. Twenty-four stock pages are decoded but not claimed visually inspected. Static contract inventory identifies missing semantic ownership, reference spans, resolved counters, intrinsic-image metrics and effective SVG print-size records; this is not an approved figure-index architecture.

Four individually bound whitespace hits now have qualified grok-4.7-build image judgments: two intentional/acceptable and two false-positive. Matching original/reencoded hashes, literal image-count success markers, direct exits, observed model and fixed response schemas are retained. They are single-family baseline judgments, not adjudicated labels. Gemini's four-image fallback returned gemini-3.7-flash after the chain head reported HTTP429, but lacks the required literal inline-count success marker and remains visually unqualified. Claude's shared quota remains an explicit gap. No favorable rerun, runner modification, label-set freeze, public implementation, A/B pass or release is claimed.

## 2026-10-05 — repeated baseline gates and provisional architecture audit

Seven preregistered test files completed ten isolated commands each on frozen baseline `98e33c0`,
with Node 24.21.0 and Chrome 154.0.8037.97. All 70 commands returned 0: 960 leaf-test pass events,
zero failures and zero skips. All 140 before/after profile checks were empty; source and lock bytes
remained unchanged. Raw TAP/time hashes were independently rechecked against the saved metadata.
This before-series does not clear the known flakes, replace the after-fix ten-run series, or establish
the ordered release-candidate gates. No test threshold, timeout or source was changed.

The provisional `planning/design-0.9.md` received one independent text-only audit. The service audit
identifies `gemini-3.7-flash`, zero images and CONDITIONAL: two high, three medium and one low finding.
Dispositions require registered unavailable-data declines in real-engine legacy migration tests,
an explicit configuration contract for new settings, verified collector attribution before dependent
semantic rules, measured graphic metrics and packed-consumer validation before exposing CLI options.
The two-error guard remains unchanged. The revised proposal is not independently accepted, and the
fresh Claude design audit remains unavailable. No implementation or release approval is inferred.

## 2026-10-05 — compound fragment controls, stdout stress and exact engines floor

The preregistered compound figure/table series retains 16 original acquisitions: eight exit 0,
four exit 1 and four exit 3. A preparation error that created the adapter output directory too
early is retained separately; the correction changed only fresh paths and the documented absent
directory precondition. Twelve available PDFs contain 28 pages at 110 dpi. Their seven distinct
decoded page images were inspected locally; identical images across arms do not establish report
identity. The genuinely tall control fails the cross-check in every arm and has no diagnostic PDF.

The compound source puts a 36-row table inside a kept figure. Its first retained figure fragment
lies beyond the physical page, while the visible figure/caption/table begin later. Fifty caption
and table-cell candidates retain paired off-sheet/visible one-line fragments. The outside-figure
comparison changes ownership and still loses repeated table headings; it is not an accepted fix.
Actual pagination tokens, unique physical extent and a valid scaling remedy remain unknown.

The current registry package completed 120 full-reader pairs across six formats and two runtimes.
Each retains direct CLI/consumer exits 1/0 and equality under the preregistered narrow byte projection;
stock JSON is below the registered 262,144-byte stress floor. A positive private copy with 55 added,
self-authored resource references then completed ten JSON stress triples per runtime. All twenty
`--out` controls are 442,353 bytes. Slow-reader CLI/consumer exits are 1/0 with projected equality;
early-close exits are 3/0 with 100 received bytes and the stdout/EPIPE diagnostic. Twenty separate
preclosed confirmation-channel cases retain complete reports, CLI exit 1 and their own diagnostic.
No comparator was broadened, package code edited or historical result silently replaced. Other-format
stress and the existing greater-than-1-MiB gate remain outside this scoped conclusion.

All nineteen ordered baseline commands completed with direct exit 0 under exact Node 22.13.0,
including live acquisition, technical report surfaces, report-surface mutations and selfcheck.
The unchanged source was bound to `98e33c0`; the downloaded runtime was matched to its official
checksum before execution. This additional floor characterization is not a new release-candidate
gate, packed-consumer proof, CI acceptance, after-fix flake series or multi-model sight review.
Collector/figure implementation, complete hit adjudication, label-set metrics and release remain open.

One independent `grok-4.7-build` review now has qualified judgments for five selected synthetic
baseline findings on six original 110-dpi pages. It identifies four false-positive one-line
caption/header alerts and one real compound-layout problem whose reported height and scaling
advice are unsupported. Its NO_GO applies to those five existing report claims, not a new-version
release decision. All six image hashes, the literal inline count, observed model, typed response
records and concrete sight details are bound. An earlier local encoding receipt has an unexplained
audit digest and remains invalid; direct decoded payload bytes instead match the authoritative
single audit record and original pixels. No digest was overwritten or model call repeated.
The other 96 findings in that acquisition and two optional visible candidates remain unjudged /
unconfirmed; one family does not constitute a label set, precision estimate or accepted repair.


## 2026-10-05 — bounded text-loss and semantic controls

The remaining 23 pre-registered registry-0.8.0 text-loss acquisition commands completed: seven expected `contents-heading` guard refusals (exit 3, no PDF) and sixteen exit-0 commands with individually bound same-acquisition PDFs. These are acquisitions, not word-survival or pixel judgments. The independent token comparison and every-page 110-dpi sight review remain pending. The original invalid ALL-configuration command remains an invalid attempt; it was not reinterpreted or silently repeated.

Sixteen whitespace-cause controls and eight figure/reference controls have handwritten expectations and sealed acquisition registrations. Their actual pagination, break causes, semantic ownership and labels remain unknown. No collector, rule, schema or report implementation has started.

The revised provisional design has no new Gemini verdict: the sanctioned text runner exhausted its model chain with HTTP 503 responses. Claude design review remains unavailable on the previously observed quota. Neither absence authorizes implementation. One further baseline visual hit received a qualified `grok-4.7-build` false-positive judgment; it remains a single-family judgment, outside the adjudicated label denominator. A separate completed judgment whose caller failed to retain the direct wrapper status remains unqualified.

## 2026-10-05 — independent text accounting and diagnostic coverage stops

The frozen independent text comparison completed for all sixteen own PDFs. All sixteen retain exact
Counter mismatches: none of the preregistered required tokens is missing, but the extracted text
includes additional `BLSID` evidence-mark tokens. No token was filtered or oracle broadened. The
separate handwritten removed-token control correctly reports its missing required token. All
sixteen PDFs were copied byte-for-byte and rastered at 110 dpi; every one of their 28 pages was
individually viewed. These controls do not reproduce whole-word loss. A possible small rounded-edge
glyph clipping remains unconfirmed; general clipping safety and the refused contents cases remain
unknown. These observations are not independent release acceptance or adjudicated labels.

The first whitespace control retains checker exit 4, two half-empty warnings, and native forced-break
declines that leave widow/orphan coverage below their unchanged floors. The original series stopped
before its other 31 arms. The figure/reference series completed ten exit-0 arms and stopped on arm
eleven, an explicitly repeated-header table, with checker exit 4; five arms remain unrun. Own PDFs
and refusal evidence are retained. Separate diagnostic collection proposals cannot convert either
stopped series into a pass or supply eligible labels from partial captures.

Source inspection adds preservation and clipping requirements to the provisional design. The actual
runtime clone/column origin is still unknown. Core implementation, complete three-family hit review,
recall, label-set metrics, candidate gates and release remain open.


## 2026-10-05 — conditional design audit and bounded diagnostic evidence

The fresh text-only design audit completed at frozen `212a675`: native exit 0, actual
`claude-opus-5-5`, zero images, CONDITIONAL with three high, four medium and one low finding.
The changed proposal now names counted inventory-completeness obligations, immutable proof-source
thresholds/profile floors, collector semantics and legacy provenance, acquisition-profile matching,
public enum/stamp impacts, all-placement dependency gates, counted suppression annotations and
default-off admission. These remain proposed dispositions; independent acceptance and implementation
proof are pending. No collector, rule, schema, config or report implementation has started.

The separate remaining-case whitespace diagnostic stopped on its eighth command. The actual reason
is required-page-binding-incomplete: three written pages but two bound, with the blank recto page
unbound. All existing rule coverage records are complete; that does not waive the evidence guard.
Twenty-three registered diagnostic commands remain unrun. The separate five remaining figure/table
diagnostics completed with three checker exits 4 and two exits 0, without making the stopped
original series eligible or accepted. Thirteen own PDFs were copied and rastered at 110 dpi; every
one of their 31 pages was individually viewed. Visible blank/parity, repeated-header and separated-
caption controls are retained as sight evidence, not new-rule precision, labels or a release gate.
⛔ superseded by the exact later paragraph-prefix sight check: the complete first words are visible in both named-page controls. The earlier clipping candidate is refuted; this is not general clipping-safety evidence.

Three scoped baseline whitespace hits now have qualified Claude pixel reviews. Two corresponding
Grok judgments are typed and image-bound; the third has malformed embedded JSON and stays
unqualified despite valid image transport. A Codex sub-run lost its native image trace during
normal isolation cleanup and remains unqualified; direct main-agent baseline sight is documented
separately with its reviewer-context limitation. A first Gemini three-image call returned
`gemini-3.6-flash` through fallback. Its image audit records three files but the required literal
inline-count success marker is absent, so the visual judgments remain unqualified. No marker or
missing trace was reconstructed and no unfavorable or malformed call was silently repeated.
Complete independent-family hit coverage, disagreements/adjudication and the label denominator
remain unfinished.

A bounded private inventory step stopped after an overbroad local snapshot serialization exceeded
its whitelist. The incident is retained as metadata; its scope and related foreign transfers remain
stopped/on hold, with personal content unknown. No model, helper, renderer, test or Git action ran
in that stopped step. Original product files are unchanged.

The original report arrays were re-read: 538 all-rules and 141 default-profile findings. These
remain inventory counts, not validated precision denominators. Candidate metrics, blind A/B,
release-candidate gates, publication, website and consumer integration remain open.


## 2026-10-05 — contract refinement and explicit evidence limits

The frozen `791385b` design received a second qualified Claude text audit: actual
`claude-opus-5-5`, CONDITIONAL with three high, four medium and one low finding. A qualified
`gemini-3.8-flash` text audit reports zero additional contradictions; it does not erase the
source-supported Claude findings. The provisional refinement now separates registration, admission
and automatic enablement, inventories all thirteen released rule consumers and their owed controls,
and specifies cause decisions, completeness witnesses, demo/legacy migration, comparison identities,
Config v2 compatibility and retained suppression annotations. All eight dispositions remain OPEN.
No core code, new rule, schema, migration, threshold, floor or runtime dependency changed.

Two independently confirmed table-continuation defects are now retained in the private label and
miss ledgers. Their source ownership and delivered-file identity remain explicitly unknown where
not proven. This is a partial label set, not completed recall, precision or evidence-led scope freeze.
The three scoped whitespace hits in a second document have qualified Claude pixel judgments; one
separately registered Grok response remains unqualified because its nested hit id differs from the
canonical id. The response is preserved without repair or a favorable retry. Other original calls
remain distinct, with qualification pending.

A third document has twenty-four actual primary Codex page views and a separately recorded privacy
screen. The privacy screen contributes zero recall credit. Twenty-five exact pages are approved for
prospective Claude primary/overlap review; three pages with visible personal/contact categories
remain on hold. The remaining pages and preselected overlap are not represented as reviewed.

A necessary local Gemini-wrapper repair has frozen code and red/green/external-mutation evidence.
Its independent `claude-opus-5-5` code verifier reports PASS with three low test advisories, while
explicitly stating that it did not inspect the saved run evidence. Those evidence gaps remain open
and the separate repair work item is not yet closed. Historical Gemini fallback calls lacking the
required literal image-count marker remain unqualified. This repair is outside the public package;
no studio skill change was applied.

Phase A, independent corrected-design acceptance, candidate implementation, the complete blinded
A/B, release and every publication/consumer step remain incomplete. No release claim is made.

## 2026-10-05 — separate infrastructure reviews and an explicit finishing failure

The approved private test-environment repair declares pinned image/PDF development dependencies;
it adds no breaklint runtime dependency. Original full tests failed the two new import pins in both
profiles while the existing pins remained green. The current full two-profile integration and the
separate declaration-removal controls retain actual native statuses and handwritten image/PDF
oracles. The declaration controls produce wrapper exits 0, 2 and 0 for each profile, with only the
private manifest changed and the original state restored.

Two fresh independent source reviews now report PASS, actual `claude-opus-5-5`, with no blocker or
high finding. The dependency review has two low findings and six explicit review limits; the
separate mock-launcher review has three low findings and seven review limits. These are source
reviews with documented evidence limits, not blanket acceptance of every retained output or of
the original wrapper repair. Earlier failed captures, stopped series and missing visual success
markers remain distinct. Advisory dispositions do not erase the review limits.

The dependency package's real finishing operation exits 2. Its selected complete six-command
Quality gate exits 0, but the commit-interval check includes an unrelated automation commit
interleaved immediately after the first own preregistration commit. Moving the start past that
commit would omit own work. No start boundary, declaration flag, selected gate, threshold or
foreign automation source was changed; the work item remains open without a completion marker.
New Gemini visual calls remain on hold. The launcher package's formal finishing operation is still
pending.

Further baseline recall calls have qualified native image and full-schema evidence. Their raw
candidate observations remain unconfirmed until source/report binding and a second model family
support a miss. Corrected prospective recall prompts retain their original schemas and acceptance
criteria; local full-schema compilation authorizes no foreign transfer. New original Codex page
ranges have actual image emissions, while earlier stopped ranges retain zero review credit.
Raster presence does not upgrade a page whose original native coverage is unverified.

The private label set still contains only two independently confirmed table-continuation defects.
Phase A, final evidence-led design acceptance, candidate rules and report implementation, complete
blind A/B, release gates, publication and consumer integration remain incomplete.

The private portability repair has an actual successful finish (exit 0), a native closure
marker and an artifact commit whose 759 positive file blobs match the measured bytes.
The separate runtime dependency repair remains OPEN after its actual finish exit 2,
although all selected tests returned 0. Its original commit interval and stop criteria
remain unchanged; a read-only isolation assessment does not authorize another finish.
New visual calls through the affected runner remain on hold.

A completed original baseline recall split now retains 38 primary pixel observations and
9 preregistered overlap observations; an earlier eight-page stopped range remains
unreviewed. Its candidate observations still have no confirmed-miss or label credit.
The shipped coordinate contract establishes CSS-pixel units, while the transform to the
particular PDF raster remains unproved and the source-box crop attempt stays stopped.
Another baseline recall packet and its exact single-call controller are committed and
read back; the first eight-page native external review is running. Native image, model,
full canonical schema and response-copy qualifications remain pending until it exits.

## 2026-10-05 — measured recall status and minimal raster evidence

⛔ superseded by this measured update: the preceding first-call running status is historical.
That native eight-page review completed with exit 0, eight actual original image results,
full canonical validation and eight rejected adverse response copies. Its thirteen raw
candidates remain unconfirmed. A second original seven-page call exited 0 but read no
images and honestly marked all seven pages unreviewed. It has zero visual credit and
will not be repaired or repeated.

The second response cited a stale operative prerequisite: the bound input still said
that its original disposition was not committed, although actual commits and Root
readbacks had completed. The successful first call contained the same statement, so
this is a measured text-state error rather than a deterministic explanation of model
behavior. The four uncalled groups remain on hold while a prospective, bounded input
correction is prepared. The original prompts, caller, failed response and acceptance
criteria remain retained; no previous qualification extends to changed input.

For the separate unproved source-box transform, a prospective manual raster method
was registered and committed. Two original page views informed integer pixel regions,
which were separately committed before extraction. Both resulting crops preserve
the exact original subarray without scaling; actual local crop views establish
sufficient table context and no observed personal identifiers in these selected regions.
A fresh second-family confirmation request is being prepared using only the two minimal
crops. The original transform stop, incomplete acquisition eligibility, source-owner
and cause limits remain open. The new views add no primary or overlap recall credit.

The private label set still contains two independently confirmed defects. Complete
Phase A, final design acceptance, implementation, blinded A/B, release gates and
publication remain incomplete.

### 2026-10-05 — qualified original recall group and bounded table confirmation

Supersedes the preceding pending status for the first of the four uncalled groups
and for the two-crop confirmation request; all historical failures remain retained.
The prospective input correction and exact native acquisition registration were
committed before submission. The original seven-page group then exited 0 with seven
actual image responses, each byte-identical to its registered PNG. The unchanged
structured response passed the full canonical schema, and all eight negative copies
were rejected. Native output identifies `claude-opus-5-5`. Complete semantic review
retains ten unconfirmed observations, including small figure text, a split panel and
whitespace. Glyph-height estimates establish no measured font size; visible whitespace
establishes no avoidable break cause. No observation became a label or recall numerator.
The earlier image-less seven-page response remains unqualified and is not repeated.

The separately registered two-crop request exited 0 with two actual byte-identical
image responses. Full canonical validation and eight rejected negative copies passed.
Native output again identifies `claude-opus-5-5`. This second family confirms a minor
visible table-continuation problem: missing repeated column labels and differing column
starts, with reader impact 1/3. Its repair suggestion remains untested; the retained
source already declares a table header group. A separate whole-source and complete
finding-record query supports the local object binding, while global acquisition
eligibility remains refused. This is a confirmed pixel candidate with no global
`NOT_REPORTED` label, denominator credit or source-box-transform claim. The private
label set remains two defects; no release criterion is yet established.

### 2026-10-05 — remaining original recall groups and corrected acquisition diagnosis

Supersedes the preceding pending status for the remaining three original recall groups.
Their unchanged criteria were registered and committed before the native calls. Eight
primary pages, four primary pages and six preregistered overlap pages completed with
exit 0 and respectively eight, four and six actual byte-identical PNG results. Each
unchanged response passed the full canonical schema and eight rejected adverse copies.
Native output identifies `claude-opus-5-5`. Complete semantic review retains ten, five
and six unconfirmed observations respectively. These include incoming tables without
visible column labels, short monospace wraps and whitespace. Authored hard-break origin,
PDF copy fidelity and whitespace avoidability remain unproved. The earlier seven-page
image-less call remains unqualified and is not repeated. Across the five qualified
original groups there are 27 primary and six overlap pixel observations, with 44 raw
candidates and no new confirmed-miss, label or denominator credit.

A separate read-only tooling composition question now has actual source-read evidence.
An earlier intake opened no source because its prompt gave relative locators to an
empty working directory; that failed intake remains retained. A separately registered
absolute-locator request completed with exit 0, 51 successful reads of 47 allowed paths,
all five current sources read in full and one explicitly partial historical stderr.
It supports mocked offline transport within the supplied scope; joint runtime binding,
helper/live coverage and formal completion remain unestablished. Original finishing
failures and review budgets remain unchanged, and affected visual calls remain on hold.

The abbreviated font-decoding explanation for four historical acquisition refusals is
refuted by the original native reports. They show post-pagination document quiescence
failure with 18 retained font requests, zero pending body tasks, and eight served local
font resources per run. Those 32 resource records match 16 existing registered local
font files. Server-byte identity and successful local metadata parsing do not prove
browser font selection or decoding. The request tracker counts native request objects,
not unused FontFaceSet entries; individual lifecycle events and failing page role remain
unknown. A separately blocked favicon is also retained as a resource failure. No timeout,
request gate, font source or delivered document was changed to clear these refusals.

The private label set still contains two confirmed defects. Complete Phase A, accepted
final design, implementation, blind A/B, exact candidate release gates and publication
remain incomplete. No new-version improvement or release criterion is claimed.

### 2026-10-05 — complete table context and original recall coverage census

Supersedes the preceding two-label count. A bounded context adjudication of two
previously unconfirmed table continuations completed with native exit 0. Its four
actual PNG responses match the exact registered source bytes, and the complete
artifact Read output reconstructs the frozen context bytes. The preregistered response
schema and identity relations passed; all 16 malformed copies were rejected without normalization.

Both cases are confirmed visible defects, with reader impact 2/3 and 1/3 respectively.
The lower impact follows from the continued cells making their column roles inferable,
not from averaging prior model judgments. Earlier wording that all column meanings
were impossible to identify overstates the evidence. An older crop omitted the fifth
continued row; its immutable review retains that four-row limit. The complete new
context establishes intact row continuity. The older omission was a crop error.

A captured authored-file ownership chain is now established for these two objects.
Logical-node value identity remains unavailable under its separate contract; renderer
cause, source-box-to-PDF transformation and delivered-file correspondence remain
unproved. The authored header-group declaration already exists. Proposed fragment
handlers, fixed column widths and keep constraints remain untested, with reflow,
overflow and whitespace tradeoffs requiring a separate scratch repair assignment.
No delivered product file was changed.

The private label set now contains four confirmed misses. Existing records were
preserved byte-for-byte, and the new adjudication adds no original primary or overlap
recall credit. A separate metadata census preserves the actual original family/role
assignments, partial pages, acquisition distinctions and unreviewed groups. It performs
no retrospective pixel qualification and establishes no complete recall denominator.
The next original page task is limited to local privacy sight after exact file binding;
prior technical stops and external-transfer holds remain unchanged.

Complete Phase A, accepted final design, implementation, blinded A/B, exact candidate
release gates and publication remain incomplete. No new-version improvement, global
precision or recall value, calibrated status or release criterion is claimed.
