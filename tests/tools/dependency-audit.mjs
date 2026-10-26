#!/usr/bin/env node
/**
 * Dependency hygiene: both dependency graphs carry no known advisory, the Node/Puppeteer contract
 * holds, and the configuration that repairs advisory drift is in place.
 *
 * THREE OUTCOMES, NOT TWO. An advisory database changes without a commit here, so this check can
 * turn red on an unchanged tree, and whoever reads the red run has to know at once which of three
 * things happened:
 *
 *   clean        exit 0   npm audit returned a report with zero advisories for both graphs.
 *   advisory     exit 1   a report names advisories. Every vulnerable package is printed with its
 *                         severity, affected range, GHSA ids, the chain that pulls it in and
 *                         whether a fix is available, so the red run explains itself.
 *   unavailable  exit 75  npm audit returned no advisory report at all: registry, network, an
 *                         unparseable answer or the time limit below. EX_TEMPFAIL, never 0 — an
 *                         audit that did not run is not a clean audit — and never 1, because it is
 *                         not a finding about the dependencies.
 *
 * The first version of this file asserted `status === 0` and called every other status "has an
 * advisory". npm audit also ends with status 1 when it cannot reach the registry, and then prints
 * `{message, error}` and no report. On 2026-10-22 a run took 640 s and reported an advisory in a
 * runtime graph that had none; a closed loopback registry reproduces that message in one second.
 *
 * A contract violation (manifest ranges, Dependabot configuration) is exit 1 as well.
 *
 * `--self-test` runs the classification over npm outputs recorded in tests/fixtures/audit/, checks
 * the Dependabot contract against accepted and rejected configurations, and runs real npm audit
 * against a closed loopback port, both directly and through this script.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURES = fileURLToPath(new URL("../fixtures/audit/", import.meta.url));

export const EXIT = Object.freeze({ clean: 0, advisory: 1, unavailable: 75 });

// npm's own defaults allow 300 s per request and two retries, so one unreachable registry could
// hold a single audit for a quarter of an hour. These bound each request; the process limit below
// bounds the whole call, whatever npm does inside it.
const NPM_FETCH_ARGS = ["--fetch-timeout=60000", "--fetch-retries=1"];
export const AUDIT_TIME_LIMIT_MS = 180_000;

const GRAPHS = Object.freeze({
  runtime: { args: ["--omit=dev"], label: "the published runtime dependency graph" },
  full: { args: [], label: "the complete development dependency graph" },
});

// --- classification ----------------------------------------------------------------------------

const unavailable = (reason) => ({ outcome: "unavailable", reason });

/**
 * One npm audit run, classified. Input is what spawnSync returned (or a recorded fixture of it);
 * nothing here runs a process.
 */
export function classifyAudit({ status = null, stdout = "", signal = null, error = null }) {
  if (error) {
    const timedOut = error.code === "ETIMEDOUT";
    return unavailable(
      timedOut
        ? `npm audit did not finish within ${AUDIT_TIME_LIMIT_MS / 1000} s and was stopped`
        : `npm audit could not be run: ${error.code ?? error.message}`,
    );
  }
  if (signal) return unavailable(`npm audit was stopped by ${signal}`);
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    return unavailable(`npm audit printed no JSON report (exit ${status})`);
  }
  if (report === null || typeof report !== "object" || Array.isArray(report)) {
    return unavailable(`npm audit printed JSON that is not a report (exit ${status})`);
  }
  const counts = report.metadata?.vulnerabilities;
  const total = counts?.total;
  if (report.error || !Number.isInteger(total) || total < 0) {
    const said = typeof report.message === "string" && report.message ? report.message : report.error?.summary;
    return unavailable(`npm audit returned no advisory report (exit ${status})${said ? `: ${said}` : ""}`);
  }
  // The count decides, not the exit status: a report with advisories is a finding even if npm
  // was told to exit 0 for its severity.
  if (total > 0) return { outcome: "advisory", report };
  if (status !== 0) {
    return unavailable(`npm audit exited ${status} but reported zero advisories; a contradictory result is not a clean one`);
  }
  return { outcome: "clean", report };
}

