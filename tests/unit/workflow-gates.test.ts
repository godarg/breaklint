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
  return commands;
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
