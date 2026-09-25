/**
 * Where a live CLI run writes its evidence, observed on disk.
 *
 * `--out-dir` was parsed, validated and passed to the renderer, and it decides where every page
 * PNG and the checked PDF land — by default `./breaklint-report` in the working directory, which
 * every live run therefore creates. Neither the option nor that side effect was documented, and no
 * test named either; AGENTS.md says an option that is not validated, applied, reported and tested
 * is not an option.
 *
 * The document is authored here and has one complication: none. It is one short page, because the
 * property under test is not a measurement but where the measurement's evidence goes. The run uses
 * `--no-evidence-binding`: binding decides whether a finding may point at the evidence, not whether
 * the evidence is written, and this test must not depend on the binding.
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { resolveBrowser, resolvePackageRoot } from "../../src/acquire/browser.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(REPO, "src/cli/index.ts");
const optional = process.env.BREAKLINT_LIVE_OPTIONAL === "1";
const missing = [
  resolveBrowser().path ? null : "a browser",
  resolvePackageRoot("pagedjs", REPO) ? null : "pagedjs",
  resolvePackageRoot("pdfjs-dist", REPO) ? null : "pdfjs-dist",
  resolvePackageRoot("puppeteer-core", REPO) ? null : "puppeteer-core",
].filter((value): value is string => value !== null);

const DOCUMENT = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>evidence directory</title></head>' +
  "<body><h1>Evidence directory</h1><p>One short paragraph on one page.</p></body></html>";

function liveRun(cwd: string, extra: readonly string[]): { code: number | null; report: { documents: { evidence: { path: string }[] }[] }; stderr: string } {
  const run = spawnSync(process.execPath, ["--experimental-strip-types", CLI, "--no-evidence-binding", "--format", "json", "--out", "report.json", ...extra, "doc.html"], {
    cwd, encoding: "utf8", timeout: 300_000,
  });
  assert.ok(run.status === 0 || run.status === 1, `the live run ended ${run.status}, not a measured 0 or 1:\n${run.stdout}${run.stderr}`);
  return { code: run.status, report: JSON.parse(readFileSync(join(cwd, "report.json"), "utf8")), stderr: run.stderr };
}

function assertEvidenceIn(dir: string, report: { documents: { evidence: { path: string }[] }[] }): void {
  const files = readdirSync(dir);
  assert.ok(files.some((name) => name.endsWith("-checked.pdf")), `no checked PDF in ${dir}: ${files.join(", ")}`);
  const evidence = report.documents[0]!.evidence;
  assert.ok(evidence.length > 0, "the report names no evidence");
  for (const entry of evidence) {
    assert.ok(!entry.path.startsWith("/") && !entry.path.includes(".."), `evidence path is not relative to the evidence directory: ${entry.path}`);
    assert.ok(existsSync(join(dir, entry.path)), `evidence ${entry.path} is not in ${dir}`);
  }
}

describe("the CLI evidence directory, live", () => {
  let root = "";

  before((t) => {
    if (missing.length > 0) {
      if (optional) return (t as { skip(message: string): void }).skip(`missing: ${missing.join(", ")}`);
      assert.fail(`the evidence-directory check requires ${missing.join(", ")}`);
    }
    root = mkdtempSync(join(tmpdir(), "breaklint-out-dir-"));
  });

  after(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("--out-dir receives every evidence file, and the default directory is used otherwise", () => {
    // A working directory of its own, resolving the renderer peers the way a consumer project does.
    const explicit = join(root, "explicit");
    const implicit = join(root, "implicit");
    for (const cwd of [explicit, implicit]) {
      mkdirSync(cwd);
      symlinkSync(join(REPO, "node_modules"), join(cwd, "node_modules"));
      writeFileSync(join(cwd, "doc.html"), DOCUMENT);
    }

    const chosen = join(root, "chosen-evidence");
    const first = liveRun(explicit, ["--out-dir", chosen]);
    assertEvidenceIn(chosen, first.report);
    assert.equal(existsSync(join(explicit, "breaklint-report")), false, "with --out-dir the default directory was created anyway");

    const second = liveRun(implicit, []);
    assertEvidenceIn(join(implicit, "breaklint-report"), second.report);
  });
});