/** Advisory first, then unavailable, then clean: a known finding is never hidden behind a gap. */
export function exitCodeFor(results) {
  if (results.some((result) => result.outcome === "advisory")) return EXIT.advisory;
  if (results.some((result) => result.outcome !== "clean")) return EXIT.unavailable;
  return EXIT.clean;
}

const GHSA = /GHSA(?:-[0-9a-z]{4}){3}/gu;

/** Each chain from a vulnerable package up to a package nothing vulnerable depends on. */
function chainsOf(name, vulnerabilities, seen = new Set([name])) {
  const parents = (vulnerabilities[name]?.effects ?? []).filter((parent) => !seen.has(parent));
  if (parents.length === 0) return [[name]];
  return parents.flatMap((parent) =>
    chainsOf(parent, vulnerabilities, new Set([...seen, parent])).map((chain) => [name, ...chain]));
}

function fixText(fix) {
  if (fix === true) return "fix available within the declared ranges";
  if (fix === false) return "no fix available";
  if (fix && typeof fix === "object") {
    return `fix requires ${fix.name}@${fix.version}${fix.isSemVerMajor ? " (semver-major)" : ""}`;
  }
  return "fix availability not reported";
}

/**
 * Human-readable lines for an advisory report. Packages that carry an advisory themselves come
 * first, each with the chain that pulls it in; packages listed only because they depend on one
 * are part of those chains rather than separate entries.
 */
export function describeAdvisories(report) {
  const vulnerabilities = report.vulnerabilities ?? {};
  const counts = report.metadata.vulnerabilities;
  const severities = ["critical", "high", "moderate", "low", "info"]
    .filter((severity) => counts[severity] > 0)
    .map((severity) => `${counts[severity]} ${severity}`);
  const lines = [`${counts.total} vulnerable package(s) (${severities.join(", ") || "severity not reported"})`];
  const sources = Object.values(vulnerabilities)
    .filter((entry) => (entry.via ?? []).some((via) => via && typeof via === "object"))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (sources.length === 0) {
    lines.push("  the report names no advisory source; run npm audit --json for the raw report");
    return lines;
  }
  for (const entry of sources) {
    const advisories = entry.via.filter((via) => via && typeof via === "object");
    const ids = [...new Set(advisories.flatMap((via) => String(via.url ?? "").match(GHSA) ?? []))];
    const titles = [...new Set(advisories.map((via) => via.title).filter(Boolean))];
    lines.push(`  ${entry.name} (${entry.severity}, affected ${entry.range}): ${ids.join(", ") || "no GHSA id reported"}`);
    for (const title of titles) lines.push(`    ${title}`);
    const chains = chainsOf(entry.name, vulnerabilities).filter((chain) => chain.length > 1);
    for (const chain of chains) lines.push(`    pulled in by ${chain.slice(1).join(" <- ")}`);
    if (entry.nodes?.length) lines.push(`    installed at ${entry.nodes.join(", ")}`);
    lines.push(`    ${fixText(entry.fixAvailable)}`);
  }
  return lines;
}

// --- contracts ---------------------------------------------------------------------------------

export function manifestIssues(manifest) {
  const issues = [];
  if (!/^\^25\.8\./u.test(manifest.devDependencies?.["puppeteer-core"] ?? "")) {
    issues.push(`devDependencies puppeteer-core is ${JSON.stringify(manifest.devDependencies?.["puppeteer-core"])}, the contract pins ^25.8.x`);
  }
  if (manifest.peerDependencies?.["puppeteer-core"] !== ">=25.8.0 <26") {
    issues.push(`peerDependencies puppeteer-core is ${JSON.stringify(manifest.peerDependencies?.["puppeteer-core"])}, the contract pins ">=25.8.0 <26"`);
  }
  if (manifest.engines?.node !== ">=22.13.0") {
    issues.push(`engines.node is ${JSON.stringify(manifest.engines?.node)}, the contract pins ">=22.13.0"`);
  }
  return issues;
}

