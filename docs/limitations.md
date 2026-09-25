# The burden of proof, and where it stops

Two error messages in this codebase send you here. `defineRule` (`src/core/rule.ts`) refuses a
rule that carries `severity: "error"` without a named proof source, and the registry
(`src/rules/index.ts`) refuses to load if the number of error rules is anything other than two.
This page is what those messages want you to read first, so that raising the number is an
argument rather than an edit.

It also states, in one place, what this tool does not know.

## Why exactly two rules may fail a build

Eleven of the thirteen released rules compare a chosen threshold against a real measurement. A
chosen number can be wrong for your document without anything being wrong with the
measurement, so those rules do not gate by default. Two rules compare a directly measured quantity
against a boundary that is not chosen at all — and only those two gate.

| rule | what makes the boundary structural |
|---|---|
| `layout/unbreakable-block-too-tall` | The block declares `break-inside: avoid` and is taller than the page content box. There is no page it can sit on. The comparison is between two measured lengths and the threshold is the medium itself. |
| `svg/text-overflows-viewport` | The text box, normalised through `getScreenCTM()`, lies outside the SVG viewport. What is outside the viewport is not drawn. The threshold is zero, not a preference. |

## The three proof classes

A rule may carry `error` only by naming one of these in its manifest, machine-readably, as
`proofSource`. The registry rejects `error` without one, and it rejects a proof source on anything
that is not an error — either the proof holds and the rule gates, or it does not and the claim goes.

**(A) Geometric invariant.** The rule compares two *directly measured* quantities against a
structural threshold — zero, or a physical limit of the medium. A freely chosen number is not an
invariant. Both current error rules are class A.

**(B) Cited norm with its boundary.** The rule cites a specific clause of a norm or specification,
*and* names the cases in which that norm says nothing, *and* ships a non-triggering fixture for each
of those cases. If the cited norm contains a relaxation clause, the rule must additionally show that
the relaxation did not apply in the case at hand. A rule that cites a norm and ignores its exception
has not satisfied B, it has asserted B. No rule claims B today: `layout/widow` and `layout/orphan`
cite the norm correctly and are still `warn`, because no fixture reaches their error path, and a
path no fixture reaches is unverified.

**(C) Resolution invariant.** The rule compares two *directly determined* address quantities — the
resolved target of a reference and the distribution boundary of the artefact — against a structural
in/out threshold, and ships a non-triggering fixture for every case where the target lies inside the
boundary and therefore travels with the artefact. **No rule claims C.** It is defined so that
`artifact/local-uri` has a clean route to `error` in a later version, not to leave a back door open
in this one.

A freely chosen threshold may never be `error`. The three classes are three ways for a threshold
to stop being freely chosen: A and C make it structural — zero, or a limit of the medium — and B
makes it *given*, by a norm that names the number and whose exceptions the rule has ruled out. A
rule that satisfies none of the three is at most a warning, however confident its author is.

This distinction matters because the word "uncalibrated" is doing two jobs elsewhere in this
project. It means: no corpus of human-labelled documents backs this number. That is true of all
thirteen released thresholds, including the two error rules — and it does not disqualify them, because their
numbers are not up for calibration in the first place. A block taller than the page fits on no
page; the threshold is the page. What calibration would decide is *where to draw a chosen line*,
and A, B and C are exactly the cases where no line was chosen.

**One more condition, and it is the one that actually bites.** A rule may carry `error` only if a
fixture that triggers exactly that error path exists in the corpus. This is what disqualifies the
widow and orphan rules — not doubt about the norm.

## Coverage floors

An `error` rule that could not measure everything it needed is not silently downgraded to a pass.
Coverage is reported per rule and floors apply by severity: `error` demands full coverage, `warn`
demands half, `info` demands none. Falling below the floor produces exit 4, `insufficient-coverage`,
which exists because of a measured case: a multi-column document once produced six pages analysed,
one rule run, five candidates, zero measured — and exit 0, indistinguishable from a clean run.

Configuration Contract v1 can make those floors stricter, but cannot lower them. The `strict`
profile sets every floor to 1. The two proof-source-A thresholds are not configurable at all:
turning a structural boundary into a caller preference would invalidate the reason those rules may
gate by default. The effective floors and their origins appear in the report (schema 3 from 0.2.3,
schema 4 from 0.5.0, schema 5 when the optional `remediation` was added to a finding); stored
snapshot fixtures moved to schema 3 in 0.2.3, when `inkCollected` was added, and to schema 4 in
0.5.0.

### What coverage is a ratio OF, and the two things it is not

Coverage answers a question about the DOCUMENT: of the targets this rule ought to have judged,
how many did it judge? Two kinds of decline are therefore not in the denominator, and both are
enumerated in `src/core/enums.ts` rather than inferred from how a reason is spelt.

**A capability represented only in research code** (`TOOL_CAPABILITY_ENV_IDS`). The SVG ink passes
are not implemented in production. Version 0.3.1 therefore removes `svg/text-clipped` and
`svg/text-ink-collision` from the public registry instead of making their permanent decline part of
every user's coverage. The enum and the two modules remain for the frozen M3 validation lab; the
released CLI, schema and SARIF catalogue never run them.

**A question that does not arise** (`NON_APPLICABLE_ENV_IDS`). With `overflow: visible` an SVG's
text is painted whether or not it leaves the viewport, so `svg/text-overflows-viewport` has
nothing to decide about it — as with an SVG holding no text. One such figure would otherwise drive
an error rule below its floor of 1 and end the whole run in exit 4.

A third case is not a decline at all: a `<text>` that is not painted. Inside `<defs>`, `<symbol>`,
`<clipPath>` or `<pattern>`; under `display: none`; or hidden by `visibility: hidden`,
`opacity: 0` or a missing fill and stroke. None of it is a target of a rule about what the
viewport clips away, so none of it is counted or declined.

Both halves have to be measured rather than read off the markup. Chrome answers `getBBox()` and
`getScreenCTM()` for an element in `<defs>` and yields a box far outside the viewport, which a
gating rule will report as an error about something nobody can see — so the collector asks
`getBoundingClientRect`. And the invisible cases lay out perfectly normally and return a full
rect, so the empty-rect check does not see them at all — those come from the computed style. Each
was found by building the fixture for the previous one.

A `<text>` that IS laid out and still has no readable box declines with `env/svg-ctm-unavailable`
and DOES count against coverage — that is a measurement this tool owed and did not deliver, per
target rather than per SVG. The same fail-closed rule applies when a box exists but does not prove
the painted result: `<use>`, visible stroke, paint servers, text decoration, clip paths, masks and
filters decline with `env/svg-painted-bounds-unsupported`.

Neither exemption leaves the report. Both keep their rule, reason and count in `notMeasured`, and
each rule's own books are still checked first: `defineRule` requires measured plus declined to equal
candidates, and only afterwards does the engine subtract. A decline that names a property of the
INPUT — `env/multicolumn`, `env/svg-ctm-unavailable`, `env/svg-too-many-text-targets` — stays in
the denominator, because another document would have been measured. That is what exit 4 is for,
and `tests/unit/coverage-base.test.ts` holds both halves of the pair so that widening the
exception to cover the second kind turns a test red.

