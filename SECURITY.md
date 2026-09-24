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

What the tool does about it, and each of these is checked in the test suite rather than merely
intended:

- **A fresh browser profile per run**, created with `mkdtemp` and removed afterwards. A run that
  cannot verify its own cleanup fails rather than reporting success.
- **The browser sandbox stays on.** The one browser launch in `src/acquire/browser.ts` passes no
  switch at all (`args: []`), no code path, tool, test or workflow passes `--no-sandbox` or any
  other sandbox-disabling switch, and there is no flag that turns the sandbox off.
  `tests/unit/sandbox-boundary.test.ts` holds both: it pins that launch call and scans `src/`,
  `tools/`, `tests/` and the workflows for the switches.
- **The network is blocked by default.** Request interception is on, the default policy is
  `offline`, and only the tool's own loopback origin plus `data:`, `blob:` and `about:` are let
  through. `--allow-network <origin>` opens exactly one origin per use and nothing else.
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
- **No model, no network client, no telemetry.** The only runtime dependency is an HTML parser.
  Nothing is uploaded, and nothing about your documents leaves the machine.

**What this is not.** None of the above is protection against a determined attack on the browser
sandbox itself. For untrusted third-party HTML, run this in a container, the same way you would run
any other tool that executes code you did not write.

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