const unquote = (value) => value.replace(/^(["'])(.*)\1$/u, "$2");

/**
 * The `updates` entries of a dependabot.yml, read for this file's narrow purpose: block-style
 * mappings, one `key: value` per line. A flow-style or otherwise unexpected shape yields no entry,
 * and the contract then fails rather than reading a configuration it did not understand.
 */
export function dependabotEntries(text) {
  const lines = text.replace(/\r\n/gu, "\n").split("\n")
    .map((line) => line.replace(/\s+#.*$/u, ""))
    .filter((line) => line.trim() !== "" && !/^\s*#/u.test(line));
  const start = lines.findIndex((line) => line === "updates:");
  if (start === -1) return [];
  const entries = [];
  let entry = null;
  let keyIndent = -1;
  for (const line of lines.slice(start + 1)) {
    if (!/^\s/u.test(line)) break;
    const item = /^(\s*)-\s+([\w-]+):\s*(.*)$/u.exec(line);
    if (item) {
      entry = { [item[2]]: unquote(item[3].trim()) };
      keyIndent = item[1].length + 2;
      entries.push(entry);
      continue;
    }
    const pair = /^(\s*)([\w-]+):\s*(.*)$/u.exec(line);
    if (entry && pair && pair[1].length === keyIndent) entry[pair[2]] = unquote(pair[3].trim());
  }
  return entries;
}

/**
 * Advisory drift is repaired by Dependabot security updates, and only inside the ranges
 * package.json already allows: the peer range and the pins the Action and the docs install are
 * release decisions, never a bot's.
 */
export function dependabotIssues(text) {
  if (text === null) return [".github/dependabot.yml is missing: nothing proposes a fix when an advisory appears"];
  const issues = [];
  if (!/^version:\s*2\s*$/mu.test(text.replace(/\r\n/gu, "\n"))) issues.push(".github/dependabot.yml must declare version: 2");
  const npm = dependabotEntries(text).filter((entry) => entry["package-ecosystem"] === "npm" && entry.directory === "/");
  if (npm.length !== 1) {
    issues.push(`.github/dependabot.yml must have exactly one npm entry for directory "/", found ${npm.length}`);
  } else if (npm[0]["versioning-strategy"] !== "lockfile-only") {
    issues.push(`the npm entry must use versioning-strategy: lockfile-only, found ${JSON.stringify(npm[0]["versioning-strategy"] ?? null)}`);
  }
  return issues;
}

// --- running -----------------------------------------------------------------------------------

export function runAudit(args, { env = process.env, extraArgs = NPM_FETCH_ARGS } = {}) {
  return spawnSync("npm", ["audit", ...args, "--json", ...extraArgs], {
    cwd: ROOT,
    env,
    encoding: "utf8",
    timeout: AUDIT_TIME_LIMIT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
}

function readOptional(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function runCheck() {
  const manifest = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
  const contract = [...manifestIssues(manifest), ...dependabotIssues(readOptional(resolve(ROOT, ".github/dependabot.yml")))];
  for (const issue of contract) process.stderr.write(`dependency contract: ${issue}\n`);

  const results = [];
  for (const [key, graph] of Object.entries(GRAPHS)) {
    const result = classifyAudit(runAudit(graph.args));
    results.push(result);
    if (result.outcome === "advisory") {
      process.stderr.write(`dependency audit: ADVISORY in ${graph.label}: ${describeAdvisories(result.report).join("\n")}\n`);
    } else if (result.outcome === "unavailable") {
      process.stderr.write(
        `dependency audit: UNAVAILABLE for ${graph.label}: ${result.reason}. ` +
          "This is not a finding about the dependencies; nothing was audited. Rerun when the registry is reachable.\n",
      );
      // The second graph asks the same registry; waiting out the same failure again adds time
      // and no information.
      if (key === "runtime") {
        process.stderr.write(`dependency audit: ${GRAPHS.full.label} was not audited after the failure above\n`);
        break;
      }
    }
  }

  // A contract violation is a finding like an advisory (1) and outranks a missing audit (75).
  process.exitCode = contract.length > 0 ? EXIT.advisory : exitCodeFor(results);
  if (process.exitCode === EXIT.clean) {
    process.stdout.write(
      "dependencies: published runtime and complete development graph have 0 advisories; Node >=22.13 and " +
        "Puppeteer 25 contract pinned; Dependabot security updates configured lockfile-only\n",
    );
  }
}

// --- self-test ---------------------------------------------------------------------------------

function fixture(name) {
  return JSON.parse(readFileSync(resolve(FIXTURES, name), "utf8"));
}

/** A loopback port nothing listens on: bound, read, released. */
async function closedPort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolvePort(port));
    });
  });
}

async function runSelfTest() {
  let checks = 0;
  const expect = (name, run, outcome) => {
    const result = classifyAudit(run);
    assert.equal(result.outcome, outcome, `self-test "${name}": expected ${outcome}, got ${result.outcome} (${result.reason ?? ""})`);
    checks += 1;
    return result;
  };

  // Recorded npm 10 outputs: --omit=dev on the current tree, the full graph on 2026-10-26 before
  // the lockfile moved, and an audit against a closed loopback registry.
  const clean = fixture("clean.json");
  const advisory = fixture("advisory.json");
  const down = fixture("unavailable.json");
  expect("recorded clean report", { status: clean.status, stdout: JSON.stringify(clean.report) }, "clean");
  const found = expect("recorded advisory report", { status: advisory.status, stdout: JSON.stringify(advisory.report) }, "advisory");
  expect("recorded unreachable registry", { status: down.status, stdout: JSON.stringify(down.report) }, "unavailable");

  const text = describeAdvisories(found.report).join("\n");
  for (const needle of [
    "4 vulnerable package(s) (3 high, 1 moderate)",
    "zod (high, affected <4.6.6): GHSA-mrhx-c7xc-m3w5",
    "pulled in by chromium-bidi <- puppeteer-core",
    "fast-uri (moderate, affected 3.0.0 - 3.1.8): GHSA-w74x-v6f9-j3xg, GHSA-xhq7-xmqj-769h, GHSA-wjr9-j795-jxcr, GHSA-333x-w4r6-6crp",
    "installed at node_modules/zod",
  ]) {
    assert.ok(text.includes(needle), `self-test: the advisory description lacks ${JSON.stringify(needle)}:\n${text}`);
    checks += 1;
  }

  expect("no output at all", { status: 1, stdout: "" }, "unavailable");
  expect("output that is not JSON", { status: 1, stdout: "npm ERR! network" }, "unavailable");
  expect("JSON that is not a report", { status: 0, stdout: "[]" }, "unavailable");
  expect("time limit reached", { status: null, stdout: "", signal: "SIGTERM", error: Object.assign(new Error("spawnSync npm ETIMEDOUT"), { code: "ETIMEDOUT" }) }, "unavailable");
  expect("npm not on PATH", { status: null, stdout: "", error: Object.assign(new Error("spawnSync npm ENOENT"), { code: "ENOENT" }) }, "unavailable");
  expect("stopped by a signal", { status: null, stdout: JSON.stringify(clean.report), signal: "SIGKILL" }, "unavailable");
  expect("exit 1 with zero advisories", { status: 1, stdout: JSON.stringify(clean.report) }, "unavailable");
  expect("exit 0 with advisories", { status: 0, stdout: JSON.stringify(advisory.report) }, "advisory");
  expect("a report without a total", { status: 0, stdout: JSON.stringify({ metadata: { vulnerabilities: { high: 0 } } }) }, "unavailable");
  expect("an error next to a zero count", { status: 0, stdout: JSON.stringify({ ...clean.report, error: { summary: "x" } }) }, "unavailable");

  const r = (outcome) => ({ outcome });
  for (const [results, code] of [
    [[r("clean"), r("clean")], 0],
    [[r("clean"), r("unavailable")], 75],
    [[r("unavailable")], 75],
    [[r("unavailable"), r("advisory")], 1],
    [[r("advisory"), r("clean")], 1],
    [[], 0],
  ]) {
    assert.equal(exitCodeFor(results), code, `self-test: exit code for ${JSON.stringify(results.map((x) => x.outcome))}`);
    checks += 1;
  }

  // The Dependabot contract, on the real file and on configurations it must reject.
  const real = readOptional(resolve(ROOT, ".github/dependabot.yml"));
  assert.deepEqual(dependabotIssues(real), [], "self-test: the repository's own .github/dependabot.yml fails its contract");
  const minimal = 'version: 2\nupdates:\n  - package-ecosystem: "npm"\n    directory: "/"\n    schedule:\n      interval: "daily"\n    versioning-strategy: lockfile-only\n';
  assert.deepEqual(dependabotIssues(minimal), [], "self-test: a minimal valid configuration was rejected");
  for (const [name, text] of [
    ["missing file", null],
    ["no versioning strategy", minimal.replace(/    versioning-strategy: lockfile-only\n/u, "")],
    ["a strategy that edits package.json", minimal.replace("lockfile-only", "increase")],
    ["strategy only in a comment", minimal.replace("    versioning-strategy: lockfile-only\n", "    # versioning-strategy: lockfile-only\n")],
    ["strategy nested one level too deep", minimal.replace("    versioning-strategy:", "      versioning-strategy:")],
    ["npm entry for another directory", minimal.replace('directory: "/"', 'directory: "/docs"')],
    ["no npm entry", minimal.replace('"npm"', '"github-actions"')],
    ["two npm entries for /", `${minimal}${minimal.split("updates:\n")[1]}`],
    ["version 1", minimal.replace("version: 2", "version: 1")],
    ["flow style", 'version: 2\nupdates: [{package-ecosystem: npm, directory: "/", versioning-strategy: lockfile-only}]\n'],
  ]) {
    assert.ok(dependabotIssues(text).length > 0, `self-test: dependabot contract accepted "${name}"`);
    checks += 1;
  }

  // Real npm, real process boundary: a registry nobody answers is unavailable, never an advisory.
  const port = await closedPort();
  const env = { ...process.env, npm_config_registry: `http://127.0.0.1:${port}/` };
  const direct = classifyAudit(runAudit(["--omit=dev"], { env, extraArgs: ["--fetch-retries=0"] }));
  assert.equal(direct.outcome, "unavailable", `self-test: npm audit against closed port ${port} was ${direct.outcome}`);
  checks += 1;
  const whole = spawnSync(process.execPath, [SCRIPT], { cwd: ROOT, env, encoding: "utf8", timeout: AUDIT_TIME_LIMIT_MS + 30_000 });
  assert.equal(whole.status, EXIT.unavailable, `self-test: the script against closed port ${port} ended ${whole.status}, expected 75:\n${whole.stderr}`);
  assert.match(whole.stderr, /UNAVAILABLE for the published runtime dependency graph/u, `self-test: wrong message:\n${whole.stderr}`);
  assert.doesNotMatch(whole.stderr, /ADVISORY/u, `self-test: an unreachable registry was reported as an advisory:\n${whole.stderr}`);
  checks += 1;

  process.stdout.write(`dependency audit self-test: ${checks} checks passed, including real npm audit against a closed loopback registry (exit 75)\n`);
}

function isMain() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === SCRIPT;
}

if (isMain()) {
  const args = process.argv.slice(2);
  if (args.length === 0) runCheck();
  else if (args.length === 1 && args[0] === "--self-test") await runSelfTest();
  else {
    process.stderr.write(`dependency-audit.mjs: unknown arguments ${JSON.stringify(args)}\nusage: dependency-audit.mjs [--self-test]\n`);
    process.exitCode = 2;
  }
}
