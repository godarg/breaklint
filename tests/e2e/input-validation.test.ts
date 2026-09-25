/**
 * Which inputs the CLI refuses as usage, before any renderer starts — through the real CLI in a
 * child process.
 *
 * The input type is decided by the name, so a DIRECTORY called `chapter.html` passed both the
 * extension and the existence check, started Chrome, and ended exit 3 with "input capture failed:
 * resource byte limit exceeded": an infrastructure verdict, with the wrong cause, for a mistake in
 * the invocation. README said a directory was rejected with exit 2 before Chrome starts. It is now.
 *
 * Why exit 2 proves the renderer did not start: every path past these checks either renders (exit
 * 0/1/3/4, and a report on stdout) or fails to find a renderer (exit 3). Only the invocation checks
 * end with 2 and an empty stdout.
 *
 * `--out-dir` is here too. It was parsed, validated and applied — the live evidence lands there —
 * and appeared in neither `--help`, the README nor the configuration docs, and no test named it.
 * Its process-boundary controls are below; that the evidence actually lands in it is held by
 * tests/live/cli-out-dir.test.ts, which needs a browser.
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../../src/cli/index.ts", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "breaklint-input-"));
after(() => rmSync(dir, { recursive: true, force: true }));

const markdown = join(dir, "notes.md");
writeFileSync(markdown, "# Notes\n\n- item\n");
const directory = join(dir, "chapter.html");
mkdirSync(directory);

function cli(args: readonly string[]): { code: number | null; stdout: string; stderr: string } {
  const run = spawnSync(process.execPath, ["--experimental-strip-types", CLI, ...args], {
    cwd: dir, encoding: "utf8", timeout: 60_000,
    // A browser a stray path would reach must not exist either: if a check were missing, the run
    // would end 3 for want of a renderer rather than silently render.
    env: { ...process.env, BREAKLINT_CHROME: join(dir, "no-such-browser") },
  });
  return { code: run.status, stdout: run.stdout, stderr: run.stderr };
}

function assertUsage(args: readonly string[], message: RegExp): void {
  const run = cli(args);
  assert.equal(run.code, 2, `${args.join(" ")}: expected exit 2, got ${run.code}\n${run.stdout}${run.stderr}`);
  assert.match(run.stderr, message);
  assert.equal(run.stdout, "", "a usage rejection must not print a report");
}

describe("input validation before any renderer", () => {
  it("rejects an existing Markdown file by its name", () => {
    assertUsage([markdown], /unsupported input type: .*notes\.md \(expected \.html or \.htm\)/u);
  });

  it("rejects a missing Markdown file by its name, before looking for it", () => {
    assertUsage([join(dir, "missing.md")], /unsupported input type: .*missing\.md/u);
  });

  it("rejects a directory named *.html as not a regular file", () => {
    assertUsage([directory], /input is not a regular file: .*chapter\.html/u);
  });

  it("rejects a missing *.html path as not found", () => {
    assertUsage([join(dir, "missing.html")], /input not found: .*missing\.html/u);
  });

  it("rejects the directory even when a valid path precedes it", () => {
    const valid = join(dir, "valid.html");
    writeFileSync(valid, "<!doctype html><title>t</title><p>x</p>");
    assertUsage([valid, directory], /input is not a regular file: .*chapter\.html/u);
  });
});

describe("--out-dir at the process boundary", () => {
  it("is listed in --help with its default", () => {
    const run = cli(["--help"]);
    assert.equal(run.code, 0);
    assert.match(run.stdout, /--out-dir <dir> +Where a live run writes its evidence[\s\S]*default \.\/breaklint-report/u);
  });

  it("without a value is usage", () => {
    assertUsage(["--out-dir"], /--out-dir needs a value/u);
  });

  it("with a blank value is usage", () => {
    assertUsage(["--demo", "--out-dir", "   "], /--out-dir needs a non-empty value/u);
  });

  it("does not create the directory for --demo, which writes no evidence", () => {
    const target = join(dir, "demo-evidence");
    const run = cli(["--demo", "--out-dir", target]);
    assert.equal(run.code, 1, run.stderr);
    assert.equal(existsSync(target), false, "--demo created an evidence directory it never writes to");
  });
});
