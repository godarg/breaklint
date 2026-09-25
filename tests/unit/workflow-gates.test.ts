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

import { conditionKeys, executablePart, jobsOf, stepsOf } from "../tools/release-workflow-contract.mjs";
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
});