## What no amount of testing here establishes

**Two research rules are not product rules in this build.** `svg/text-clipped` and
`svg/text-ink-collision` need isolated, stable SVG pixel passes, which remain M3 work. Their modules,
fixtures and renderer lab are retained so the work is not erased, but they are absent from
`ALL_RULES`, configuration, SARIF and the demo. The released rule count is thirteen.
`svg/text-overflows-viewport` needs only geometry and does measure.

**Complex SVG paint is detected but not geometrically solved in this build.** `querySelectorAll`
does not cross the instance tree created by `<use>`, and `getBBox()` does not include stroke,
clipping, masks or filter effects. The collector now detects those entrances and keeps each as an
unmeasured candidate. Because the viewport rule is an error rule with a coverage floor of 1, even
one such target produces `insufficient-coverage` (exit 4), never a silent clean result or a guessed
error. Full support belongs to the independent ink passes, not to an expansion guessed from style.

*What this costs on a real document, measured.* The entrance that fires in practice is not `<use>`
or a filter — it is the **halo**: `paint-order="stroke fill"` with the stroke set to the background
colour, the standard way to keep a diagram label legible where it crosses a line. Over an
eighteen-document reference set of illustrated chapters:

| document | `<text>` candidates | measured | declined | trigger |
| --- | --- | --- | --- | --- |
| 03 | 30 | 30 | 0 | — |
| 05 | 24 | 24 | 0 | — |
| 09 | 23 | 20 | 3 | 3 haloed labels |
| 02 | 45 | 30 | 15 | 15 haloed labels |
| 07 | 27 | 10 | 17 | 17 haloed labels |

Read the first two rows before the last three: inline SVG text is **not** structurally unmeasurable
here, and a document whose labels carry no visible stroke measures at coverage 1. What is
unmeasurable is a `<text>` that paints a stroke, because `getBBox()` returns the fill outline and
the tool refuses to judge an overflow against a box that describes different ink. Three haloed
labels are enough to take an error rule with a floor of 1 to exit 4, which is why one such figure
reads in the report as though the whole class had failed.

The named next step is not the ink pass. A stroke centred on the glyph outline gives a **two-sided
bound** for nothing but the stroke width: the fill box is a lower bound on the painted box and the
fill box inflated by `stroke-width / 2` is an upper bound. A target whose lower bound already
leaves the viewport overflows for certain; one whose upper bound is still inside it does not
overflow for certain; only the band between them stays undecidable. On the corpus above the halo
strokes are 2–4 px against overshoots that matter at ten times that, so almost all 35 declined
targets are decidable without an ink pass at all. This is a named gap, not a design position.

**Nontrivial viewport boxes are detected but not reconstructed.** `getBoundingClientRect` is the
border box and becomes only an axis-aligned envelope under rotation or skew. An SVG root with
border, padding, rounded clipping or a nonzero overflow clip margin therefore declines, as does an
SVG whose own or ancestor CSS transform geometry is nontrivial (`transform`, the individual
`rotate`/`scale`/`translate` properties, perspective or motion path). The reason is
`env/svg-viewport-geometry-unsupported`. Ordinary axis-aligned SVG roots remain measured. A later
content-quad implementation needs its own transform-aware live proof.

**Every threshold is uncalibrated.** There is no corpus of real documents with human-checked truth
behind any of the thirteen released numbers. The fixtures show that each rule does what it says; they do not
show that what it says is the right thing to say about your document. That is the difference between
a verified implementation and a validated one, and only the first is claimed. `calibrated: false`
travels in the type, in every finding and on every rule page for that reason.

**A document whose paginator could not place its content is not measured at all.** Paged.js
fragments a page by making `.pagedjs_page_content` a multi-column container whose pitch is the
content width plus a gap of `margins + bleed + 1000px`. What it fails to move onto a new page stays
in the second column, one pitch to the right, invisible behind an `overflow: hidden` sheet. Where
that content is a table box, `page.pdf()` — which renders in print media, with a re-sized
fragmentainer — puts it somewhere else and leaves it there, so the PDF does not reproduce the
geometry the rules measured. The run ends in exit 3 with `render-unstable`, and the event names the
elements, their source ids, the pages and the column pitch. It is not a rule finding and cannot
become one: nothing about the pages that DID lay out is reported, because the state they were
measured in was withdrawn.

Measured over eighteen chapters of one shipped HTML bundle: 6 of 6 documents with table residue in
an overflow column could not be measured, 12 of 12 without it could. Two of those twelve carried
residue of other kinds — one `<p>`, one `<em>` — and measured cleanly, because ordinary block
content re-fragments to the same boxes. Nothing exotic produces this: no `@page`, no print
stylesheet, no `break-inside` and no script are needed, only a table that crosses a page boundary.

The six documents are recorded, not published. They are chapters of a paid product, and this
repository is public and MIT, so `corpus/public/pagination-residue-v1` keeps their SHA-256 values,
rights and privacy review and exact expected residue while their bytes stay outside it —
the `private_nonredistributable` shape of `docs/validation/corpus-contract-v1.md`. That record is
now historical: re-measured on 2026-09-18, five of the six documents and their shared stylesheet no
longer exist at the recorded digests, so nobody can run its private half. `npm run
test:pagination-residue` prints `NO CLAIM` and reads none of the six, with or without
`BREAKLINT_RESIDUE_CORPUS_ROOT`, and it is no longer a CI or release step — a step that exits 0
having read zero documents would be a green light over nothing. What holds this class in CI is the
public `tests/fixtures/fragmentainer-residue.html` in the live suite, reduced from one of the six
until no product text remained; the reduction is itself the measurement that nothing exotic is
required.

**Rendering is not reproducible across machines.** Browser rendering varies with the host operating
system, browser version, settings, hardware and headless mode. PNG output here is evidence, never a
comparison basis, and no check compares output file hashes.

**Findings depend on font availability.** A missing `@font-face` changes metrics, line breaks and
page breaks, and can turn a correct page into a phantom finding. The run waits for
`document.fonts.ready` and stops with a non-zero exit if a declared font resource fails, rather than
reporting findings it cannot stand behind.

**Missing image content is a named limitation, not a silent success.** A failed decode is non-fatal
only when the HTML declares positive `width` and `height` attributes and Chrome measures a box
exactly equal to both values. The report then carries `image-content-unavailable`, a resource index
and both declared and rendered dimensions without persisting the URI. Missing dimensions,
replacement-text geometry, zero-size boxes or authored CSS that changes the box remain fatal
because the absent pixels can change layout.

**One paginator version.** Paged.js is pinned to exactly 0.4.3, because the break cause is read from
attributes the paginator writes into the tree and does not guarantee as an interface. Any other
resolved version stops the run with exit 3, and no flag overrides it.

