/**
 * What the workflows run, held against what the repository claims about them.
 *
 * A CI step is a claim that something was checked. A step that exits 0 without having looked at
 * anything is a claim nobody made, and this repository has paid for that shape more than once:
 * a gate that went green over zero pages, a live suite that skipped itself, an installed CLI that
 * did nothing and exited 0. These tests read the real workflow files and run the real scripts;
 * nothing here is a copy of either.
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { checkReleaseWorkflow, conditionKeys, executablePart, jobsOf, stepsOf } from "../tools/release-workflow-contract.mjs";
import type { WorkflowLine } from "../tools/release-workflow-contract.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WORKFLOWS = [".github/workflows/ci.yml", ".github/workflows/release.yml"] as const;

/**
 * Every shell line a workflow executes: `run: <command>` and the body of `run: |` blocks. Full-line
 * comments inside a block execute nothing and are dropped.
 */
export function workflowRunLines(text: string): string[] {
  const lines = text.replace(/\r\n/gu, "\n").split("\n");
  const commands: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^(\s*)(?:-\s+)?run:\s*(.*)$/u.exec(lines[i]!);
    if (!match) continue;
    const inline = match[2]!.trim();
    if (inline !== "|" && inline !== ">" && inline !== "|-" && inline !== ">-") {
      commands.push(inline);
      continue;
    }
    const keyIndent = match[1]!.length + (lines[i]!.trimStart().startsWith("-") ? 2 : 0);
    for (i += 1; i < lines.length; i += 1) {
      const line = lines[i]!;
      if (line.trim() === "") continue;
      if (line.length - line.trimStart().length <= keyIndent) {
        i -= 1;
        break;
      }
      if (!/^\s*#/u.test(line)) commands.push(line.trim());
    }
  }
  // A shell line continued with a trailing backslash is one command.
  const joined: string[] = [];
  for (const command of commands) {
    const previous = joined.at(-1);
    if (previous !== undefined && previous.endsWith("\\")) joined[joined.length - 1] = `${previous.slice(0, -1).trimEnd()} ${command}`;
    else joined.push(command);
  }
  return joined;
}

/** The run lines of each job of a workflow, by job name. */
function jobRunLines(path: string): Map<string, string[]> {
  const lines = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/gu, "\n").split("\n");
  const jobs = new Map<string, string[]>();
  const start = lines.findIndex((line) => /^jobs:\s*$/u.test(line));
  let name: string | null = null;
  let body: string[] = [];
  const flush = () => { if (name) jobs.set(name, workflowRunLines(body.join("\n"))); };
  for (const line of lines.slice(start + 1)) {
    if (/^\S/u.test(line)) break;
    const key = /^ {2}([A-Za-z0-9_-]+):\s*$/u.exec(line);
    if (key) { flush(); name = key[1]!; body = []; } else body.push(line);
  }
  flush();
  return jobs;
}

function readLines(path: string): string[] {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/gu, "\n").split("\n");
}

