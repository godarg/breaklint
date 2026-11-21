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
 *   4. every job that reads `RELEASE_VERSION` or `PACKAGE_FILE` derives them first;
 *   5. npm trusted publishing (OIDC) is the only credential the workflow can publish with: no
 *      repository secret, no NODE_AUTH_TOKEN except its `unset`, no `registry-url` in the publish
 *      job (setup-node would write an .npmrc that reads NODE_AUTH_TOKEN), one `npm publish` that
 *      names the registry explicitly after unsetting the variable, and an npm >= 11.5.1 pinned and
 *      verified in the publish job and nowhere else. On 2026-11-21 the 0.11.0 publish signed its
 *      provenance through OIDC and then failed the PUT with E404 on an expired token it had fallen
 *      back to: a tag on GitHub, nothing on npm.
 *
 * WHEN IT FAILS. It runs in `npm run test:release-tag` on every CI run. A release-prep commit
 * that moves package.json, the lock and the trigger together passes; a commit that moves only the
 * version (the 0.6.0 incident) or only the pin fails on its pull request, before anything is
 * tagged. After a release, main (version = pin = released version) passes.
 *
 * The oracle is package.json, never the workflow under test. `--self-test` copies the three real
 * files into a temporary directory, mutates them one at a time and runs `--check` on each copy in
 * a child process: a check whose red state nobody has seen is a claim.
 *
 * KNOWN LIMITS, accepted: the workflow is read line by line, not as YAML, and the derive step is
 * checked for `if:`, `continue-on-error:` and its exact `run:` line only — a step-level `shell:`
 * or `env:` that changed what that line does (a different interpreter, a redirected GITHUB_ENV)
 * would pass. So would a job-level `if:` that skips a whole job, which also skips every use of the
 * identity in it.
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
export function executablePart(line) {
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
  if (/^\s*NPM_VERSION:\s*$/u.test(before)) return true;
  if (/^\s*node(-version)?:\s*[[\s"',\d.]*$/u.test(before)) return true;
  return false;
}

/**
 * The keys that make a step conditional or let it fail without failing its job. The derive step
 * must carry neither, and tests/unit/workflow-gates.test.ts holds the packed-consumer steps to
 * the same rule.
 */
export function conditionKeys(step) {
  return step
    .map(({ text, number }) => ({ number, key: /^\s*(?:-\s+)?(if|continue-on-error)\s*:/u.exec(executablePart(text))?.[1] }))
    .filter((entry) => entry.key);
}

/** The steps of a job: each begins at a `- ` item of its `steps:` list. */
export function stepsOf(jobLines) {
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
export function jobsOf(lines) {
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

export const NPM_REGISTRY = "https://registry.npmjs.org";
// docs.npmjs.com/trusted-publishers: OIDC publishing needs npm 11.5.1 or later.
const TRUSTED_PUBLISHING_NPM = [11, 5, 1];
const NPM_PIN = /^\s*(?:-\s+)?(?:run:\s*)?npm install -g "npm@\$NPM_VERSION"\s*$/u;
const NPM_PIN_CHECK = /^\s*(?:-\s+)?(?:run:\s*)?test "\$\(npm -v\)" = "\$NPM_VERSION"\s*$/u;
const UNSET_TOKEN = /^\s*unset NODE_AUTH_TOKEN\s*$/u;

function atLeast(parts, floor) {
  for (let i = 0; i < floor.length; i += 1) {
    if (parts[i] !== floor[i]) return parts[i] > floor[i];
  }
  return true;
}

/**
 * Item 5 of the header: the publish job authenticates through OIDC and nothing else. Line-based,
 * like the rest of this file: a step's lines are its executable text, full-line comments dropped.
 */
export function publishAuthIssues(lines) {
  const issues = [];
  const where = (number) => `${WORKFLOW}:${number}`;
  for (const [i, raw] of lines.entries()) {
    const line = executablePart(raw);
    if (/\bsecrets\./u.test(line)) {
      issues.push(`${where(i + 1)}: the release workflow reads a repository secret; npm authenticates through OIDC trusted publishing and nothing else: ${raw.trim()}`);
    }
    if (/NODE_AUTH_TOKEN/u.test(line) && !UNSET_TOKEN.test(line)) {
      issues.push(`${where(i + 1)}: NODE_AUTH_TOKEN may only be unset, never set or passed: ${raw.trim()}`);
    }
    if (/NPM_TOKEN|_authToken|always-auth|\.npmrc|\bnpm (?:config set|login|adduser|token)\b/u.test(line)) {
      issues.push(`${where(i + 1)}: token configuration in the release workflow: ${raw.trim()}`);
    }
  }

  const jobs = jobsOf(lines);
  const publishing = jobs.filter((job) => job.lines.some(({ text }) => /\bnpm publish\b/u.test(executablePart(text))));
  if (publishing.length !== 1) {
    issues.push(`${WORKFLOW}: exactly one job may run npm publish, found ${publishing.length}`);
    return issues;
  }
  const [job] = publishing;
  for (const other of jobs) {
    if (other === job) continue;
    const pin = other.lines.find(({ text }) => /NPM_VERSION|install -g "?npm@/u.test(executablePart(text)));
    if (pin) {
      issues.push(`${where(pin.number)}: job ${other.name} pins npm; the pin belongs to the publish job only, the consumer arms keep the npm their Node ships`);
    }
  }
  const registryUrl = job.lines.find(({ text }) => /^\s*(?:-\s+)?registry-url\s*:/u.test(executablePart(text)));
  if (registryUrl) {
    issues.push(
      `${where(registryUrl.number)}: job ${job.name}: setup-node must not set registry-url; it writes an .npmrc that reads ` +
        "NODE_AUTH_TOKEN, and npm then falls back to a token when OIDC fails (the 0.11.0 E404)",
    );
  }
  if (!job.lines.some(({ text }) => /^\s*id-token:\s*write\s*$/u.test(executablePart(text)))) {
    issues.push(`${WORKFLOW}: job ${job.name} lacks permissions id-token: write, without which npm trusted publishing has no identity`);
  }
  const versionLine = job.lines.find(({ text }) => /^ {6}NPM_VERSION:/u.test(executablePart(text)));
  const version = versionLine && /^ {6}NPM_VERSION:\s*"?(\d+)\.(\d+)\.(\d+)"?\s*$/u.exec(executablePart(versionLine.text));
  if (!version) {
    issues.push(`${WORKFLOW}: job ${job.name} must pin npm in its job-level env as NPM_VERSION: X.Y.Z`);
  } else if (!atLeast(version.slice(1).map(Number), TRUSTED_PUBLISHING_NPM)) {
    issues.push(`${where(versionLine.number)}: job ${job.name} pins npm ${version.slice(1).join(".")}; trusted publishing needs npm >= ${TRUSTED_PUBLISHING_NPM.join(".")}`);
  }

  const steps = stepsOf(job.lines);
  const exec = (step) => step.map(({ text }) => executablePart(text));
  const pinAt = steps.findIndex((step) => exec(step).some((line) => NPM_PIN.test(line)));
  const publishAt = steps.findIndex((step) => exec(step).some((line) => /\bnpm publish\b/u.test(line)));
  if (pinAt === -1) {
    issues.push(`${WORKFLOW}: job ${job.name} must pin npm with npm install -g "npm@$NPM_VERSION" before npm publish`);
  } else {
    if (pinAt > publishAt) issues.push(`${where(steps[pinAt][0].number)}: job ${job.name} must pin npm before npm publish, not after it`);
    if (!exec(steps[pinAt]).some((line) => NPM_PIN_CHECK.test(line))) {
      issues.push(`${where(steps[pinAt][0].number)}: job ${job.name} must verify the pinned npm with test "$(npm -v)" = "$NPM_VERSION"`);
    }
    for (const { key, number } of conditionKeys(steps[pinAt])) {
      issues.push(`${where(number)}: job ${job.name}: the npm pin must be unconditional; it carries ${key}:`);
    }
  }
  if (publishAt === -1) {
    issues.push(`${WORKFLOW}: job ${job.name} runs npm publish outside a step this contract can read`);
    return issues;
  }
  const publishLines = exec(steps[publishAt]);
  const commands = publishLines.filter((line) => /\bnpm publish\b/u.test(line));
  if (commands.length !== 1) {
    issues.push(`${WORKFLOW}: job ${job.name} must run npm publish exactly once, found ${commands.length}`);
  } else {
    const [command] = commands;
    if (!/(?:^|\s)--registry=https:\/\/registry\.npmjs\.org(?:\s|$)/u.test(command)) {
      issues.push(`${WORKFLOW}: job ${job.name}: npm publish must name --registry=${NPM_REGISTRY} explicitly: ${command.trim()}`);
    }
    if (!/(?:^|\s)--access public(?:\s|$)/u.test(command)) {
      issues.push(`${WORKFLOW}: job ${job.name}: npm publish must pass --access public: ${command.trim()}`);
    }
    if (/[|;&]/u.test(command)) {
      issues.push(`${WORKFLOW}: job ${job.name}: nothing may be chained after npm publish: ${command.trim()}`);
    }
    const unset = publishLines.findIndex((line) => UNSET_TOKEN.test(line));
    if (unset === -1 || unset > publishLines.indexOf(command)) {
      issues.push(`${WORKFLOW}: job ${job.name} must unset NODE_AUTH_TOKEN before npm publish, in the same step`);
    }
  }
  return issues;
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
      for (const { key, number } of conditionKeys(step)) {
        issues.push(`${WORKFLOW}:${number}: job ${job.name}: the derive step must be unconditional; it carries ${key}:`);
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

  // 4. npm trusted publishing (OIDC) is the only credential.
  issues.push(...publishAuthIssues(lines));
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
  const publishIf = "        if: steps.registry.outputs.publish_needed == 'true'\n";
  const npmPin = "      - name: pin an npm that supports trusted publishing (OIDC)\n";
  /** A mutation of a literal the real workflow must contain once; a vanished subject fails loudly. */
  const mutate = (from, to) => {
    assert.equal(real.workflowText.split(from).length, 2, `self-test: the real workflow must contain ${JSON.stringify(from)} exactly once`);
    return real.workflowText.replace(from, to);
  };
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
    // Item 5: the 0.11.0 shape and each way back to it.
    { name: "a token passed to npm publish (the 0.11.0 shape)", expect: 1, match: /reads a repository secret/u,
      workflowText: mutate(publishIf, `${publishIf}        env:\n          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}\n`) },
    { name: "registry-url in the publish job", expect: 1, match: /setup-node must not set registry-url/u,
      workflowText: mutate(npmPin, `          registry-url: ${NPM_REGISTRY}\n${npmPin}`) },
    { name: "npm publish without an explicit registry", expect: 1, match: /must name --registry=/u,
      workflowText: mutate(` --registry=${NPM_REGISTRY}\n`, "\n") },
    { name: "npm publish without unsetting NODE_AUTH_TOKEN", expect: 1, match: /must unset NODE_AUTH_TOKEN before npm publish/u,
      workflowText: mutate("          unset NODE_AUTH_TOKEN\n", "") },
    { name: "an npm too old for trusted publishing", expect: 1, match: /trusted publishing needs npm >= 11\.5\.1/u,
      workflowText: real.workflowText.replace(/^( {6}NPM_VERSION: )\S+$/mu, "$111.5.0") },
    { name: "no npm pin in the publish job", expect: 1, match: /must pin npm with npm install -g/u,
      workflowText: mutate('          npm install -g "npm@$NPM_VERSION"\n', "") },
    { name: "the npm pin in a consumer job as well", expect: 1, match: /job clean-consumer pins npm/u,
      workflowText: mutate("    name: clean consumer (Node ${{ matrix.node }})\n", "    name: clean consumer (Node ${{ matrix.node }})\n    env:\n      NPM_VERSION: 11.21.2\n") },
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
  // Exactly these forms; anything else is exit 2, never a quieter run.
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--check") runCheck(process.cwd());
  else if (args.length === 3 && args[0] === "--check" && args[1] === "--root" && args[2] && !args[2].startsWith("--")) runCheck(resolve(args[2]));
  else if (args.length === 1 && args[0] === "--derive-env") deriveEnv(process.cwd());
  else if (args.length === 1 && args[0] === "--self-test") runSelfTest();
  else {
    process.stderr.write(`release-workflow-contract.mjs: unknown arguments ${JSON.stringify(args)}\nusage: release-workflow-contract.mjs --check [--root <dir>] | --derive-env | --self-test\n`);
    process.exitCode = 2;
  }
}