**The browser has a floor, and it is stated as capabilities, not as a version.** The pinned
rasteriser, `pdfjs-dist` 6.2.108, uses recent JavaScript built-ins and web APIs without testing for
them. A live run with `pdfjs-dist` installed therefore needs a browser that provides every name on
the checked lists, `PDFJS_REQUIRED_CAPABILITIES` in `src/render/rasterizer.ts`: 167 names in the
page and 136 in its worker. They are what a scan of the pinned build finds
(`tests/tools/pdfjs-platform-inventory.ts`) in `build/pdf.mjs` (the page) and
`build/pdf.worker.mjs` (the worker), and they are exactly as complete as that scan. It reads six
syntactic shapes: `Name.member` of a name the file does not declare, `new`/`instanceof`/`extends`
of such a name, members of the lower-case global objects (`document`, `window`, `console`,
`crypto` …), bare calls of the names the realm's platform declares according to TypeScript's own
DOM, WebWorker and ECMAScript library files (so `fetch()` counts even though pdfjs also has methods
called `fetch`), bare calls of names the file never binds, and — by pattern — the instance members
of ECMAScript 2022 and later, the iterator helpers (`.values().some(…)`, `.toArray()`) and the web
members of the same period, such as `Map.prototype.getOrInsertComputed`, `Blob.prototype.bytes`,
`Response.prototype.bytes` and the async iteration of a `ReadableStream`
(`ReadableStream.prototype[Symbol.asyncIterator]`). Uses that pdfjs itself feature-tests, and scan
matches that are not platform names at all, are exempt, each with its reason in the scanner. What
the scan does not see: an older instance member (`replaceAll`, `flatMap` and the like), an instance
member of a type the text does not show and that is not on the pattern list, and a bare global
that TypeScript does not declare and that the file also binds locally. The lists are deliberately
conservative in one respect: they cover every unguarded use in the build, not only the paths a
rasterisation reaches. `Blob.prototype.bytes` in the worker is the case where that matters — pdfjs
calls it only when it saves or prints annotations that carry editor images, which this rasteriser
never does, and the measured browser below lacks it — and it stays on the list because nothing
here could keep a reachability argument true across pdfjs upgrades. The rasteriser page checks the
page list in the page and the worker list in a module worker of its own, before it loads the
library, and a browser that lacks anything ends the run with exit 3 before any document is opened;
the message names what is missing and where, the browser version and `BREAKLINT_CHROME`.

Measured on Chromium 141.0.7390.37 through the real start-up path: the page lacks
`Map.prototype.getOrInsertComputed`, `WeakMap.prototype.getOrInsertComputed` and `Math.sumPrecise`;
the worker lacks those and `Map.prototype.getOrInsert` and `Blob.prototype.bytes`; every other
checked name is present in both. Before the check, every live run there paginated and measured its
document and only then failed inside the rasteriser with an error that named an internal method —
with `--no-evidence-binding` too, because the evidence rasterisation is part of acquisition. There
is no polyfill and no transpiled pdfjs build to get below the floor: `Math.sumPrecise` has
exact-summation semantics, and either would put an unvalidated component inside the evidence
apparatus. A unit test repeats the scan and fails when the lists and the build disagree, so a pdfjs
upgrade that adds a platform name in one of the scanned shapes fails the suite rather than moving
the floor silently. No minimum version number is stated,
because none has been measured; the live suite passes on the current Chrome of the CI runner.
Without `pdfjs-dist` the check does not run and the run reports without evidence, as the README
describes; `--demo` needs no browser at all.

The measuring primitives themselves no longer need anything a browser may leave unexposed: they
used to read the global `FontFaceSet`, which Chromium 141 does not define, and every live run there
ended with exit 3 before measuring anything. They now take the font set's prototype from the
document's own `document.fonts`, before any author script runs.

**Windows is not supported, and a live run there now stops before it starts.** Process termination
rests on POSIX process groups, and Windows job objects are neither designed for nor measured. Read
from the code, not run: until this release a Windows run with `BREAKLINT_CHROME` set started the
browser and rendered the whole document, and only then failed its cleanup check
(`renderer-not-terminated`, exit 3); a producer was started before its cleanup was refused. Both
now end before anything is started, with exit 3 — the environment cannot run the check, the same
class as a missing renderer — and a message naming the reason; a producer acquisition ends with
`source/producer-incomplete` without running the producer. Unit tests pin both with an injected
platform. Windows support itself is parked, not planned.

**Linux was unmeasured, then measured, and what it showed was a defect.** The first public CI run
failed: the evidence binding broke on every document, because the marks shared a font with the
document's own text and the resulting font-subset difference registered as contamination. The
cause is fixed, and the fix is measured — the full live suite, 57 cases including the hostile
corpus and the independent rasteriser cross-check, is green in a Linux container (arm64, Chromium
151, poppler 22.12), against 15 red cases with the fix removed.

That is no longer only a container result: the fixed commit has since run on the x86_64 CI
runner, where the same step that reported the defect now passes.

**The Linux process lifecycle has now been measured too, and it showed a second defect: zombies
were counted as survivors.** An exited process stays in the process table as a zombie until its
parent collects it. When the parent is PID 1 of a container without an init process — Docker
without `--init`, a GitHub Actions `container:` job, a Kubernetes pod whose entrypoint is node —
that takes seconds or never happens. `kill(pid, 0)` succeeds on a zombie, and `kill(-pgid, 0)` on
a group whose only members are zombies, so the bounded cleanup of the browser tree (2 s) and of a
producer's group (0.5 s + 1 s) ended in "survived" although nothing survived: fail-closed, but in
those environments every live run ended with `renderer-not-terminated` and exit 3. On Linux the
process table is now read from `/proc`, and a process counts as gone only when it reads `Z` with a
single remaining thread (a leader that left with `pthread_exit()` while another thread runs also
reads `Z`, and still counts as alive). The deadlines did not move; a host that never collects
cannot be out-waited.

Measured on one machine, and these are data about that machine rather than promises: a Firecracker
VM, Linux 6.18, 4 vCPUs, whose PID 1 is not an init system and collects exited processes it adopted
on a timer, after 1.02–1.96 s (n = 40); Chromium 141; Node 24. The three process-group unit tests
(the browser tree, a producer descendant on the success path, a producer descendant after a
timeout), 10 isolated runs each under three parents — this VM's PID 1, a subreaper that collects at
once (what `--init`, tini or systemd do) and a subreaper that never collects: before the change 30
of 30 red, 30 of 30 green and 30 of 30 red; after it, 30 of 30 green in each of the three, and
again on the committed code. The one-minute load average was 1.3–4.4 before and 1.8–9.7 after,
because other work shared the machine. Under load one of the three tests also exposed a race of its
own, a SIGTERM landing before the process under test had installed its handler (3 of 10); the test
now arms the handler first. On macOS no process is marked a zombie, and the behaviour there is
unchanged.

**What an interrupted or killed run leaves behind, measured on the same machine.** The real CLI
over a document whose script blocks for 8 s, signalled 1 s after its browser appeared, three runs
per signal, each in a private temporary directory. "Live" counts processes in the browser's
process group that are not zombies, 1 s and 30 s after the CLI ended:

| signal | before: live +1 s / +30 s | before: profile left | before: CLI end | after: live +1 s / +30 s | after: profile left | after: CLI end |
|---|---|---|---|---|---|---|
| SIGKILL | 10–12 / 11–13 | 3 of 3 | killed | 0 / 0 | 3 of 3, removed by the next start-up sweep (3 of 3) | killed |
| SIGINT | 0 / 0 | 3 of 3 | exit 130 | 0 / 0 | 0 of 3 | by SIGINT, 2 of 3; exit 3 once, fixed, then 3 of 3 by SIGINT |
| SIGTERM | 0 / 0 | 0 of 3 | exit 3, 3 of 3 | 0 / 0 | 0 of 3 | by SIGTERM, 3 of 3 |
| SIGHUP | 0 / 0 | 1 of 3 | exit 3, **exit 0**, exit 3 | 0 / 0 | 0 of 3 | by SIGHUP, 3 of 3 |

The one-minute load average was 8–21 before and 5–21 after. The one exit 3 after the change was a
signal that landed while the browser was still starting, at load 10: the failed start reached the
CLI's exit 3 before the handler had raised the signal again. The start-up path now waits for the
handler's decision; a unit test pins it (3 of 3 red without the wait), and three further SIGINT
runs ended by the signal. Before, the browser outlived a SIGKILLed breaklint because a headless
browser on the websocket transport is never told that its client has gone; it now speaks over a
pipe and exits on end-of-file. The driver's own signal handlers left the profile on Ctrl-C, and on
SIGTERM and SIGHUP closed the browser underneath the running render, which then could not verify
its own cleanup (`renderer-not-terminated` in 10 of 18 SIGTERM and SIGHUP runs across this table
and a second series of six each). The exit 0 is the one clean exit in the table and it is the worst
entry in it: an interrupted run that printed nothing and measured nothing; it appeared once in nine
SIGHUP runs, at load 19, and its mechanism was not isolated. breaklint now handles the three
signals itself (how, and for a library host, below): it runs the same bounded, verified close and
profile removal, then raises the signal again, so the process ends by it. A SIGKILL cannot be handled; the next launch's sweep
removes that run's profile, and only such a profile. It removes a `breaklint-chrome-profile-*`
directory only when the owner record written into every profile names this host, this boot and this
PID namespace, the breaklint process it names is gone, and the browser it started is gone (its
process group has no live member, or, without a recorded browser, Chrome's `SingletonLock` names a
dead pid on this host, or, without either, the directory has not changed for a minute). A running
breaklint's profile is kept by the second condition, which a unit test checks against a real
running process.

**An interrupt is decided when it arrives, and a delivered one is never dropped.** The first
version of this handling, in review, lost signals: Node discards a signal that is queued for a
listener removed before the queue is read, and the listener was removed synchronously at the end
of a render and when the launch handed over to the render. A SIGTERM delivered while the render
removed a large profile then let the run finish with a complete report and exit 0 (3 of 3 in a
reviewer's probe, and 2 of 180 signal iterations of the soak below under a never-collecting
parent). Measured, such a signal was lost when the listener went synchronously, in every event
loop phase, and after one `setImmediate` when the removal ran in the I/O phase; it was delivered
after two, in every phase, on Node 24 and 22.13. The render's hold is now taken before the
browser is launched, the listeners outlive the last hold by two `setImmediate` hops, a signal that
finds no hold ends the process by that signal, and the render drains pending signals before it
lets go. Three process-level tests pin it; each is red on the previous version.

The same review found the decision taken at the wrong moment: after the cleanup, when a host's
`process.once` listener had already removed itself, so a host was killed in the middle of its own
graceful shutdown, while a signal-exit style listener (it re-raises only when it is alone) and
breaklint each waited for the other and the host survived its SIGINT. breaklint's listener is now
prepended and counts the host's listeners when the signal arrives. With none, the orderly cleanup
runs and the signal is raised again; with any, breaklint kills its browser's process group and
removes its profile synchronously, before the host's listeners run, removes its own listener so they
see what they would see without it, and the render reports exit 3 with what it could verify. In both
cases a cleanup that could not be verified is reported: on stderr before the re-raise, in the fatal
message otherwise. A forced cleanup whose profile removal failed says so even after the browser's
group was verified gone; it used to report "profile removed" regardless.

