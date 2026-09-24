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

describe("workflow gates", () => {
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
  it("no workflow runs the pagination-residue record while it exits 0 having read no document", () => {
    const run = spawnSync(process.execPath, ["tests/tools/pagination-residue-gate.mjs", "--cwd", "."], {
      cwd: ROOT, encoding: "utf8", env: { ...process.env, BREAKLINT_RESIDUE_CORPUS_ROOT: "" },
    });
    const readsNothing = run.status === 0 && /\b(NO CLAIM|SKIPPED)\b/u.test(run.stdout);
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
