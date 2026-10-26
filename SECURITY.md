# Security

## Reporting a vulnerability

Report privately, not in a public issue: **security@dargel-solutions.de**.

Please include the version, the operating system, and — if the finding involves a document — the
smallest HTML that reproduces it. The maintainer's response target is 72 hours; this is a human
service target, not an automated or contractual SLA. If a fix is warranted, the advisory names the
reporter unless the reporter asks otherwise.

There is no bounty programme.

## The threat model, stated plainly

**This tool executes foreign HTML, including its scripts.** That is not a side effect to be
engineered away — it is the job. Whether a page works can only be decided after the renderer and
the paginator have run, and both run the document's own code.

What the tool does about it — each of these is checked in the test suite rather than merely
intended, and each says what it does not cover:

- **A fresh browser profile per run**, created with `mkdtemp` and removed afterwards. A run that
  cannot verify its own cleanup fails rather than reporting success.
- **breaklint never asks for the sandbox to be off and rejects known driver overrides.** The one
  browser launch in `src/acquire/browser.ts` passes no switch at all (`args: []`), no code path,
  tool, test or workflow of this repository passes `--no-sandbox` or any other sandbox-disabling
  switch, and breaklint has no option or flag that turns the sandbox off.
  `tests/unit/sandbox-boundary.test.ts` holds both: it reads that launch call with the TypeScript
  parser and allows only named options that cannot touch the sandbox, with `args: []`, and it scans
  `src/`, `tools/`, `tests/` and the workflows for the switches. What that test cannot see is the
  process environment by itself. Puppeteer-core reads `PUPPETEER_DANGEROUS_NO_SANDBOX` and
  `PUPPETEER_TEST_EXPERIMENTAL_CHROME_FEATURES` from that process before spawning Chrome. If
  either is present, breaklint refuses the renderer with exit 3 before launch. The child environment
  omits `CHROME_EXTRA_FLAGS` so a Chrome wrapper cannot turn it into a switch. Tests cover the
  refusal and the scrubbed child environment. Other browser or wrapper variables are not proven
  safe by these three checks; isolate untrusted HTML at the operating-system boundary. The Action
  uses the same launch path and its empty `allow-network` input does not add sandbox or network
  isolation.
- **The page's requests are intercepted, and the default policy is `offline`.** Request
  interception is on, and only the tool's own loopback origin plus `data:`, `blob:` and `about:`
  are let through; `--allow-network <origin>` lets one more origin through per use. **This is not
  a network block.** Interception sees the requests the browser routes through it and nothing
  else. Not covered, in the default mode or with `--allow-network`: WebSocket, WebTransport and
  WebRTC connections a document opens, and the browser's own traffic — secure DNS (DNS over HTTPS)
  and the component updater. Measured on 0.7.0 in the default offline mode with a self-authored
  document: a WebSocket to a loopback port that was not the tool's was delivered, a WebRTC STUN
  request was sent, and the run came back `clean`. **For a document you do not trust, run
  breaklint in a container or network namespace with no egress;** that, not this policy, is what
  keeps data on the machine.
- **Known Paged.js text-loss styles are refused.** The computed print style is read from the
  source tree before pagination. A multi-column `body` (including `column-count: 1` and
  `columns: 1`) or a nonempty `display: contents` heading produces a fatal diagnostic and exit 3.
  This is conservative: a short heading that happens to print in full is refused too. It does not
  establish a general PDF/source text-completeness guarantee; other multicolumn and footnote
  cases remain open in [limitations](docs/limitations.md).
- **No browser-wide file-access switch.** The document is served from a loopback origin instead. A
  test measures that a document loaded this way cannot read a neighbouring file, because removing
  the reason for a switch and leaving the switch in place is a mistake that was actually made here
  once.
- **The measurement primitives are captured before any author script runs.** The regression suite
  covers documents that replace `getBoundingClientRect` or `getComputedStyle` after pagination and
  requires those attempts either to leave the captured measurement intact or to fail the run. This
  is measured protection for those interference paths, not a claim that every future browser API
  attack has already been enumerated.
- **The document's Content Security Policy remains authoritative.** The measured Paged.js bundle
  crosses the browser-driver boundary only after authored loading. breaklint does not disable CSP
  browser-wide merely to install its own apparatus; its own CSP-bearing HTML report is the live
  regression for that boundary.
- **No model, no network client, no telemetry in breaklint itself.** The only runtime dependency
  is an HTML parser, and breaklint uploads nothing. That is a statement about breaklint's own code,
  not about the document it runs: a document's scripts can still reach the network through the
  channels named above unless the machine denies egress.

**What this is not.** None of the above is protection against a determined attack on the browser
sandbox itself, and the request policy above is not an egress control. For untrusted third-party
HTML, run this in a container or network namespace with no network egress, the same way you would
run any other tool that executes code you did not write.

