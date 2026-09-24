#!/usr/bin/env node
/**
 * The release workflow names exactly one version, and it is the one `package.json` names.
 *
 * WHY THIS EXISTS. `release.yml` triggers on a literal tag, not a wildcard: a wildcard would let
 * any `v*` tag start a publish. A literal trigger has one failure mode, and it is silent. On
 * 2026-09-18 `v0.6.0` was pushed while the workflow still named `v0.5.0`: nothing ran, nothing
 * failed, nothing notified, and the tag sat on the remote looking done. Every assertion INSIDE the
 * workflow compares versions only after a tag has triggered it, so none of them could see a pin
 * that triggers nothing. The workflow also carried the version as a literal 28 times, and a
 * release-prep commit had to move every one of them by hand.
 *
 * WHAT IT ASSERTS, against the files at HEAD and nothing else:
 *   1. the trigger is exactly one literal tag, `v` + package.json's version, with no pattern
 *      character in it;
 *   2. both root version fields of package-lock.json equal package.json's version;
 *   3. no other `X.Y.Z` literal occurs in an executable line of the workflow, except third-party
 *      pins in their own named positions (`<package>@X.Y.Z` for a package other than breaklint,
 *      `GITLEAKS_VERSION:` and Node versions). Everything else derives from the trigger at run
 *      time through `--derive-env`, so there is nothing left to forget;
 *   4. every job that reads `RELEASE_VERSION` or `PACKAGE_FILE` derives them first.
 *
 * WHEN IT FAILS. It runs in `npm run test:release-tag` on every CI run. A release-prep commit
 * that moves package.json, the lock and the trigger together passes; a commit that moves only the
 * version (the 0.6.0 incident) or only the pin fails on its pull request, before anything is
 * tagged. After a release, main (version = pin = released version) passes.
 *
 * The oracle is package.json, never the workflow under test. `--self-test` copies the three real
 * files into a temporary directory, mutates them one at a time and runs `--check` on each copy in
 * a child process: a check whose red state nobody has seen is a claim.
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(import.meta.url);
const WORKFLOW = ".github/workflows/release.yml";
const DERIVE_STEP = "release-workflow-contract.mjs --derive-env";
const DERIVE_RUN = /^\s*(?:-\s+)?run:\s*node tests\/tools\/release-workflow-contract\.mjs --derive-env\s*$/u;
const SEMVER = /^\d+\.\d+\.\d+$/u;
// A version-shaped token that is not part of a longer dotted or word token. A following `.tgz`
// does not make it longer: `breaklint-X.Y.Z.tgz` names the release as surely as `X.Y.Z` does.
const VERSION_TOKEN = /(?<![\w.])v?(\d+\.\d+\.\d+)(?!\w|\.\d)/gu;

/** A full-line YAML or shell comment executes nothing, so a version named there cannot mis-pin. */
function executablePart(line) {
  if (/^\s*#/u.test(line)) return "";
  // `uses: owner/action@<sha> # v4.4.0` — the trailing comment names the action's release.
  return line.replace(/^(\s*-?\s*uses:\s*\S+)\s+#.*$/u, "$1");
}

/** Third-party pins in the positions the workflow uses for them. Each has its own owner. */
function isThirdPartyPin(line, index) {
  const before = line.slice(0, index);
  // `<name>@X.Y.Z`, including a registry URL ending in `/breaklint@X.Y.Z`: only the last path
  // segment names the package, so a URL cannot smuggle this package's own version past the check.
  const at = /([@\w./:-]+)@$/u.exec(before);
  if (at) return !/(^|\/)breaklint$/u.test(at[1]);
  if (/^\s*GITLEAKS_VERSION:\s*$/u.test(before)) return true;
  if (/^\s*node(-version)?:\s*[[\s"',\d.]*$/u.test(before)) return true;
  return false;
}

/** The steps of a job: each begins at a `- ` item of its `steps:` list. */
function stepsOf(jobLines) {
  const steps = [];
  let indent = null;
  for (const line of jobLines) {
    const item = /^(\s*)- /u.exec(line.text);
    if (item && (indent === null || item[1].length === indent)) {
      indent = item[1].length;
      steps.push([line]);
    } else if (steps.length && (indent === null || line.text.trim() === "" || line.text.length - line.text.trimStart().length > indent)) {
      steps.at(-1).push(line);
    }
  }
  return steps;
}

/** Splits the `jobs:` mapping into `{ name, startLine, lines }` by its two-space keys. */
function jobsOf(lines) {
  const start = lines.findIndex((line) => /^jobs:\s*$/u.test(line));
  if (start === -1) return [];
  const jobs = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\S/u.test(line)) break;
    const key = /^ {2}([A-Za-z0-9_-]+):\s*$/u.exec(line);
    if (key) jobs.push({ name: key[1], startLine: i + 1, lines: [] });
    else if (jobs.length) jobs.at(-1).lines.push({ number: i + 1, text: line });
  }
  return jobs;
}

export function checkReleaseWorkflow({ workflowText, manifest, lock }) {
  const issues = [];
  const version = manifest?.version;
  if (typeof version !== "string" || !SEMVER.test(version)) {
    issues.push(`package.json version ${JSON.stringify(version)} is not X.Y.Z`);
    return { valid: false, issues, version: null, tag: null };
  }
  const tag = `v${version}`;
  if (lock?.version !== version) {
    issues.push(`package-lock.json version is ${JSON.stringify(lock?.version)}, package.json is ${version}`);
  }
  if (lock?.packages?.[""]?.version !== version) {
    issues.push(`package-lock.json packages[""].version is ${JSON.stringify(lock?.packages?.[""]?.version)}, package.json is ${version}`);
  }

  const lines = workflowText.replace(/\r\n/gu, "\n").split("\n");

  // 1. The trigger: one literal tag, inside the top-level `on:` block.
  const onStart = lines.findIndex((line) => /^on:\s*$/u.test(line));
  const onEnd = onStart === -1 ? -1 : lines.findIndex((line, i) => i > onStart && /^\S/u.test(line));
  const tagLines = lines
    .map((text, i) => ({ text, number: i + 1 }))
    .filter(({ text }) => /^\s+tags:/u.test(text));
  let triggerLine = null;
  if (onStart === -1) issues.push(`${WORKFLOW} has no top-level on: block`);
  if (tagLines.length !== 1) {
    issues.push(`${WORKFLOW} must carry exactly one tags: trigger line, found ${tagLines.length}`);
  } else {
    const [{ text, number }] = tagLines;
    triggerLine = number;
    if (onStart === -1 || number - 1 < onStart || (onEnd !== -1 && number - 1 > onEnd)) {
      issues.push(`${WORKFLOW}:${number}: the tags: line is not inside the on: block`);
    }
    let tags;
    try {
      tags = JSON.parse(text.replace(/^\s+tags:\s*/u, "").trim());
    } catch {
      tags = undefined;
    }
    if (!Array.isArray(tags) || tags.length !== 1 || typeof tags[0] !== "string") {
      issues.push(`${WORKFLOW}:${number}: the trigger must be a one-element list of one literal tag, e.g. tags: ["${tag}"]`);
    } else if (/[*?[\]!+]/u.test(tags[0])) {
      issues.push(`${WORKFLOW}:${number}: the trigger ${tags[0]} is a pattern; it must be the literal tag ${tag}`);
    } else if (tags[0] !== tag) {
      issues.push(
        `${WORKFLOW}:${number}: the trigger is ${tags[0]} but package.json is ${version}; ` +
          `a push of ${tag} would start nothing. Move the pin and the version in one commit.`,
      );
    }
  }

  // 2. No other release literal anywhere that executes.
  for (const [i, raw] of lines.entries()) {
    if (i + 1 === triggerLine) continue;
    const line = executablePart(raw);
    for (const match of line.matchAll(VERSION_TOKEN)) {
      if (isThirdPartyPin(line, match.index)) continue;
      issues.push(
        `${WORKFLOW}:${i + 1}: version literal ${match[0]} outside the trigger` +
          `${match[1] === version ? " (stale release pin)" : ""}; derive it from the tag with $RELEASE_VERSION / $PACKAGE_FILE: ${raw.trim()}`,
      );
    }
  }

  // 3. Every job that reads the derived identity derives it first, in a step that always runs
  //    and that invokes the script rather than mentioning it: no `if:`, no `continue-on-error:`,
  //    and exactly `run: node tests/tools/<script> --derive-env` — not echoed, not `|| true`.
  for (const job of jobsOf(lines)) {
    for (const step of stepsOf(job.lines)) {
      if (!step.some(({ text }) => executablePart(text).includes(DERIVE_STEP))) continue;
      const at = step[0].number;
      if (!step.some(({ text }) => DERIVE_RUN.test(executablePart(text)))) {
        issues.push(`${WORKFLOW}:${at}: job ${job.name}: the derive step must be exactly "run: node tests/tools/${DERIVE_STEP}"`);
      }
      for (const { text, number } of step) {
        const key = /^\s*(?:-\s+)?(if|continue-on-error)\s*:/u.exec(executablePart(text));
        if (key) issues.push(`${WORKFLOW}:${number}: job ${job.name}: the derive step must be unconditional; it carries ${key[1]}:`);
      }
    }
    const firstUse = job.lines.find(({ text }) => /\bRELEASE_VERSION\b|\bPACKAGE_FILE\b/u.test(executablePart(text)));
    if (!firstUse) continue;
    const derive = job.lines.find(({ text }) => DERIVE_RUN.test(executablePart(text)));
    if (!derive || derive.number > firstUse.number) {
      issues.push(
        `${WORKFLOW}:${firstUse.number}: job ${job.name} reads the release identity without deriving it first ` +
          `(node tests/tools/${DERIVE_STEP})`,
      );
    }
  }
  return { valid: issues.length === 0, issues, version, tag };
}

function readRoot(root) {
  return {
    workflowText: readFileSync(join(root, WORKFLOW), "utf8"),
    manifest: JSON.parse(readFileSync(join(root, "package.json"), "utf8")),
    lock: JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8")),
  };
}

function runCheck(root) {
  const result = checkReleaseWorkflow(readRoot(root));
  if (!result.valid) {
    process.stderr.write(`release workflow contract: FAILED\n${result.issues.map((issue) => `  - ${issue}`).join("\n")}\n`);
    process.exitCode = 1;
    return null;
  }
  process.stdout.write(
    `release workflow contract: trigger ${result.tag} = package.json ${result.version} = package-lock.json; ` +
      `no other release literal\n`,
  );
  return result;
}

/** Run time: the triggering ref must be the one literal tag, and the rest derives from it. */
function deriveEnv(root) {
  const result = runCheck(root);
  if (!result) return;
  const ref = process.env.GITHUB_REF_NAME;
  const envFile = process.env.GITHUB_ENV;
  if (ref !== result.tag) {
    process.stderr.write(`release workflow contract: triggered by ${JSON.stringify(ref)}, but the workflow and package.json name ${result.tag}\n`);
    process.exitCode = 1;
    return;
  }
  if (!envFile) {
    process.stderr.write("release workflow contract: --derive-env needs GITHUB_ENV\n");
    process.exitCode = 1;
    return;
  }
  const packageFile = `breaklint-${result.version}.tgz`;
  appendFileSync(envFile, `RELEASE_VERSION=${result.version}\nPACKAGE_FILE=${packageFile}\n`);
  process.stdout.write(`release identity: RELEASE_VERSION=${result.version} PACKAGE_FILE=${packageFile}\n`);
}

function bumpMinor(version) {
  const [major, minor] = version.split(".").map(Number);
  return `${major}.${minor + 1}.0`;
}

function runSelfTest() {
  const real = readRoot(resolve(fileURLToPath(new URL("../..", import.meta.url))));
  const current = checkReleaseWorkflow(real);
  assert.ok(current.valid, `the real files do not satisfy the contract: ${current.issues.join("; ")}`);
  const version = current.version;
  const next = bumpMinor(version);
  const scratch = mkdtempSync(join(tmpdir(), "breaklint-release-workflow-"));
  const withVersion = (object, value) => {
    const copy = structuredClone(object);
    copy.version = value;
    if (copy.packages?.[""]) copy.packages[""].version = value;
    return copy;
  };
  const movePin = (text, value) => text.replace(`tags: ["v${version}"]`, `tags: ["v${value}"]`);
  const deriveRun = "        run: node tests/tools/release-workflow-contract.mjs --derive-env";
  assert.ok(real.workflowText.includes(deriveRun), "the real workflow has no derive step to mutate");
  const cases = [
    { name: "the real files", expect: 0 },
    { name: "a release-prep commit that moves version, lock and pin together", expect: 0,
      workflowText: movePin(real.workflowText, next), manifest: withVersion(real.manifest, next), lock: withVersion(real.lock, next) },
    { name: "the pin moves alone", expect: 1, match: /the trigger is v\S+ but package\.json is /u,
      workflowText: movePin(real.workflowText, next) },
    { name: "the version moves alone (the 0.6.0 incident)", expect: 1, match: /a push of v\S+ would start nothing/u,
      manifest: withVersion(real.manifest, next), lock: withVersion(real.lock, next) },
    { name: "package.json moves without its lock", expect: 1, match: /package-lock\.json version is/u,
      workflowText: movePin(real.workflowText, next), manifest: withVersion(real.manifest, next) },
    { name: "the lock moves alone", expect: 1, match: /package-lock\.json version is/u,
      lock: withVersion(real.lock, next) },
    { name: "a wildcard trigger", expect: 1, match: /is a pattern; it must be the literal tag/u,
      workflowText: real.workflowText.replace(`tags: ["v${version}"]`, 'tags: ["v*"]') },
    { name: "two tags in the trigger", expect: 1, match: /one-element list of one literal tag/u,
      workflowText: real.workflowText.replace(`tags: ["v${version}"]`, `tags: ["v${version}", "v${next}"]`) },
    { name: "one leftover release literal in a registry step", expect: 1, match: /:\d+: version literal \S+ outside the trigger \(stale release pin\)/u,
      workflowText: `${real.workflowText.trimEnd()}\n      - run: npm view breaklint@${version} version\n` },
    { name: "a derive step that may be skipped", expect: 1, match: /the derive step must be unconditional; it carries if:/u,
      workflowText: real.workflowText.replace(deriveRun, `        if: \${{ false }}\n${deriveRun}`) },
    { name: "a derive step whose failure is ignored", expect: 1, match: /the derive step must be unconditional; it carries continue-on-error:/u,
      workflowText: real.workflowText.replace(deriveRun, `        continue-on-error: true\n${deriveRun}`) },
    { name: "a derive step that only echoes the command", expect: 1, match: /the derive step must be exactly "run: node tests\/tools\/release-workflow-contract\.mjs --derive-env"/u,
      workflowText: real.workflowText.replace(deriveRun, deriveRun.replace("run: node", "run: echo node")) },
    { name: "a derive step whose exit code is swallowed", expect: 1, match: /the derive step must be exactly/u,
      workflowText: real.workflowText.replace(deriveRun, `${deriveRun} || true`) },
    { name: "a job that reads the identity without deriving it", expect: 1, match: /job extra reads the release identity without deriving it first/u,
      workflowText: `${real.workflowText.trimEnd()}\n  extra:\n    runs-on: ubuntu-latest\n    steps:\n      - run: test -s "$PACKAGE_FILE"\n` },
  ];
  try {
    for (const [index, testCase] of cases.entries()) {
      const root = join(scratch, String(index));
      mkdirSync(join(root, ".github/workflows"), { recursive: true });
      writeFileSync(join(root, WORKFLOW), testCase.workflowText ?? real.workflowText);
      writeFileSync(join(root, "package.json"), JSON.stringify(testCase.manifest ?? real.manifest, null, 2));
      writeFileSync(join(root, "package-lock.json"), JSON.stringify(testCase.lock ?? real.lock, null, 2));
      const run = spawnSync(process.execPath, [SCRIPT, "--check", "--root", root], { encoding: "utf8" });
      const output = `${run.stdout}${run.stderr}`;
      assert.equal(run.status, testCase.expect, `self-test "${testCase.name}": expected exit ${testCase.expect}, got ${run.status}\n${output}`);
      if (testCase.match) assert.match(output, testCase.match, `self-test "${testCase.name}" failed for the wrong reason:\n${output}`);
    }
    process.stdout.write(`release workflow contract self-test: ${cases.filter((c) => c.expect === 1).length} mutations rejected, ${cases.filter((c) => c.expect === 0).length} coherent states accepted\n`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function isMain() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === SCRIPT;
}

if (isMain()) {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf("--root");
  const root = resolve(rootIndex >= 0 && args[rootIndex + 1] ? args[rootIndex + 1] : process.cwd());
  if (args[0] === "--check") runCheck(root);
  else if (args[0] === "--derive-env" && args.length === 1) deriveEnv(root);
  else if (args[0] === "--self-test" && args.length === 1) runSelfTest();
  else {
    process.stderr.write("usage: release-workflow-contract.mjs --check [--root <dir>] | --derive-env | --self-test\n");
    process.exitCode = 2;
  }
}