A second review found three more ways out. A signal that arrived after the render had let its hold
go, while the report was built and written, was queued for breaklint's listener and then discarded
by the CLI's `process.exit`: SIGTERM 0–15 ms after the profile was removed ended the run with exit 0
in 8 of 9 runs (patched Chromium 141). The CLI now passes one event-loop turn before it exits, and
the library API before it returns, so such a signal ends the process by that signal: afterwards 9
runs under the same conditions all ended by SIGTERM, and in a series of 12 at 20–35 ms each of the 6
that ended with exit 0 had been sent its signal after it had already called `process.exit`, per a
timestamped trace. A process that exits while a hold is live — a library host calling
`process.exit()` in the middle of a run — now forces that hold on the way out (SIGKILL of the
browser's group, profile removal), where it used to leave both to the next run's sweep. And the
library API's producer runs detached, in a process group of its own that a signal to the host never
reaches: SIGTERM to a host without a listener ended the host and left the producer running. The
producer is now held like the browser, from before its spawn until its group is verified gone:
without a host listener its group is cleaned up with the usual bounds before the host ends by the
signal; with one, its group is killed at once and the call returns `producer incomplete: interrupted
by SIGTERM`. A producer is not started at all while another call's interrupt is being cleaned up,
because it would outlive the process that is about to end.

**The browser's own files and its own network.** The browser now keeps its temporary files in the
profile (`TMPDIR` points there), so the profile's removal takes them too: Chromium's
`.org.chromium.Chromium.*` socket directories and Google Chrome's component-download
directories, which were observed accumulating in a shared temporary directory. A Unix socket path
is limited to 107 bytes on Linux and 103 on macOS; where the profile path leaves less than 50
bytes, a short `breaklint-chrome-tmp-*` directory is used instead, recorded in the profile's owner
record and removed with it. On macOS, whether the browser honours `TMPDIR` is not measured here.
The browser also makes requests that page-level interception never sees. Measured on Chromium 141
through this launch path, idle for 8 s: DNS queries and connections to Google hosts for network
time, the account list, AI-mode eligibility, GCM check-in, DNS-over-HTTPS and a search preconnect —
with `--disable-background-networking` already set by the driver. The component updater is off in
every mode (`--disable-component-update`), and every mode adds a lock: every host, a name or an IP
literal, resolves to "not found" before any DNS query except `127.0.0.1` and, with
`--allow-network`, the hosts of the allowed origins; and no proxy is used. With it the browser's
net-log showed one connection, to the loopback document; a unit test requires that in both modes,
against a control browser without the lock that must show browser-level traffic. Two consequences of
the lock in the `--allow-network` mode, where it used to be off: the browser's own services no
longer reach the network there either, and an allowed origin must be reachable without a proxy,
because a proxy resolves and forwards on the browser's behalf and would bypass the lock.

Secure DNS needed its own measure. Its server is addressed by IP literal from the browser's own
provider table, so its queries never reach the resolver lock: CI's Google Chrome 153 connected to
`[2001:4860:4860::8888]:443` under the lock (the net-log test above caught it), and Chromium 141
here logged DoH requests starting between 3 and 5 s after launch. Every profile is therefore created
with the browser-wide preference `dns_over_https.mode: off` in its `Local State`, and the net-log
test now also requires that no DoH request was made, idle for 6 s, against the control without the
preference, which makes them. An administrator's `DnsOverHttpsMode` policy overrides a profile's
preference; on such a host the test is what would show it. The browser's built-in DNS client needs
nothing of its own: it resolves only names that reach the resolver, and the lock maps those first
(no DNS packet in the offline net-log).

The lock works by host, not by origin. Request interception holds the document's ordinary requests
to the allowed origins exactly; what interception never sees — a WebSocket, WebTransport, a worker's
requests, a cross-site iframe, WebRTC — used to reach any host in the `--allow-network` mode, where
the lock was off: on that launch a document's WebSocket, WebTransport and iframe reached 127.0.0.2,
a loopback address that was not allowed, and a WebRTC TURN connection over TCP reached an address on
this machine's non-loopback interface (the unit tests below, each red on it). Now they fail to
resolve unless the host is an allowed one, and a unit test counts no WebSocket, WebTransport or
iframe connection to a host that is not allowed, against a control with that host allowed. They can
still reach any port and scheme of an allowed host: through the real CLI with `--allow-network
http://192.0.2.2:7008`, a WebSocket to port 7007 and a worker's fetch to port 7014 of the same
address connected, while with an allowed host elsewhere none of 23 probe channels reached 192.0.2.2
(patched Chromium 141). An origin whose host is neither a plain DNS name nor an IP literal is left
out of the lock and is then unreachable; an IPv6-literal origin is written into the lock in both
forms the browser compares, which is not measured here (this machine has no IPv6).

A document's WebRTC is not a request that interception sees and needs no host name, so neither of
those stops it on its own: measured on Chromium 141 under the earlier offline launch, a STUN server
at an IP address on this machine's non-loopback interface received 5 UDP packets within 5 s. Every
profile is created with the WebRTC preference `ip_handling_policy: disable_non_proxied_udp` (the
command-line switch for it no longer exists in Chromium 141); with no proxy, the same document sent
no UDP and no TCP, offline and with `--allow-network`, and a unit test holds that against a control
browser without the preference.

A launch also refuses the driver's environment switches that would change the browser's own
switches: `PUPPETEER_DANGEROUS_NO_SANDBOX` (puppeteer-core adds the sandbox-disabling switch) and
`PUPPETEER_TEST_EXPERIMENTAL_CHROME_FEATURES` (it changes the feature switches). Either set, with
any value, ends the run with exit 3 before any browser or profile exists, naming the variable; the
library API returns the same reason, and starts no producer, instead of withholding it as a private
renderer error. breaklint does not remove it from a library host's environment. The other switches
puppeteer-core 25.8 reads are harmless here: `PUPPETEER_WEBDRIVER_BIDI_ONLY` only on a protocol
breaklint does not use, `PUPPETEER_EXECUTABLE_PATH` not at all (breaklint always passes the
executable itself, from `BREAKLINT_CHROME` or its candidate list, so that wins), `NODE_DEBUG` for
logging. The browser itself reads switches from its environment too — measured on Chromium 141,
`CHROME_EXTRA_FLAGS=--remote-debugging-port=9333` opened an unauthenticated DevTools port on the
earlier launch, which passed the host's environment on — so the browser now gets an allow-listed
environment: `HOME`, `USER`, `LOGNAME`, `PATH`, `LANG`, `LANGUAGE`, `LC_*`, `TZ`, `TZDIR`, the XDG
base directories and the three `FONTCONFIG_*` locations, as the host set them, plus `TMPDIR` in the
profile. Nothing else passes, `CHROME_*`, `LD_*` and the proxy variables included. A browser that
needs another variable to start (a custom build that needs `LD_LIBRARY_PATH`) has to be started
through its own wrapper script named by `BREAKLINT_CHROME`; on macOS, whether the browser needs
anything else is not measured here.

Two things this does not cover. A browser crash writes its dump into `~/.config/chromium/Crash
Reports`, outside the temporary profile, and nothing here changes that. And the browser start is
bounded as a whole by `BROWSER_LAUNCH_TIMEOUT_MS`, 30 s: that is a hang guard, not a speed
budget — measured starts took 0.3–2.4 s even with twelve at once — and a start that fails now
reports its elapsed time and the last lines of the browser's stderr.

**What CI has to confirm, and how it can fail.** The `lifecycle-soak` CI job runs the close,
document-timeout, SIGKILL, SIGINT, SIGTERM and SIGHUP paths 20 times each, first under the runner's
own init and then under a parent that adopts re-parented processes and never collects them
(`tests/tools/noreap.py`, the PID 1 of a container without `--init`), and runs the three
process-group unit tests under that parent too. After every iteration it asserts, with a process
reader of its own, that no process of that run's browser group is alive 2 s later, that no browser
process still names the run's private profile root, that no profile directory remains (a SIGKILLed
run's once the next run's browser is up), that an interrupted CLI ended by its signal, and — once
per run, against a live CLI — that a sweep keeps a running breaklint's profile. On this machine,
Chromium 141, both regimes were 120 of 120 green (load up to 17 and 23; 623 zombies held by the
never-collecting parent at the end). On the tree before this change, three iterations each, it was
red on all 18 path runs under the never-collecting parent, for the reasons the tables above give.
Under this machine's own PID 1 the four signal paths were red 3 of 3; close and timeout passed in
the first iteration and failed afterwards only because browsers that outlived earlier kills were
still running. That CI reproduces the same on its current Chrome is the open part.

**What is still unmeasured.** A real container without `--init` (the never-collecting subreaper
reproduces its reparenting, not the container), and every interrupt, kill and sweep path on
macOS.

There is deliberately no `os` field in `package.json`, which means npm will install this on
Windows without complaint. That is not an oversight: `--demo` and the whole rule and reporter
chain need no browser and no process group, so they work there. What does not work is a run over
your own HTML. Blocking the install would take away the part that functions in order to prevent
the part that does not, and the part that does not refuses loudly, before it starts anything.

**Non-HTML input is refused by its name, not by its content.** An input path that does not end in
`.html` or `.htm` — Markdown, PDF, a standalone SVG — ends with exit 2 and `unsupported input type`
before any renderer starts and before the path is even opened; measured for a `.md` file, existing
or missing: exit 2, nothing on stdout. A path that is not a regular file — a directory called
`chapter.html`, for instance — is refused the same way with `input is not a regular file`; through
0.6.0 it passed both checks, started Chrome and ended exit 3 with "resource byte limit exceeded".
The content of a `.html` file is not sniffed. Markdown text
saved under a `.html` name is served and parsed as HTML: one run of body text with no element in
it. Such a run then ends with exit 3 and `geometry-cross-check-failed` ("measured no elements"),
because a cross-check over zero elements is not a passed cross-check (`src/measure/cross-check.ts`)
— measured locally on Chromium 141 with the evidence binding off; the zero-sample rule itself does
not depend on the browser. A converter's HTML output is ordinary HTML and is measured as such. The
paragraph that stood here through 0.6.0 described a Paged.js `pagination aborted` exit 3 for a
Markdown file; that path is gone, because the name check runs first.

