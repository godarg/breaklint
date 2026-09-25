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
- **The browser sandbox stays on.** The one browser launch in `src/acquire/browser.ts` passes only
  network and diagnostics switches, none of which touches the sandbox; no code path, tool, test
  or workflow passes a sandbox-disabling switch; and there is no flag that turns the sandbox off.
  The driver itself would add one when the environment variable `PUPPETEER_DANGEROUS_NO_SANDBOX`
  is set, so a launch with that variable set (or `PUPPETEER_TEST_EXPERIMENTAL_CHROME_FEATURES`,
  which changes the browser's feature switches) does not start: it ends with exit 3 and names
  the variable, and the library API returns that reason and starts no producer. breaklint does
  not edit a host's environment to get around it. The browser reads switches from its own
  environment as well (`CHROME_EXTRA_FLAGS` carried a DevTools port, and would carry the
  sandbox-disabling switch, into a launch that passed the host's environment through), so the
  browser is started with an allow-listed environment only: `HOME`, `USER`, `LOGNAME`, `PATH`,
  `LANG`, `LANGUAGE`, `LC_*`, `TZ`, `TZDIR`, the XDG base directories and `FONTCONFIG_FILE`,
  `FONTCONFIG_PATH`, `FONTCONFIG_SYSROOT`, as the host set them, and `TMPDIR` pointing into the
  profile. Nothing else of the host's environment, `CHROME_*`, `LD_*` and proxy variables
  included, reaches it. `tests/unit/sandbox-boundary.test.ts` holds all of it: it reads the launch
  call with the TypeScript parser and allows only named options, named, allow-listed switches and
  the allow-list builder as the environment, requires the environment refusal before the launch,
  runs the CLI with the variable set against a fake browser that records its switches, runs it
  with `CHROME_EXTRA_FLAGS` and other switch-carrying variables set against a fake browser that
  records its environment (with a control that passes the environment through and sees them),
  and scans `src/`, `tools/`, `tests/` and the workflows for sandbox-disabling switches. A real
  browser test holds that an inherited `CHROME_EXTRA_FLAGS=--remote-debugging-port=…` opens no
  port and is absent from the browser's `/proc/<pid>/environ`; its control, the driver with the
  environment passed through, opens the port on Chromium 141 (a browser that does not read the
  variable leaves the environ check alone).
- **The network is blocked by default, for the document and for the browser itself.** Request
  interception is on, the default policy is `offline`, and only the tool's own loopback origin
  plus `data:`, `blob:` and `about:` are let through. Interception sees only the document's
  ordinary requests, and the browser makes requests of its own: measured on Chromium 141 through
  this tool's launch path, within seconds of starting, DNS queries and connections to Google hosts
  for network time, the account list, AI-mode eligibility, GCM check-in, DNS-over-HTTPS and a
  search preconnect, and in CI Google Chrome's component updater downloaded files. So the browser
  is started with `--disable-component-update` and `--disable-background-networking`, and in
  every mode also with `--host-resolver-rules` and `--no-proxy-server`: every host, name or IP
  literal, resolves to nothing before any DNS query except the loopback address
  (`MAP * ~NOTFOUND , EXCLUDE 127.0.0.1`) and, with `--allow-network`, the allowed origins' hosts
  (`, EXCLUDE <host>` each); no proxy forwards on the browser's behalf, so `--allow-network`
  origins must be reachable without one. Secure DNS is off in every profile (`Local State`:
  `dns_over_https.mode` `off`), because it addresses its server by IP literal and so bypasses
  the resolver map: on CI's Google Chrome 153 it connected to `[2001:4860:4860::8888]:443` under
  the map. An administrator's `DnsOverHttpsMode` policy overrides that preference. A unit test
  reads the browser's own net-log and requires, in both modes, that it connected nowhere but
  loopback and used no secure DNS, against a control browser without the lock and profile that
  shows both. `--allow-network <origin>` lets the document's intercepted requests reach exactly
  that origin. Below interception the lock works by host, not by origin: channels interception
  does not see — a WebSocket, WebTransport, a worker's requests, a cross-site iframe, WebRTC —
  reach no host that is not allowed (a test counts none from a WebSocket, WebTransport and an
  iframe, against a control with the host allowed), but they can reach any port or scheme of an
  allowed host. A document's WebRTC is neither a request interception sees nor always a host
  name to resolve: measured on Chromium 141, its STUN packets reached an IP address on a
  non-loopback interface under the earlier offline launch. Every profile is therefore created
  with the WebRTC preference `disable_non_proxied_udp`; with no proxy, a test counts no UDP and
  no TCP from the same document, offline and with `--allow-network`.
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