function runLinesOf(path: string): string[] {
  return workflowRunLines(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"));
}

/** The gate commands of a list of shell lines: `npm run <script>`, `npm test` and `node tools/…`. */
export function gateSteps(lines: readonly string[]): string[] {
  const steps: string[] = [];
  for (const line of lines) {
    const command = line.replace(/\s+#.*$/u, "");
    for (const match of command.matchAll(/\bnpm (?:run ([\w:.-]+)|(test)\b)|\bnode (tools\/[\w./-]+\.mjs(?: --[\w-]+)*)/gu)) {
      steps.push(match[1] ? `npm run ${match[1]}` : match[2] ? "npm test" : `node ${match[3]}`);
    }
  }
  return steps;
}

/** The lines of the first ```bash block after a Markdown heading. */
function firstBashBlockAfter(path: string, heading: string): string[] {
  const text = readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/gu, "\n");
  const at = text.indexOf(`\n${heading}\n`);
  assert.ok(at !== -1, `${path} has no "${heading}" section; this guard has lost its subject`);
  const open = text.indexOf("\n```bash\n", at);
  const close = text.indexOf("\n```\n", open + 1);
  assert.ok(open !== -1 && close > open, `${path}: "${heading}" carries no bash block`);
  return text.slice(open + "\n```bash\n".length, close).split("\n");
}

/** `sub` occurs in `list` in the same order, not necessarily contiguously. */
function isSubsequence(sub: readonly string[], list: readonly string[]): boolean {
  let i = 0;
  for (const item of list) if (item === sub[i]) i += 1;
  return i === sub.length;
}

describe("workflow gates", () => {
  /*
   * AGENTS.md says the complete repository gate is documented in CONTRIBUTING.md. It was not:
   * CONTRIBUTING.md listed no gate, and the list in docs/releasing.md ran `test:real-document`
   * before the build it needs and left out three of CI's steps. Both lists are now read here and
   * held against the workflow itself.
   */
  it("CONTRIBUTING.md lists exactly the gate steps ci.yml runs, in CI's order", () => {
    const ci = gateSteps(runLinesOf(".github/workflows/ci.yml"));
    assert.ok(ci.length >= 15, `ci.yml yielded only ${ci.length} gate steps; the reader has lost its subject`);
    assert.deepEqual(gateSteps(firstBashBlockAfter("CONTRIBUTING.md", "## The complete local gate")), ci);
  });

  it("docs/releasing.md runs every ci.yml gate step in CI's order, and names why it runs any other", () => {
    const ci = gateSteps(runLinesOf(".github/workflows/ci.yml"));
    const release = new Set(gateSteps(runLinesOf(".github/workflows/release.yml")));
    // A step the release checklist runs beyond both workflows, and why it is there. Empty: a
    // gate worth running before a tag is worth running in CI.
    const EXTRA: Record<string, string> = {};
    const listed = gateSteps(firstBashBlockAfter("docs/releasing.md", "## Before creating the tag"));
    assert.ok(isSubsequence(ci, listed), `docs/releasing.md leaves out or reorders a ci.yml step.\n  ci.yml:    ${ci.join(" | ")}\n  releasing: ${listed.join(" | ")}`);
    const unexplained = listed.filter((step) => !ci.includes(step) && !release.has(step) && !(step in EXTRA));
    assert.deepEqual(unexplained, [], "docs/releasing.md runs a gate step that no workflow runs and that names no reason here");
  });

  // docs/releasing.md says the release workflow "repeats the complete gate". It is a claim a
  // workflow edit can silently falsify, so it is read off both files.
  it("release.yml runs every gate step ci.yml runs", () => {
    const ci = gateSteps(runLinesOf(".github/workflows/ci.yml"));
    const release = new Set(gateSteps(runLinesOf(".github/workflows/release.yml")));
    assert.deepEqual(ci.filter((step) => !release.has(step)), [], "release.yml does not repeat these ci.yml gate steps");
  });

  /*
   * The checks that see the SHIPPED package — the README demo excerpt against the installed bin, and
   * the docs' schema stamps against the installed code — exist only as workflow lines. Deleting one
   * leaves every test of the tools themselves green, so the lines are pinned here, job by job. At a
   * tag the docs check must run with --release, which refuses the pending exceptions a pull request
   * may still carry.
   */
  it("every packed-consumer job runs the README-demo and docs-truth checks against the installed package", () => {
    const expect: [string, string, RegExp[]][] = [
      [".github/workflows/ci.yml", "check", [
        /readme-demo-contract\.mjs" --consumer "\$PWD"$/u,
        /docs-truth\.mjs" --package node_modules\/breaklint --pending "\$GITHUB_WORKSPACE\/tests\/tools\/docs-truth-pending\.jsonl"$/u,
      ]],
      [".github/workflows/ci.yml", "node-floor", [/readme-demo-contract\.mjs" --consumer "\$PWD"$/u]],
      [".github/workflows/release.yml", "clean-consumer", [
        /readme-demo-contract\.mjs" --consumer "\$consumer"$/u,
        /docs-truth\.mjs" --package "\$consumer\/node_modules\/breaklint" --pending "[^"]+docs-truth-pending\.jsonl" --release$/u,
      ]],
      [".github/workflows/release.yml", "publish", [
        /readme-demo-contract\.mjs" --consumer "\$registry_consumer"$/u,
        /docs-truth\.mjs" --package "\$registry_consumer\/node_modules\/breaklint" --pending "[^"]+docs-truth-pending\.jsonl" --release$/u,
      ]],
    ];
    for (const [path, jobName, patterns] of expect) {
      const job = jobsOf(readLines(path)).find((candidate) => candidate.name === jobName);
      assert.ok(job, `${path} has no job ${jobName}; this guard has lost its subject`);
      assert.ok(!job.lines.some(({ text }) => /^ {4}continue-on-error\s*:/u.test(executablePart(text))), `${path} job ${jobName} may fail without failing the workflow`);
      for (const pattern of patterns) {
        // The line must run, and its exit code must reach the job: invoked by node itself (not
        // echoed, not `true ||`), nothing chained or piped after it, errexit on at that point, in
        // a step that is not conditional and whose failure is not ignored — the rule the release
        // workflow's derive step is held to.
        const found: { step: WorkflowLine[]; commands: string[]; at: number }[] = stepsOf(job.lines).flatMap((candidate) => {
          const lines = workflowRunLines(candidate.map(({ text }) => text).join("\n"));
          const index = lines.findIndex((line) => pattern.test(line));
          return index === -1 ? [] : [{ step: candidate, commands: lines, at: index }];
        });
        assert.equal(found.length, 1, `${path} job ${jobName} runs ${pattern.source} ${found.length} times, not once`);
        const { step, commands, at } = found[0]!;
        const command = commands[at]!;
        assert.match(command, /^node "\$GITHUB_WORKSPACE\/tests\/tools\/[\w-]+\.mjs"( |$)/u, `${path} job ${jobName}: the check is not invoked by node itself: ${command}`);
        assert.doesNotMatch(command, /[|;&]/u, `${path} job ${jobName}: something is chained or piped after the check: ${command}`);
        const errexit = commands.slice(0, at).reduce((on, line) => (/^set\s+\+e\b|^set\s+\+o\s+errexit\b/u.test(line) ? false : /^set\s+-e\b|^set\s+-o\s+errexit\b/u.test(line) ? true : on), true);
        assert.ok(errexit, `${path} job ${jobName}: the check runs after "set +e", so its exit code is ignored: ${command}`);
        assert.deepEqual(conditionKeys(step), [], `${path} job ${jobName}: the step running the check is conditional or may fail silently`);
      }
    }
    const releaseDocs = [...jobRunLines(".github/workflows/release.yml").values()].flat().filter((line) => /docs-truth\.mjs/u.test(line));
    assert.ok(releaseDocs.length >= 2, "release.yml runs the docs check almost nowhere");
    assert.deepEqual(releaseDocs.filter((line) => !/--release(?=\s|$)/u.test(line)), [], "release.yml runs the docs check without --release");
  });

  it("the gate-step reader sees npm run, npm test and repository tools, and ignores comments", () => {
    assert.deepEqual(
      gateSteps(["npm ci --no-audit", "X=1 npm run test:live", "npm test", "node tools/make-mark-font.mjs --check", "npm i x # npm run nope"]),
      ["npm run test:live", "npm test", "node tools/make-mark-font.mjs --check"],
    );
  });

  it("the run-line reader sees single-line and block commands and ignores comments", () => {
    const text = [
      "jobs:",
      "  a:",
      "    steps:",
      "      - run: npm run one",
      "      - name: two",
      "        run: |",
      "          npm run two",
      "          # npm run not-this",
      "          node x.mjs",
      "      - name: three",
      "        run: npm run three",
    ].join("\n");
    assert.deepEqual(workflowRunLines(text), ["npm run one", "npm run two", "node x.mjs", "npm run three"]);
  });

  /*
   * The pagination-residue record binds six private documents by digest. Its binding is
   * historical: the digests are reachable nowhere, so the script prints NO CLAIM and exits 0
   * without reading one of them — with or without an artifact root. As a CI step it could fail
   * only on the internal consistency of its own manifest, under a gate's name. The step was
   * retired; the class is held by tests/fixtures/fragmentainer-residue.html in the live suite.
   *
   * The oracle is the script itself, run here: if it ever reads documents again, or stops
   * exiting 0 over none, this test no longer forbids the step.
   */
  it("the pagination-residue record is internally consistent, and no workflow runs it while it reads no document", () => {
    const run = spawnSync(process.execPath, ["tests/tools/pagination-residue-gate.mjs", "--cwd", "."], {
      cwd: ROOT, encoding: "utf8", env: { ...process.env, BREAKLINT_RESIDUE_CORPUS_ROOT: "" },
    });
    // The public half — the record's internal consistency — runs whatever the binding, and it is
    // the one part of this record anybody can still check. Retiring the CI step must not retire it.
    assert.equal(run.status, 0, `the pagination-residue record's public half failed:\n${run.stdout}${run.stderr}`);
    const readsNothing = /\b(NO CLAIM|SKIPPED)\b/u.test(run.stdout);
    if (!readsNothing) return;
    assert.match(run.stdout, /Nothing about the \d+ documents is verified|were NOT read/u, "the record no longer says what it did not read");
    for (const path of WORKFLOWS) {
      const offending = runLinesOf(path).filter((line) => /test:pagination-residue(?!:)|pagination-residue-gate\.mjs/u.test(line));
      assert.deepEqual(
        offending,
        [],
        `${path} runs the pagination-residue record, which exits 0 having read none of its documents: ` +
          "a green step over nothing. The class is held by tests/fixtures/fragmentainer-residue.html in the live suite.",
      );
    }
  });

  /*
   * 0.11.0 was tagged and never reached npm. setup-node's `registry-url` wrote an .npmrc that reads
   * NODE_AUTH_TOKEN, the publish step passed a repository secret in it, and when that token no
   * longer authorised the PUT npm answered E404 after the OIDC provenance signature had already
   * succeeded. From 0.11.1 the publish job holds no token at all: npm trusted publishing (OIDC)
   * is the only credential, with an npm that supports it pinned in that job alone.
   */
  describe("the release publishes through npm trusted publishing (OIDC) only", () => {
    const RELEASE = ".github/workflows/release.yml";
    const realFiles = () => ({
      workflowText: readFileSync(new URL(`../../${RELEASE}`, import.meta.url), "utf8"),
      manifest: JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as unknown,
      lock: JSON.parse(readFileSync(new URL("../../package-lock.json", import.meta.url), "utf8")) as unknown,
    });

    it("the publish job configures no token, names the registry explicitly and pins npm >= 11.5.1 only there", () => {
      const lines = readLines(RELEASE);
      const jobs = jobsOf(lines);
      const publish = jobs.find((job) => job.name === "publish");
      assert.ok(publish, `${RELEASE} has no publish job; this guard has lost its subject`);
      const executable = publish.lines.map(({ text }) => executablePart(text));
      assert.deepEqual(executable.filter((line) => /^\s*registry-url\s*:/u.test(line)), [], "setup-node in the publish job writes a token-reading .npmrc");
      assert.deepEqual(
        lines.filter((line) => /NODE_AUTH_TOKEN|NPM_TOKEN|\bsecrets\./u.test(executablePart(line)) && !/^\s*unset NODE_AUTH_TOKEN\s*$/u.test(line)),
        [],
        "the release workflow configures a token",
      );
      const runs = workflowRunLines(publish.lines.map(({ text }) => text).join("\n"));
      const publishes = runs.filter((line) => /\bnpm publish\b/u.test(line));
      assert.equal(publishes.length, 1, `the publish job runs npm publish ${publishes.length} times`);
      const command = publishes[0]!;
      assert.match(command, /--registry=https:\/\/registry\.npmjs\.org(?:\s|$)/u, "npm publish does not name the registry explicitly");
      assert.match(command, /--access public(?:\s|$)/u);
      assert.doesNotMatch(command, /[|;&]/u, "something is chained after npm publish");
      const unset = runs.indexOf("unset NODE_AUTH_TOKEN");
      assert.ok(unset !== -1 && unset < runs.indexOf(command), "NODE_AUTH_TOKEN is not unset before npm publish");
      const pin = runs.indexOf('npm install -g "npm@$NPM_VERSION"');
      assert.ok(pin !== -1 && pin < runs.indexOf(command), "the publish job does not pin npm before publishing");
      assert.ok(runs.includes('test "$(npm -v)" = "$NPM_VERSION"'), "the publish job does not verify the pinned npm");
      const version = executable.map((line) => /^ {6}NPM_VERSION:\s*(\d+)\.(\d+)\.(\d+)\s*$/u.exec(line)).find(Boolean);
      assert.ok(version, "the publish job declares no NPM_VERSION");
      const [major, minor, patch] = version.slice(1).map(Number) as [number, number, number];
      assert.ok(major > 11 || (major === 11 && (minor > 5 || (minor === 5 && patch >= 1))), "trusted publishing needs npm >= 11.5.1");
      for (const job of jobs.filter((candidate) => candidate.name !== "publish")) {
        assert.deepEqual(
          job.lines.filter(({ text }) => /NPM_VERSION|install -g "?npm@/u.test(executablePart(text))).map(({ text }) => text.trim()),
          [],
          `job ${job.name} pins npm; the consumer arms keep the npm their Node ships`,
        );
      }
    });

    it("the release-workflow contract rejects a token publish, a registry-url and a missing pin in the publish job", () => {
      const real = realFiles();
      assert.deepEqual(checkReleaseWorkflow(real).issues, [], "the real release workflow fails its own contract");
      const text = real.workflowText;
      const publishIf = "        if: steps.registry.outputs.publish_needed == 'true'\n";
      const setupNode = /( {6}- uses: actions\/setup-node@\S+.*\n {8}with:\n {10}node-version: 24\n)(?![\s\S]*\n {2}publish:\n)/u;
      assert.ok(text.includes(publishIf), "the publish step has moved; this guard has lost its subject");
      assert.match(text, setupNode, "the publish job's setup-node has moved; this guard has lost its subject");
      const cases: [string, string, RegExp][] = [
        ["a token passed to the publish step", text.replace(publishIf, `${publishIf}        env:\n          NODE_AUTH_TOKEN: \${{ secrets.NPM_TOKEN }}\n`), /reads a repository secret|NODE_AUTH_TOKEN may only be unset/u],
        ["registry-url in the publish job", text.replace(setupNode, "$1          registry-url: https://registry.npmjs.org\n"), /must not set registry-url/u],
        ["npm publish without an explicit registry", text.replace(/ --registry=https:\/\/registry\.npmjs\.org(?=\s*\n)/u, ""), /must name --registry=https:\/\/registry\.npmjs\.org/u],
        ["npm publish without unsetting NODE_AUTH_TOKEN", text.replace(/^ *unset NODE_AUTH_TOKEN\n/mu, ""), /unset NODE_AUTH_TOKEN before npm publish/u],
        ["no npm pin in the publish job", text.replace(/^ *npm install -g "npm@\$NPM_VERSION"\n/mu, ""), /must pin npm/u],
        ["an npm too old for trusted publishing", text.replace(/^( {6}NPM_VERSION: )\S+$/mu, "$111.5.0"), /npm >= 11\.5\.1/u],
      ];
      for (const [name, mutated, expected] of cases) {
        assert.notEqual(mutated, text, `mutation "${name}" changed nothing; this guard has lost its subject`);
        const issues = checkReleaseWorkflow({ ...real, workflowText: mutated }).issues.join("\n");
        assert.match(issues, expected, `the contract accepted ${name}:\n${issues}`);
      }
    });
  });

  /*
   * GitHub forces Node-20 actions onto Node 24 with a deprecation warning in every run, and they
   * stop working without a commit here once the Node-20 runtime is removed. Each `uses:` names a
   * full commit SHA and the exact release it is, one SHA per action across all workflows and the
   * CI recipe users copy. A job without timeout-minutes may hold a runner for six hours.
   */
  describe("pinned Node-24 actions and bounded jobs", () => {
    const FILES = [
      ".github/workflows/ci.yml",
      ".github/workflows/release.yml",
      ".github/workflows/community-intake.yml",
      ".github/workflows/m3-1-attest.yml",
      "docs/ci-recipe.md",
    ] as const;
    // The releases pinned until 0.11.0, each measured from its own action.yml: `using: node20`.
    const NODE20: Record<string, string> = {
      "11d5960a326750d5838078e36cf38b85af677262": "actions/checkout v4.4.0",
      "49933ea5288caeca8642d1e84afbd3f7d6820020": "actions/setup-node v4.4.0",
      "ea165f8d65b6e75b540449e92b4886f43607fa02": "actions/upload-artifact v4.6.2",
      "d3f86a106a0bac45b974a628896c90dbdf5c8093": "actions/download-artifact v4.3.0",
    };
    const usesOf = (path: string) => readLines(path).flatMap((line, index) => {
      const match = /^\s*(?:-\s+)?uses:\s*(\S+?)@(\S+)(?:\s+#\s*(.*))?$/u.exec(line);
      return match && !match[1]!.startsWith("./") && !match[1]!.startsWith("godarg/breaklint")
        ? [{ at: `${path}:${index + 1}`, action: match[1]!, ref: match[2]!, comment: match[3]?.trim() ?? "" }]
        : [];
    });

    it("every remote action is pinned to a full SHA with its exact release, one SHA per action, none a Node-20 release", () => {
      const uses = FILES.flatMap(usesOf);
      assert.ok(uses.length >= 20, `only ${uses.length} uses: lines found; this guard has lost its subject`);
      const bySha = new Map<string, string>();
      for (const { at, action, ref, comment } of uses) {
        assert.equal(NODE20[ref], undefined, `${at}: ${action}@${ref} is ${NODE20[ref]}, which runs on Node 20`);
        assert.match(ref, /^[0-9a-f]{40}$/u, `${at}: ${action} is not pinned to a full commit SHA`);
        assert.match(comment, /^v\d+\.\d+\.\d+$/u, `${at}: ${action}@${ref} does not name its exact release (# vX.Y.Z), it says "${comment}"`);
        const key = `${action}@${ref}`;
        const named = bySha.get(key);
        assert.ok(named === undefined || named === comment, `${at}: ${key} is called ${comment} here and ${named} elsewhere`);
        bySha.set(key, comment);
      }
      const shasPerAction = new Map<string, Set<string>>();
      for (const { action, ref } of uses) shasPerAction.set(action, (shasPerAction.get(action) ?? new Set()).add(ref));
      for (const [action, shas] of shasPerAction) assert.equal(shas.size, 1, `${action} is pinned to ${shas.size} different SHAs: ${[...shas].join(", ")}`);
    });

    it("every job of every workflow sets timeout-minutes, and the publish job's covers its registry wait", () => {
      for (const path of FILES.filter((file) => file.endsWith(".yml"))) {
        const jobs = jobsOf(readLines(path));
        assert.ok(jobs.length > 0, `${path} has no jobs; this guard has lost its subject`);
        for (const job of jobs) {
          const limit = job.lines.map(({ text }) => /^ {4}timeout-minutes:\s*(\d+)\s*$/u.exec(text)).find(Boolean);
          assert.ok(limit, `${path} job ${job.name} sets no timeout-minutes; the default holds a runner for 360 minutes`);
          assert.ok(Number(limit[1]) <= 60, `${path} job ${job.name}: timeout-minutes ${limit[1]} is no bound`);
        }
      }
      // The oracle is the publish job's own polling loop, not a number copied here.
      const publish = jobsOf(readLines(".github/workflows/release.yml")).find((job) => job.name === "publish");
      assert.ok(publish, "release.yml has no publish job");
      const body = publish.lines.map(({ text }) => text).join("\n");
      const attempts = /for attempt in \$\(seq 1 (\d+)\)/u.exec(body);
      const pause = /^\s*sleep (\d+)\s*$/mu.exec(body);
      assert.ok(attempts && pause, "the publish job's registry polling loop has moved; this guard has lost its subject");
      const waitMinutes = (Number(attempts[1]) * Number(pause[1])) / 60;
      const limit = Number(/^ {4}timeout-minutes:\s*(\d+)/mu.exec(body)?.[1]);
      assert.ok(limit >= waitMinutes + 15, `publish timeout-minutes ${limit} does not cover the ${waitMinutes}-minute registry wait plus installation, signature check and consumer gate`);
    });

    it("the publish job, which can write releases and request an OIDC token, restores no dependency cache", () => {
      const publish = jobsOf(readLines(".github/workflows/release.yml")).find((job) => job.name === "publish");
      assert.ok(publish, "release.yml has no publish job");
      assert.deepEqual(publish.lines.filter(({ text }) => /^\s*cache\s*:/u.test(executablePart(text))).map(({ number, text }) => `${number}: ${text.trim()}`), []);
    });
  });

  /*
   * The report-surface matrix fixes printed page counts per platform. On `ubuntu-latest` a runner
   * image change (fonts, Chrome) moves those figures on an unchanged candidate, so every job that
   * renders the matrix names its image.
   */
  it("every job that renders the report-surface matrix runs on a pinned ubuntu-24.04 image", () => {
    const rendering: string[] = [];
    for (const path of WORKFLOWS) {
      for (const job of jobsOf(readLines(path))) {
        const runs = workflowRunLines(job.lines.map(({ text }) => text).join("\n"));
        if (!runs.some((line) => /\bnpm run test:report-surfaces\b/u.test(line))) continue;
        rendering.push(`${path}#${job.name}`);
        const runsOn = job.lines.map(({ text }) => /^ {4}runs-on:\s*(\S+)\s*$/u.exec(text)?.[1]).find(Boolean);
        assert.equal(runsOn, "ubuntu-24.04", `${path} job ${job.name} renders the report-surface matrix on ${runsOn ?? "no declared image"}`);
      }
    }
    assert.ok(rendering.includes(".github/workflows/ci.yml#check"), `the ci.yml check job no longer renders the matrix; this guard has lost its subject (${rendering.join(", ")})`);
  });

  /*
   * Recovery: a tag commit may be an ancestor of main (main moves on after a merge; the exact
   * commit still needs its own successful main CI run), an existing GitHub Release is completed or
   * verified byte for byte instead of refused, and the release notes are the tag commit's own
   * CHANGELOG section. The logic lives in tests/tools/release-recovery.mjs, whose self-test runs
   * in every CI run through `npm run test:release-tag`.
   */
  it("release.yml recovers through release-recovery.mjs, and CI runs its self-test", () => {
    const publish = jobsOf(readLines(".github/workflows/release.yml")).find((job) => job.name === "publish");
    assert.ok(publish, "release.yml has no publish job");
    const runs = workflowRunLines(publish.lines.map(({ text }) => text).join("\n"));
    assert.deepEqual(runs.filter((line) => /"\$release_commit" = "\$main_commit"/u.test(line)), [], "the publish job still demands that the tag commit BE origin/main");
    assert.deepEqual(runs.filter((line) => /--generate-notes/u.test(line)), [], "release notes are generated from commit titles, not the CHANGELOG");
    assert.ok(runs.includes('node tests/tools/release-recovery.mjs --assert-on-main "$release_commit" origin/main'), "the publish job does not check that the tag commit is on main");
    assert.ok(runs.some((line) => /^node tests\/tools\/release-recovery\.mjs --notes "\$RELEASE_VERSION" --changelog \S+ --out "\$RUNNER_TEMP\/release-notes\.md"$/u.test(line)), "the publish job does not take its notes from the CHANGELOG");
    assert.ok(runs.some((line) => /^git show "\$\{?release_commit\}?:CHANGELOG\.md" > \S+$/u.test(line) || /^git show "\$\{RELEASE_COMMIT\}:CHANGELOG\.md" > \S+$/u.test(line)), "the notes are not read from the tag commit");
    assert.ok(runs.some((line) => /^node tests\/tools\/release-recovery\.mjs --registry-decide$/u.test(line)), "the registry decision is not the tested one");
    assert.ok(runs.some((line) => /^node tests\/tools\/release-recovery\.mjs --github-release "\$GITHUB_REF_NAME" --notes-file "\$RUNNER_TEMP\/release-notes\.md" "\$PACKAGE_FILE" "\$PACKAGE_FILE\.sha256" "\$PACKAGE_FILE\.sri"$/u.test(line)), "the GitHub Release is not created through the tested state machine");
    const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
    assert.match(manifest.scripts["test:release-tag"] ?? "", /node tests\/tools\/release-recovery\.mjs --self-test/u, "CI does not run the recovery self-test");
  });
});