**Foreign HTML is executed.** The run uses a fresh browser profile, keeps the sandbox on, has no
flag that disables it, and blocks every network request by default. That is protection against
mistakes and badly built documents, not against a deliberate attack on the browser sandbox. See
[SECURITY.md](../SECURITY.md).

The longer, measurement-by-measurement account of what has been established and what has not is in
[status.md](status.md).

## Raising the number of error rules

The registry's literal `2` is not a constant to be updated when a sixteenth rule feels important. To
change it: name the proof class, ship the fixture that reaches the error path, ship the
non-triggering fixtures the class requires, add the argument to this page, and only then change the
number. The failing registry check is the reminder that the order matters.


## Source-bound 0.5.0 limits

The expanded robustness review is **partial**. Real Digital Product Studio inputs and independent third-party template groups were exercised, but not all admitted candidates paginated successfully. Some W3C/Alice candidates stop with DOM/PDF divergence, pagination residue or source-order mismatch. These are nonmeasurement results. Version 0.5.0 does not claim a complete broad-template robustness pass or increase calibration/trust status.

The screen profile measures the **currently visible viewport rectangle**, including when a full-page screenshot is requested. Below-fold nodes are explicitly excluded; the host must open and check additional scroll states. Authored scroll containers and intentional overlays use named exceptions. Source binding is a verified host-build container when supported, not a JSX line-level source map. Screen reports have no automatic `resolved` repair-comparison path.

Document repair comparison is limited to preserved, unambiguous author anchors, a compatible complete document set, verified local Git continuity and captured actual font identity. Page-only findings remain unmatchable; system/fallback font identity and reduced or absent measurements prevent a repair claim. CSS resources must be captured as dependency/asset inputs; the host's authoring documents are not a resource allowlist.

The real Studio repair attempt was performed by an independent agent. No fresh human usability trial, two-week field trial or measured long-term time saving is claimed. The technical surface gate and visual agent review do not replace the separate human surface ledger.


## 0.6.0 limits

**A per-fragment applicability decision can be silent about a property of the whole element.**
`layout/unbreakable-block-too-tall` skipped every fragment after the first and therefore compared
the height of a *piece* against the page. Measured on 2026-09-18: a six-page `break-inside: avoid`
section came back `clean` at exit 0, fragment 0 reading 596.36 px against a 680.31 px page. That
particular rule now sums its fragments. The **class** is not closed: every rule in this registry
decides applicability per fragment, and any future rule whose quantity belongs to the element
rather than to the piece can repeat this. There is no gate that detects the shape; what caught this
one was a red control that had quietly stopped being red.

**Nothing printed in a page margin box is measured by any block, line or page rule.** Paged.js
implements `position: running(...)` by deep-cloning the element into the margin box of every page,
and `position: fixed` by cloning it into every page box; both clones keep the injected source id.
The collector used to gather blocks from the whole `.pagedjs_page`, so every clone became one more
"fragment" of its source block. Measured on 2026-09-24 with Paged.js 0.4.3: a six-page document
with a one-line running title and an eight-line side running element carried seven records per
element and reported ten `layout/widow` and `layout/orphan` warnings, every one about a clone; under a running header,
the blank page a `break-before: recto` inserts was not blank, both of its boundaries came out
`overflow`/`forced` instead of `parity`, it drew a `layout/orphaned-continuation-page` finding, and
every page was anchored to the header, so three `layout/half-empty-page` findings on three pages
shared one fingerprint. An earlier repair of the one symptom that could fail a build —
`layout/unbreakable-block-too-tall` summing the clones — decided flow membership in that rule by
coordinates, and that test also discarded every fragment of a full-bleed block (see below).

The snapshot, the collector and the evidence overlay now all keep only source blocks inside a
page's content area, `.pagedjs_pagebox > .pagedjs_area`. That area holds the page content **and the
footnote area**: footnotes stay part of the page they are printed on, as before. It is an inclusion
test on the page structure rather than an exclusion by class name, so author markup that happens to
carry a `pagedjs_margin` class does not leave the flow, and a page with no content area stops the
run (exit 3) instead of being measured as empty. What that leaves unmeasured, stated because no rule
reports it:

- **Margin-box content.** A widow, an oversized block or an unfilled band inside a running header or
  footer is not judged. Generated margin content (`@top-center { content: "…" }`) never was.
- **A running element keeps exactly one record**: the in-flow original Paged.js leaves in the page
  content with an inline `display: none`. Snapshot 5 records each block's computed `display` and how
  many margin-box copies of it Paged.js printed (`marginCopies`), so the block rules that could
  select the original — `layout/unbreakable-block-too-tall`, `layout/heading-at-page-bottom`,
  `type/excessive-word-spacing` — record it as `excluded` with the reason
  `rule/target-in-margin-box`, outside the coverage base, and never as measured. Until this repair
  it counted as measured at 0 px, and a document whose only avoid block was a running element
  reported full coverage for a check that looked at nothing. An element the author hid
  (`display: none`, no margin copies), or one inside a hidden subtree or a closed `<details>`, is
  `rule/target-not-rendered`. The type rules still read a running element's source text once,
  attributed to that hidden position, where there is no box for evidence to mark. A page is
  anchored to its first rendered block, so the hidden original never anchors one.
- **A `display: contents` block is judged by what it prints, never by its zero box.** It generates
  no box of its own while its text and children are laid out. `layout/unbreakable-block-too-tall`
  asks about a box, and `break-inside` does not apply to an element without one, so such a block is
  `not-applicable` with the reason `rule/target-generates-no-box`, outside coverage; its children
  are candidates in their own right. (An unreleased intermediate state declined it against
  coverage instead, and a key/value grid whose `li` items were flattened with `display: contents`
  under a print rule `li { break-inside: avoid }` ended exit 4 with twelve declines, where it had
  ended exit 0.) An
  image-only `display: contents` figure is the same case, not an unrendered one.
  `layout/heading-at-page-bottom` places such a heading, and a block below it, by its visible line
  boxes; with no visible line but recorded lines it is excluded as `rule/target-not-visible`, and
  with no line or unrecorded lines it is declined as `env/invalid-measurement`, counted.
  `type/excessive-word-spacing` reads the visible lines of every block: lines that are all
  invisible are `rule/target-not-visible`, a block with no line at all (empty, or image-only) is
  `rule/no-text-lines`, and lines the snapshot did not record are declined as
  `env/invalid-measurement` — never a measurement of factor 0.