## Dependency-hygiene exception: Paged.js 0.4.3

The stable Paged.js package still declares `@babel/polyfill`, which in turn retains the obsolete
core-js 2 line. The current dependency audit reports no known vulnerability, and breaklint's
measured integration loads Paged.js's browser bundle rather than importing those polyfill modules
as application code. The available 0.5.0 beta retains the same polyfill dependency, while a larger
unmeasured upgrade would cross the paginator trust boundary and invalidate the current live,
visual, consumer and supply-chain evidence.

This is a time-bounded dependency-hygiene risk acceptance, not a claim that obsolete transitive
packages are desirable. Re-review is due by **2026-11-24**, or earlier if Paged.js publishes a
compatible stable release without the chain, an advisory reaches the installed runtime path, the
bundle/import surface changes, or Node/browser support changes. Any replacement must pass the full
live, visual, consumer, licence, advisory and release-integrity gates before the pin moves.

## Advisory exception: the puppeteer-core 25.8.0 consumer pin

GHSA-mrhx-c7xc-m3w5 (zod below 4.6.6, high, uncontrolled memory use while validating oversized
collections) entered the GitHub Advisory Database on 2026-10-23. puppeteer-core 25.8.0 through
25.12.0 pin `chromium-bidi` 17.0.2, which requires zod 3, and every zod 3 release is in the affected
range; 25.13.0 is the first version whose chain admits a fixed zod. Released breaklint still points
consumers at 25.8.0 in three places: the Action installs exactly `puppeteer-core@25.8.0`, the
documented install commands name it, and the peer range `>=25.8.0 <26` admits it.

breaklint drives Chrome over the Chrome DevTools Protocol. Its one launch in
`src/acquire/browser.ts` sets no `protocol` option, and in puppeteer-core 25.8.0 `chromium-bidi` is
imported only by its BiDi-over-CDP module, which is loaded dynamically for a `webDriverBiDi` session
alone. breaklint's runs therefore never load zod. The published runtime graph (parse5, entities)
carries no advisory, and this repository's development lockfile resolves a chain with a fixed zod
and audits clean.

This is a time-bounded acceptance for the consumer pin, not a claim that the chain is harmless. The
pin moves with the next release, through the same full gates named above: the Action and the
documented installs move to a puppeteer-core version whose tree audits clean, the peer floor rises
to at least 25.13.0, and the packed-consumer steps of CI and the release workflow follow. Re-review
is due with that release and no later than **2026-11-24**, or earlier if breaklint starts a
WebDriver BiDi session or the advisory is shown to reach the CDP path.

## Advisory drift

Advisories reach the dependency graph without a commit here. `npm run test:advisories` audits the
published runtime graph and the complete development graph and separates three outcomes: no
advisory (exit 0), an advisory (exit 1, naming each package, its GHSA ids, the chain that pulls it
in and whether a fix exists within the declared ranges) and an audit that did not run because the
registry was unreachable or the time limit passed (exit 75, never 0). With Dependabot security
updates enabled for the repository, `.github/dependabot.yml` makes them lockfile-only pull requests:
they move locked versions inside the declared ranges, never change a range or a consumer pin, run
the complete CI and are never merged automatically.

## Scope

In scope: anything that lets a checked document escape the sandbox, read files outside the run,
reach the network against the policy, survive past cleanup, or cause the tool to report a clean
result for a document it did not actually measure — the last one included deliberately, because a
checker that can be made to go green is a security problem in the build it is guarding.

Out of scope: findings that are wrong because a threshold is wrong. Every threshold here is
uncalibrated and says so; a false positive is a bug, not a vulnerability.

## Supported versions

Only the latest version published on npm receives fixes; a fix ships as a new version, and no
older line has a long-term-support branch. The package is pre-1.0, so a fix can arrive in a new
minor version rather than a patch. Every published version carries npm provenance (checked on
2026-09-24 with `npm view breaklint@<version> dist.attestations` for 0.1.0 through 0.6.0). The npm
package page, or `npm view breaklint dist-tags.latest`, is the authority on which version is
currently the latest.


## Host-provided sources and pages

The producer API executes only an explicitly host-controlled executable. A document, imported manifest or report never selects that executable or authorizes a command. Manifest declarations are checked against captured producer bytes and copy records; unknown source locations remain unknown. Host receipts provide integrity and correspondence within a trusted local build process, not producer attestation against a dishonest host.

The screen API operates on a Page already opened by its host. Navigation, login, server access and network policy remain host-owned. This capability is intended for trusted E2E preparation; it does not make an arbitrary hostile browser realm safe. Unsupported visibility/paint, unstable capture and incomplete inventories are reported as nonmeasurement. The report and bounded AI context treat document text as untrusted data and expose a finite repair vocabulary. Portable evidence copies use bounded capture and current hashes; historical capture claims and current bundle availability are distinct.