- **A box of zero by zero is not by itself "not rendered".** A block counts as not rendered only
  when the snapshot shows nothing printed from it: `display: none`, or recorded lines none of which
  is visible (an element inside a hidden subtree or a closed `<details>` has no line box). A
  zero-size block that is neither — `width: 0; height: 0; overflow: visible` prints its text
  outside the box, or its lines were not recorded — is placed by its visible lines where the rule
  reads positions (`layout/heading-at-page-bottom`, and the continuation rule's flow), measured
  from its lines by `type/excessive-word-spacing`, and declined as `env/invalid-measurement`,
  counted, by `layout/unbreakable-block-too-tall`, whose question is the height of a box that
  printed nothing of its own. A line is visible when any text on it is: visibility is read from
  each text node's element, so `p { visibility: hidden } span { visibility: visible }` prints and
  is measured. What remains: `layout/unbreakable-block-too-tall` still reads the BLOCK's own
  visibility, so a hidden block with a visible descendant is excluded there as not visible.
- **A split block is judged at the first fragment that printed.** `layout/unbreakable-block-too-tall`
  takes the block's lead fragment to be the first one laid out with a box of its own and visible,
  joined by source id; earlier fragments are recorded `not-applicable` as
  `rule/fragment-not-rendered`. Measured on 2026-09-25 with hostile documents: a script that set
  `display: none` on only the first fragment of a four-page avoid block, or marked it as a note and
  moved it into the footnote area where it has no box, hid the whole block (exit 0, where the base
  reported it at exit 1), because the later fragments were skipped as continuations of an excluded
  candidate. What remains: a script that hides EVERY fragment hides the block, which is then also
  not printed; a script that changes the first printed fragment's own `break-inside` changes the
  question the rule asks; and a two-fragment block whose first fragment is hidden is judged by the
  second fragment's box alone, as every two-fragment block is (see the rule page).
- **A `position: fixed` element is not measured at all.** Paged.js removes it from the flow, so there
  is no in-flow original, and its per-page clones are outside the content area. (An element whose
  `position: fixed` is an INLINE style is not recognised by Paged.js at all: it stays in the flow,
  is measured there, and is painted at the viewport origin, where its evidence marks cannot be
  placed.)
- **Markup that reproduces the page structure inside a running element comes back into the flow.**
  The test asks whether an element has an ancestor that is the area child of a page box. A running
  element whose own markup contains `<div class="pagedjs_pagebox"><div class="pagedjs_area">` makes
  its descendants pass that test in every margin-box clone, so they are measured once per page again
  — the pre-repair behaviour, with its false `layout/widow` findings and shared fingerprints, for that markup only.
  It cannot hide flow content from measurement: that would need an element of the real content area
  to lose the ancestor it has. A class name alone (`pagedjs_area` without the page-box parent) does
  not pass the test.
- **Inline SVG inside a margin box is still collected once per page, and SVG text there stops the
  run.** The SVG collector still reads the whole page, so a running element that contains an SVG
  contributes one SVG record per page, all with one key. When that SVG carries `<text>` and the
  element repeats on two or more pages, every clone carries the same injected target id,
  `svg/text-overflows-viewport` sees one target evaluated twice, and its accounting invariant ends
  the run `checker-crashed` (exit 3). Measured on 2026-09-24 on a three-page document with a
  running logo; it predates the flow repair above and is not changed by it.
- **Footnotes are in the flow, but a document with footnotes does not reach the rules.** Measured on
  2026-09-24 with the real paginator: a block footnote moved into the footnote area is recorded on
  its page and is an edge of that page's flow, and the source-id check accepts its position after
  the page content (`tests/live/breaks.test.ts`). The production run stops before any rule, though:
  Paged.js gives each footnote call an `href` built from the paginator's per-run random `data-ref`,
  the paired control run reads that as a changed resource, and the run ends
  `injection-interference` (exit 3). That holds for block and inline footnotes alike, before this
  repair and after it. Before it, a block footnote already stopped the run one step earlier, at
  the source-id order check.

**The source-id integrity check reads the order of the flow; copies outside it are checked for
identity, presence and the signature of the Paged.js step that put them there, not for order.**
Paged.js puts three kinds of copies out of source order: a running element's clones in the margin
boxes (which come before the content area in every page box), a block footnote in the footnote area
(after the page content) and a `position: fixed` clone at the head of every page box. The check used
to read every source id in the document in document order, so a running title that was not the
first element of the source — a heading before it, or a section around it — ended the run
`checker-crashed` (exit 3). What still fails the run: any attribute change of a reserved id,
anywhere; an unknown id, in the flow or out of it; an expected id that is nowhere; a flow whose
order differs from the source; an id found only in margin boxes, without the in-flow original every
running element keeps; an id in the footnote area outside an element Paged.js marked as a note
(`data-note="footnote"`); and an id in a page box that is not on every page, sits after the page's
content area, or also occurs in the flow — none of which Paged.js produces for a `position: fixed`
element. Each of those is an element a script moved out of the flow. What the signature cannot
tell apart is a script that reproduces it exactly — marks an element as a note before Paged.js moves
it, or clones it into the head of every page box and removes the original.

**Evidence marks follow the same boundary, and three kinds of page still cannot bind.** The overlay
places no mark on a margin-box or page-box clone: no finding can target one, and requiring a mark
for it left every page of a document with a running header unbound, so that the default run
(evidence binding on) ended exit 4 — measured on 2026-09-24 before this repair, with 24 unplaced
marks on a six-page document with two running elements. A fragment that bleeds into the side margin
is marked where it is printed, inside the page box; before this repair all 212 marks of a full-bleed
document were refused; measured after it, every one of the 212 is laid out exactly where the overlay
recorded it and inside the page box. Whether the PDF text layer then returns each mark at that
position can only be checked on a browser whose PDF carries the marks: the Chromium 141 build these
repairs were developed on writes a PDF with no mark in it at all, in the margin or not, so that
half is established by the live suite on current Chrome in CI and nowhere else. What does not bind,
and so ends a run with evidence binding on at `insufficient-coverage` (exit 4):

- a page whose flow contains a fragment pulled ABOVE or below the content box (a negative top
  margin, content hanging past the column): down the page a mark must lie inside the content box,
  so that mark is refused, and a fragment with no mark on its page leaves the page unbound. The
  bound is a conservative choice, not a measured necessity: the marks hang in Paged.js'
  multi-column fragmentainer, and on Chromium 141 a mark positioned above or below it printed at
  its DOM position; the vertical bound was kept rather than rely on that for every browser;
- a page carrying a footnote-area block, for the same reason (the footnote area lies below the
  content box) — moot today, because footnotes stop the run earlier;
- **a page with no source block at all, such as the blank page a `break-before: recto` inserts.**
  A page binds only on marks it carries (`src/render/evidence.ts`), and required evidence is
  complete only when every page binds (`src/core/engine.ts`), so every document with a
  parity-blank page ends exit 4 under evidence binding, with or without running elements. That is
  the evidence contract as it stands, read from the code; the margin-box repair did not change it.

**A page is anchored to the first block that starts on it.** A block that spans pages — `<main>`,
`<article>`, a section, a full-bleed block — has a fragment on every page it covers, and as an
ancestor it comes first in document order, so it used to anchor every one of those pages: the page
findings on them shared one fingerprint. Now the first block whose first fragment is on the page
anchors it. Only a page on which nothing starts — the middle of a single block taller than a page —
falls back to its first continuing block, and two such pages of the same block share an anchor. A
wrapper that starts on page 1 still anchors page 1, keyed by its author id or, without one, by the
signature of all its text, so without an id that page's fingerprint follows any edit inside the
wrapper.

**How often oversized `break-inside: avoid` blocks occur in real documents is not measured.** The
repair is arithmetically correct and conservative, but its frequency in the field is unknown, so
how much this changes in practice for a given project is unknown too. A project that sees a new
`error` after upgrading is seeing a block that never fitted; that is all this version claims.

**A two-fragment split is measured but never reported, and that is a proof obligation.** Paged.js
does not fragment natively — it produces two DOM elements — so `box-decoration-break` does not
apply here at all. What strips decoration at a split is Paged.js' own stylesheet, and it unsets
`margin` and `padding` on `[data-split-from]`/`[data-split-to]` but **not** `border`, and without
`!important`. A bordered block that is split therefore carries its border height once per fragment,
and an author rule with `!important` padding does the same — so two fragments can sum above the
page for a block that fitted unsplit. From three fragments on that cannot happen: an intermediate
fragment fills an entire content box and there is content before and after it, so the block is
taller than one page by construction. **The residual gap is a block split into exactly two
fragments whose real height does exceed the page: it is not reported, and the value recorded for it
is the first fragment's box rather than the sum** — exactly as in 0.5.0, and stated here because a
reader of the summed-height paragraph above would otherwise assume the sum is recorded everywhere. The residual risk
in the other direction is a block with borders thicker than the content of its own outer fragments,
which would have to be several tens of pixels per edge.

**The boundary is the content box of the page the block was laid out on.** Comparing against the
largest content box in the document was tried and is worse: in a document with a named landscape
page it raises the bar for every block on the portrait pages and hides real ones. What is observed
is that this block did not fit unbroken on this page, and that is what the finding says — it no
longer claims anything about pages it did not measure. A block that would have fitted on a
differently sized page elsewhere in the document is still reported, because it still broke its own
`break-inside: avoid` where it was.

**Flow membership is decided by page structure, never by coordinates, so a fragment that bleeds
into the margin still counts.** `layout/unbreakable-block-too-tall` sums every record carrying the
element's source id. A coordinate test ("a real fragment starts inside the content box") cannot tell
a margin box from a fragment that bleeds into the margin: measured on 2026-09-24, a
`break-inside: avoid` block with negative side margins had all six fragments at x = 18.91 against a
content box at x = 56.69, the filter discarded every one of them, the first fragment (335.81 px
against 340.16 px) was measured instead of the 1865.61 px sum, and the document came back `clean`.
It is reported again.

**Fragments are correlated by authoring-source id, and a split block that cannot be correlated is
declined, not measured on one piece.** A split block whose fragments carry no `sid` — every block of
a `--no-source-map` run, or an element a script created — has nothing to join its fragments by, and
neither has one whose sid does not account for exactly the fragments the snapshot counted.
`layout/unbreakable-block-too-tall` used to measure the first fragment of such a block, which
compares a piece with the page and can call a six-page block clean. It now declines it as
`env/invalid-measurement`, which counts against the rule's coverage floor: the run ends
`insufficient-coverage` (exit 4) rather than `clean`. An unsplit block without a sid is the whole
block and is still measured. In a `--no-source-map` run a split block does not reach the rule today:
measured on 2026-09-24, the sid-less source join refuses it first (`checker-crashed`, exit 3). The
decline is what remains once that join can join fragments.

**Naming an off-by-default rule in a config file turns it on, even with only options.** `rules` is
read as "the caller has an opinion about this rule": `false` disables, anything else enables, and
that includes an options object such as `{ "layout/half-empty-page": { "minNetFill": 0.4 } }`. For
the twelve rules that are on anyway this is invisible; for the one that is not, it means tuning it
also activates it. That is the intended reading — configuring a rule you do not want is not a
thing anyone does — but it is not obvious, so it is written down.

**`kill(pgid, 0)` answering `EPERM` is read as indeterminate, not as failure.** Measured on darwin
25.6.0, macOS answers `EPERM` transiently for a process group this process created and owns while
that group is being torn down — 8 of 20 acquisitions, every one followed within 10 ms by `ESRCH`
with the descendant dead. The producer cleanup therefore retries inside its existing bounded
deadline instead of failing on the first sample. What this does NOT establish is the kernel reason
for the answer; the behaviour is measured, not explained, and it was measured on one platform and
one version. An `EPERM` that outlives the deadline still fails the acquisition. The retry and the
deadline expiry used to have no test, because they lived in closures that ran only when an
environment happened to produce `EPERM`. They are now one exported function with a seam for the
kernel, the clock and the group's members, and `tests/unit/producer-boundary.test.ts` pins them on
a fake kernel and a fake clock: "retries EPERM inside the deadline and accepts the ESRCH that
follows (retry path)", "fails an EPERM that outlives the deadline as unverifiable, after SIGKILL
(deadline path)", the unknown-errno and signal-delivery cases, and the zombie reading described
under the Linux process lifecycle above. Each names the mutation that turns it red, and each
mutation was run and observed red. The budgets are unchanged. One hypothesis is not settled and
needs a macOS run: that this `EPERM` is XNU's answer for a group whose members are exiting or
already zombies, the window that Linux answers with success instead. Sampling `ps -o pid,stat` of
the group at the moment `EPERM` comes back would settle it.

**Page fill counts glyph boxes, not line boxes, and has no ceiling.** `netFill` merges the
vertical bands of every text run's client rectangles — the glyph content area, not the line box —
and of replaced elements, and divides by the content box height. Half-leading and block margins
never enter it, so a page no further line would fit on reads roughly glyph height over line pitch,
which the font and the leading set. Measured on full pages that are not the last of their document
(Chromium 141 on Linux, Paged.js 0.4.3, the machine's default serif and sans-serif; not re-measured
on the current Chrome that CI runs): 0.58–0.72 at `line-height: 1.5`, 0.51–0.54 at 2, 0.34–0.36 at
3 (12 pt on A5 and 11 pt on A4). Both page-fill rules read this quantity. `layout/half-empty-page`
cannot separate a full page from a sparse one near its 0.60 threshold, and stays experimental and
off by default. `layout/orphaned-continuation-page` judges only a page whose content ends on it:
the next page does not open with its text running on, because a page whose text runs on and opens
the next page stopped for want of room. On a page it does judge it still reads net fill, so at
`line-height: 3` every such page falls below its 0.50 threshold however full it is and whatever
follows it: measured, 11 of 13 lines before a figure that did not fit read 0.29, and a tail page
filled to its last line 0.34. The "running on" test relies on the collector keeping margin-box
content out of the snapshot, as this release's collector does: a clone in a side margin box lies
inside the content box and would count as running text. A line-box fill, each text rectangle
widened to its line height, is the named next step for the net fill. It changes the snapshot shape and the quantity
behind the public options `minNetFill` and `maxNetFill`, which needs an owner decision, and it is
not in this release. None of these readings is a calibration.

**The 40-document corpus behind the `layout/half-empty-page` default is not in this repository.**
The 37-of-40 figure was measured on a corpus constructed for that purpose during the same work, and
it is not admitted here, not hashed here and not reproducible from this repository. Every place that
cites the number says "a corpus constructed for this purpose"; this paragraph says the rest of it.
The decision it supports is reversible by configuration and moves no exit code either way, which is
why it was taken on that evidence — the same standard would not have been enough for a gating rule.
