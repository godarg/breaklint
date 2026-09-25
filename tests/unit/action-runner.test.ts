/**
 * The GitHub Action's runner (`action/run.mjs`), driven the way `action.yml` drives it: one
 * process, `toJSON(inputs)` in `BREAKLINT_ACTION_INPUTS`, the runner's `GITHUB_OUTPUT` and
 * `GITHUB_STEP_SUMMARY` files, and its exit code as the step result.
 *
 * breaklint itself is replaced by a stand-in package whose CLI exits with a chosen code and
 * copies a chosen report into place, because the render needs Chrome. The stand-in's reporter
 * module is the REAL one from `src/report`, and one stand-in mode runs the real CLI in `--demo`
 * mode, so the projections the Action publishes are the real projections. The real package, the
 * real npm install and real Chrome are exercised end to end by the `action` job in
 * `.github/workflows/ci.yml`.
 *
 * What each test protects, and why it exists:
 * - exits 2, 3 and 4 always fail the step, and only 1 may be left ungated (AGENTS.md: a clean
 *   exit is evidence that the requested checks ran);
 * - no input can become a command, an option, or a workflow command;
 * - a failed run leaves no earlier run's SARIF behind to be uploaded as if it were this one;
 * - an exit 0 or 1 without the report that says so is no verdict (node's own crash exit is 1).
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  ALWAYS_FAILING_EXITS,
  INPUT_DEFAULTS,
  PEERS,
  REPORT_FILES,
  SUMMARY_LIMIT_BYTES,
  gateSentence,
  guardPath,
  nodeSatisfies,
  parseFailOnExit,
  platformRefusal,
  summaryText,
} from "../../action/run.mjs";
import { canonicalReportStates } from "../fixtures/report-states.ts";
import { junitProblems, markdownProblems, sarifProblems } from "../tools/report-format-checks.mjs";
import { ARMS, checkArm } from "../tools/action-selftest.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const RUN = join(ROOT, "action/run.mjs");
const CLI = join(ROOT, "src/cli/index.ts");
const PACKAGE = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
  version: string;
  peerDependencies: Record<string, string>;
  files: string[];
};

let scratch = "";
let reports: Record<"clean" | "findings" | "infrastructure" | "insufficient-coverage", string>;
let fakeBin = "";

/** A stand-in breaklint package: a scripted CLI and the real reporter module. */
function fakePackage(dir: string, version = PACKAGE.version): string {
  const root = join(dir, "node_modules", "breaklint");
  mkdirSync(join(root, "dist", "cli"), { recursive: true });
  mkdirSync(join(root, "dist", "report"), { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "breaklint", version, type: "module", exports: { "./package.json": "./package.json" },
  }));
  writeFileSync(join(root, "dist", "report", "index.js"),
    `export { render } from ${JSON.stringify(pathToFileURL(join(ROOT, "src/report/index.ts")).href)};\n`);
  writeFileSync(join(root, "dist", "cli", "index.js"), `
import { appendFileSync, copyFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
// argv[0] is this script, so a test can see which CLI the Action started.
const argv = process.argv.slice(1);
const out = argv[argv.indexOf("--out") + 1];
if (process.env.FAKE_RECORD) {
  appendFileSync(process.env.FAKE_RECORD, JSON.stringify({
    argv, cwd: process.cwd(), nodePath: process.env.NODE_PATH ?? null, chrome: process.env.BREAKLINT_CHROME ?? null,
  }) + "\\n");
}
const exit = Number(process.env.FAKE_EXIT ?? "0");
switch (process.env.FAKE_BEHAVIOUR ?? "report") {
  case "report": copyFileSync(process.env.FAKE_REPORT, out); process.exit(exit);
  case "noreport": process.stderr.write("fake breaklint: stopping before any report\\n"); process.exit(exit);
  case "signal": process.kill(process.pid, "SIGKILL"); break;
  case "commands":
    process.stdout.write("::error::injected by a document\\n::set-output name=exit-code::0\\n::add-mask::x\\n");
    copyFileSync(process.env.FAKE_REPORT, out); process.exit(exit);
  case "demo": {
    const run = spawnSync(process.execPath, ["--experimental-strip-types", ${JSON.stringify(CLI)}, "--demo", "--format", "json", "--out", out], { stdio: "inherit" });
    process.exit(run.status ?? 3);
  }
}
`);
  return root;
}

/** A stand-in npm: records its argv and lays out node_modules as `npm install` would. */
function writeFakeNpm(bin: string): void {
  mkdirSync(bin, { recursive: true });
  const npm = join(bin, "npm");
  writeFileSync(npm, `#!${process.execPath}
const { appendFileSync, cpSync, mkdirSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_NPM_RECORD, JSON.stringify({ args, cwd: process.cwd() }) + "\\n");
if (process.env.FAKE_NPM === "fail") process.exit(1);
for (const spec of args.filter((arg) => !arg.startsWith("-"))) {
  if (spec === "install") continue;
  const at = spec.lastIndexOf("@");
  const name = spec.endsWith(".tgz") || spec.startsWith("breaklint@") ? "breaklint" : spec.slice(0, at);
  const target = join(process.cwd(), "node_modules", name);
  if (name === "breaklint") { cpSync(process.env.FAKE_NPM_SOURCE, target, { recursive: true }); continue; }
  mkdirSync(target, { recursive: true });
  const version = process.env.FAKE_NPM === "wrong-peer" && name === "pagedjs" ? "0.4.2" : spec.slice(at + 1);
  writeFileSync(join(target, "package.json"), JSON.stringify({ name, version }));
}
`);
  chmodSync(npm, 0o755);
}

interface ActionRun {
  status: number | null;
  stdout: string;
  stderr: string;
  outputs: Record<string, string>;
  summary: string;
  records: { argv: string[]; cwd: string; nodePath: string | null; chrome: string | null }[];
  npmRecords: { args: string[]; cwd: string }[];
  workspace: string;
  runnerTemp: string;
}

function parseOutputs(text: string): Record<string, string> {
  const outputs: Record<string, string> = {};
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const match = /^([\w-]+)<<(\S+)$/u.exec(lines[i]!);
    if (!match) continue;
    const value: string[] = [];
    for (i += 1; i < lines.length && lines[i] !== match[2]; i += 1) value.push(lines[i]!);
    outputs[match[1]!] = value.join("\n");
  }
  return outputs;
}

interface RunOptions {
  inputs?: Record<string, unknown> | string;
  env?: Record<string, string>;
  workspace?: string;
  runnerTemp?: string;
  project?: boolean;
}

function runAction(options: RunOptions = {}): ActionRun {
  const workspace = options.workspace ?? mkdtempSync(join(scratch, "ws-"));
  const runnerTemp = options.runnerTemp ?? mkdtempSync(join(scratch, "rt-"));
  if (options.project ?? true) {
    if (!existsSync(join(workspace, "node_modules", "breaklint"))) fakePackage(workspace);
  }
  const outputFile = join(runnerTemp, "github-output");
  const summaryFile = join(runnerTemp, "step-summary");
  const record = join(runnerTemp, "breaklint-record.jsonl");
  const npmRecord = join(runnerTemp, "npm-record.jsonl");
  const inputs = options.inputs ?? {};
  const raw = typeof inputs === "string"
    ? inputs
    : JSON.stringify({ ...INPUT_DEFAULTS, "use-project-install": "true", ...inputs });
  const run = spawnSync(process.execPath, ["--experimental-strip-types", RUN], {
    cwd: workspace,
    encoding: "utf8",
    env: {
      PATH: `${fakeBin}:${dirname(process.execPath)}:/usr/bin:/bin`,
      HOME: process.env.HOME ?? scratch,
      GITHUB_WORKSPACE: workspace,
      RUNNER_TEMP: runnerTemp,
      GITHUB_OUTPUT: outputFile,
      GITHUB_STEP_SUMMARY: summaryFile,
      BREAKLINT_ACTION_INPUTS: raw,
      BREAKLINT_CHROME: process.execPath,
      FAKE_RECORD: record,
      FAKE_NPM_RECORD: npmRecord,
      ...options.env,
    },
  });
  const lines = (file: string) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
  return {
    status: run.status,
    stdout: run.stdout,
    stderr: run.stderr,
    outputs: existsSync(outputFile) ? parseOutputs(readFileSync(outputFile, "utf8")) : {},
    summary: existsSync(summaryFile) ? readFileSync(summaryFile, "utf8") : "",
    records: lines(record),
    npmRecords: lines(npmRecord),
    workspace,
    runnerTemp,
  };
}

function withReport(state: keyof typeof reports, exit: number, inputs: Record<string, unknown> = {}): ActionRun {
  const workspace = mkdtempSync(join(scratch, "ws-"));
  writeFileSync(join(workspace, "doc.html"), "<!doctype html><p>x</p>");
  return runAction({
    workspace,
    inputs: { paths: "doc.html", ...inputs },
    env: { FAKE_REPORT: reports[state], FAKE_EXIT: String(exit) },
  });
}

before(() => {
  scratch = mkdtempSync(join(tmpdir(), "breaklint-action-test-"));
  const states = canonicalReportStates();
  const written = {} as typeof reports;
  for (const [name, report] of Object.entries(states)) {
    const file = join(scratch, `${name}.json`);
    writeFileSync(file, JSON.stringify(report));
    written[name as keyof typeof reports] = file;
  }
  reports = written;
  fakeBin = join(scratch, "bin");
  writeFakeNpm(fakeBin);
});

after(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

describe("action.yml and the runner agree", () => {
  const actionYml = readFileSync(join(ROOT, "action.yml"), "utf8");

  /** The `inputs:` block of our own action.yml: name → default. Enough YAML for this file. */
  function declaredInputs(): Record<string, string> {
    const block = /\ninputs:\n([\s\S]*?)\n(?=\S)/u.exec(actionYml)?.[1] ?? "";
    const declared: Record<string, string> = {};
    let current = "";
    for (const line of block.split("\n")) {
      const name = /^ {2}([\w-]+):\s*$/u.exec(line);
      if (name) {
        current = name[1]!;
        declared[current] = "";
        continue;
      }
      const fallback = /^ {4}default:\s*"(.*)"\s*$/u.exec(line);
      if (fallback && current) declared[current] = fallback[1]!;
    }
    return declared;
  }

  it("declares exactly the inputs the runner accepts, with the same defaults", () => {
    assert.deepEqual(declaredInputs(), { ...INPUT_DEFAULTS });
  });

  it("hands every input over as toJSON(inputs) and pastes none into a script", () => {
    // The one run line of the composite step. Any `${{ inputs.x }}` inside a script would be
    // text substitution into bash: the classic workflow-injection shape.
    const yaml = actionYml.split("\n").filter((line) => !/^\s*#/u.test(line)).join("\n");
    const runs = [...yaml.matchAll(/^\s+run:\s*(.*)$/gmu)].map((m) => m[1]);
    assert.deepEqual(runs, ['node "$GITHUB_ACTION_PATH/action/run.mjs"']);
    assert.match(yaml, /BREAKLINT_ACTION_INPUTS: \$\{\{ toJSON\(inputs\) \}\}/u);
    assert.doesNotMatch(yaml, /\$\{\{[^}]*\binputs\./u, "an input is interpolated somewhere in action.yml");
    assert.match(yaml, /using: composite/u);
  });

  it("maps every output the runner sets, and no other", () => {
    const set = new Set([...readFileSync(RUN, "utf8").matchAll(/setOutput\("([\w-]+)"/gu)].map((m) => m[1]));
    const mapped = new Set([...actionYml.matchAll(/value: \$\{\{ steps\.breaklint\.outputs\.([\w-]+) \}\}/gu)].map((m) => m[1]));
    assert.deepEqual([...mapped].sort(), [...set].sort());
  });

  it("stays out of the npm package, while the recipe it points at ships with the docs", () => {
    // A private npm cache: the file list must not depend on the state of the caller's ~/.npm.
    const cache = mkdtempSync(join(scratch, "npm-cache-"));
    const run = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: ROOT, encoding: "utf8", env: { ...process.env, npm_config_cache: cache, npm_config_update_notifier: "false" },
    });
    assert.equal(run.status, 0, run.stderr);
    const files = (JSON.parse(run.stdout) as { files: { path: string }[] }[])[0]!.files.map((f) => f.path);
    assert.ok(files.length > 10, "npm pack listed almost nothing; the reader lost its subject");
    assert.deepEqual(files.filter((f) => f === "action.yml" || f.startsWith("action/") || f.startsWith("tests/")), []);
    assert.ok(files.includes("docs/ci-recipe.md"), "the recipe the README links to is not in the package");
  });

  it("pins the peers the packed-consumer gate measures, within package.json's peer ranges", () => {
    const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
    const line = /--save-exact \\\n\s+(pagedjs@\S+ pdfjs-dist@\S+ puppeteer-core@\S+)/u.exec(ci)?.[1];
    assert.ok(line, "ci.yml no longer installs the renderer peers in its packed-consumer step");
    const measured = Object.fromEntries(line.split(" ").map((spec) => [spec.slice(0, spec.lastIndexOf("@")), spec.slice(spec.lastIndexOf("@") + 1)]));
    assert.deepEqual(Object.fromEntries(PEERS), measured);
    for (const [name, version] of PEERS) {
      const range = PACKAGE.peerDependencies[name]!;
      const bounds = /^>=(\S+) <(\d+)$/u.exec(range);
      if (bounds) {
        assert.ok(nodeSatisfies(version, `>=${bounds[1]}`) && Number(version.split(".")[0]) < Number(bounds[2]), `${name}@${version} is outside ${range}`);
      } else {
        assert.equal(version, range, `${name}: package.json pins ${range}`);
      }
    }
  });
});

describe("the step result follows breaklint's exit code", () => {
  const byExit = { 0: "clean", 1: "findings", 3: "infrastructure", 4: "insufficient-coverage" } as const;

  it("fails the step with breaklint's own code on 1, 2, 3 and 4 by default, and passes only 0", () => {
    for (const [exit, state] of Object.entries(byExit)) {
      const run = withReport(state, Number(exit));
      assert.equal(run.status, Number(exit), `exit ${exit}: step rc ${run.status}\n${run.stdout}${run.stderr}`);
      assert.equal(run.outputs["exit-code"], exit);
      assert.equal(run.outputs.verdict, state);
    }
    const usage = runAction({ inputs: { paths: "doc.html" }, env: { FAKE_BEHAVIOUR: "noreport", FAKE_EXIT: "2" } });
    assert.equal(usage.status, 2);
    assert.equal(usage.outputs["exit-code"], "2");
    assert.equal(usage.outputs.verdict, "usage");
  });

  it("leaves exit 1 ungated only when asked, and says so where a reader looks", () => {
    const run = withReport("findings", 1, { "fail-on-exit": "2,3,4" });
    assert.equal(run.status, 0);
    assert.equal(run.outputs["exit-code"], "1");
    assert.match(run.stdout, /^::warning title=breaklint%3A exit 1::/mu);
    assert.match(run.summary, /\*\*not gated\*\*/u);
    // …and exit 4 still fails under that same setting.
    const blind = withReport("insufficient-coverage", 4, { "fail-on-exit": "2,3,4" });
    assert.equal(blind.status, 4);
  });

  it("refuses a fail-on-exit that would let 2, 3 or 4 pass, before breaklint starts", () => {
    for (const value of ["1,2,3", "1", "2,3", "1,3,4", "0,1,2,3,4", "5", "1,2,3,4,x", "1;2;3;4"]) {
      const run = withReport("clean", 0, { "fail-on-exit": value });
      assert.equal(run.status, 2, `fail-on-exit '${value}' was accepted`);
      assert.equal(run.records.length, 0, `fail-on-exit '${value}': breaklint was started`);
      assert.equal(run.outputs["exit-code"], "2");
      assert.equal(run.outputs.verdict, "not-run");
      assert.match(run.summary, /no report \(exit 2\)/u);
    }
    assert.deepEqual([...parseFailOnExit("4 3,2  1")].sort(), [1, 2, 3, 4]);
    assert.deepEqual(ALWAYS_FAILING_EXITS, [2, 3, 4]);
  });

  it("reads no verdict into an exit 0 or 1 without its report, a mismatching report, or a signal", () => {
    for (const exit of [0, 1]) {
      const run = runAction({ inputs: { paths: "doc.html" }, env: { FAKE_BEHAVIOUR: "noreport", FAKE_EXIT: String(exit) } });
      assert.equal(run.status, 3, `exit ${exit} without a report became step rc ${run.status}`);
      assert.equal(run.outputs["exit-code"], "3");
      assert.equal(run.outputs["sarif-file"], undefined);
      assert.equal(run.outputs.verdict, "infrastructure", "breaklint ran; its failure is not a run that never happened");
    }
    const mismatch = withReport("findings", 0);
    assert.equal(mismatch.status, 3, "a report saying 1 under a process exit 0 was accepted");
    assert.match(mismatch.stdout, /must agree/u);
    const killed = runAction({ inputs: { paths: "doc.html" }, env: { FAKE_BEHAVIOUR: "signal" } });
    assert.equal(killed.status, 3);
    assert.match(killed.stdout, /SIGKILL/u);
  });

  it("removes an earlier run's reports before running, so a failed run cannot pass them on", () => {
    const outputDir = join(mkdtempSync(join(scratch, "out-")), "reports");
    mkdirSync(join(outputDir, "evidence"), { recursive: true });
    for (const name of Object.values(REPORT_FILES)) writeFileSync(join(outputDir, name), "stale");
    writeFileSync(join(outputDir, "evidence", "old.png"), "stale");
    writeFileSync(join(outputDir, "keep.txt"), "not ours");
    const run = runAction({
      inputs: { paths: "doc.html", "output-dir": outputDir },
      env: { FAKE_BEHAVIOUR: "noreport", FAKE_EXIT: "3" },
    });
    assert.equal(run.status, 3);
    for (const name of Object.values(REPORT_FILES)) assert.equal(existsSync(join(outputDir, name)), false, `${name} survived`);
    assert.equal(existsSync(join(outputDir, "evidence")), false);
    assert.equal(readFileSync(join(outputDir, "keep.txt"), "utf8"), "not ours", "a file the Action does not own was touched");
    assert.equal(run.outputs["sarif-file"], undefined);
    assert.match(run.summary, /^# breaklint — no report \(exit 3\)/mu);
  });
});

describe("no input becomes a command, an option or a workflow command", () => {
  it("expands paths as bash globs and nothing else", () => {
    const workspace = mkdtempSync(join(scratch, "ws-"));
    for (const file of ["docs/a.html", "docs/B.html", "docs/sub/b.html", "docs/sub/deeper/c.html", "docs/.hidden.html", "docs/with space.html"]) {
      mkdirSync(dirname(join(workspace, file)), { recursive: true });
      writeFileSync(join(workspace, file), "<p>x</p>");
    }
    const run = runAction({
      workspace,
      inputs: { paths: "docs/**/*.html\n  docs/a.html  \n\n./docs/a.html\nnope/*.html\ndocs/{a,b}.html" },
      env: { FAKE_BEHAVIOUR: "noreport", FAKE_EXIT: "2" },
    });
    const argv = run.records[0]!.argv;
    const paths = argv.slice(argv.indexOf(argv.find((a) => a.endsWith("evidence"))!) + 1);
    assert.deepEqual(paths, [
      // byte order (LC_ALL=C), no dotfiles, the space kept, `**` across directories
      "docs/B.html", "docs/a.html", "docs/sub/b.html", "docs/sub/deeper/c.html", "docs/with space.html",
      // unmatched and brace patterns stay literal, as in bash; both spellings of a.html again are gone
      "nope/*.html", "docs/{a,b}.html",
    ]);
    assert.equal(run.records[0]!.cwd, workspace);
  });

  it("keeps shell syntax, leading dashes and unknown inputs inert", () => {
    const workspace = mkdtempSync(join(scratch, "ws-"));
    const hostile = [
      "$(touch PWNED-subst).html",
      "`touch PWNED-backtick`.html",
      "x.html; touch PWNED-semicolon",
      "x.html && touch PWNED-and",
      "--demo",
      "--allow-network",
      "-x.html",
    ];
    const run = runAction({
      workspace,
      inputs: { paths: hostile.join("\n"), "allow-network": "--demo\n$(touch PWNED-origin)", config: "$(touch PWNED-config)" },
      env: { FAKE_BEHAVIOUR: "noreport", FAKE_EXIT: "2" },
    });
    assert.equal(run.status, 2);
    for (const name of ["PWNED-subst", "PWNED-backtick", "PWNED-semicolon", "PWNED-and", "PWNED-origin", "PWNED-config"]) {
      assert.equal(existsSync(join(workspace, name)), false, `${name}: an input was executed`);
    }
    const argv = run.records[0]!.argv;
    for (const literal of ["$(touch PWNED-subst).html", "`touch PWNED-backtick`.html", "x.html; touch PWNED-semicolon", "./--demo", "./--allow-network", "./-x.html"]) {
      assert.ok(argv.includes(literal), `${literal} did not reach breaklint as one literal path: ${JSON.stringify(argv)}`);
    }
    // `--demo` appears only as the value of `--allow-network` (which breaklint rejects as an
    // origin), never as an option of its own.
    const demo = argv.flatMap((arg, index) => (arg === "--demo" ? [index] : []));
    assert.deepEqual(demo.map((index) => argv[index - 1]), ["--allow-network"], "a value turned into breaklint's --demo option");
    // Origins and the config path are values of their own flags, one argv element each.
    assert.deepEqual(argv.slice(argv.indexOf("--config"), argv.indexOf("--config") + 2), ["--config", "$(touch PWNED-config)"]);
    assert.equal(argv.filter((a) => a === "--allow-network").length, 2);
    assert.equal(guardPath("-a.html"), "./-a.html");
    assert.equal(guardPath("a-.html"), "a-.html");

    for (const inputs of [
      JSON.stringify({ ...INPUT_DEFAULTS, paths: "doc.html", "extra-args": "--no-evidence-binding" }),
      JSON.stringify({ ...INPUT_DEFAULTS, paths: "doc.html", "fail-on": "warn\n--demo" }),
      JSON.stringify({ ...INPUT_DEFAULTS, paths: "doc.html\u0007" }),
      JSON.stringify({ ...INPUT_DEFAULTS, paths: 1 }),
      JSON.stringify({ ...INPUT_DEFAULTS, paths: "doc.html", "fail-on": "warn --allow-network x" }),
      JSON.stringify({ ...INPUT_DEFAULTS, paths: "doc.html", profile: "lenient" }),
      JSON.stringify({ ...INPUT_DEFAULTS, paths: "doc.html", "use-project-install": "yes" }),
      JSON.stringify({ ...INPUT_DEFAULTS, paths: "" }),
      "not json",
      "",
    ]) {
      const refused = runAction({ inputs, env: { FAKE_BEHAVIOUR: "noreport", FAKE_EXIT: "0" } });
      assert.equal(refused.status, 2, `accepted: ${inputs}\n${refused.stdout}`);
      assert.equal(refused.records.length, 0, `breaklint was started for: ${inputs}`);
    }
  });

  it("prints breaklint's output where the runner does not honour workflow commands", () => {
    const workspace = mkdtempSync(join(scratch, "ws-"));
    writeFileSync(join(workspace, "doc.html"), "<p>x</p>");
    const run = runAction({
      workspace,
      inputs: { paths: "doc.html" },
      env: { FAKE_BEHAVIOUR: "commands", FAKE_REPORT: reports.clean, FAKE_EXIT: "0" },
    });
    assert.equal(run.status, 0);
    const lines = run.stdout.split("\n");
    const injected = lines.indexOf("::error::injected by a document");
    assert.ok(injected > 0, "the stand-in's output is missing");
    const open = lines.slice(0, injected).map((line, index) => ({ line, index })).reverse()
      .find(({ line }) => line.startsWith("::stop-commands::"));
    assert.ok(open, "breaklint's output was not preceded by ::stop-commands::");
    const token = open.line.slice("::stop-commands::".length);
    assert.match(token, /^[0-9a-f]{32}$/u);
    const close = lines.indexOf(`::${token}::`, injected);
    assert.ok(close > injected, "command processing was not resumed after breaklint's output, or before it");
    // The forged output did not win: the recorded exit code is the Action's.
    assert.equal(run.outputs["exit-code"], "0");
  });
});

describe("the projections are breaklint's own, from one run", () => {
  it("publishes SARIF, JUnit and Markdown equal to the CLI's own formats, and valid", () => {
    const workspace = mkdtempSync(join(scratch, "ws-"));
    const run = runAction({ workspace, inputs: { paths: "doc.html" }, env: { FAKE_BEHAVIOUR: "demo" } });
    assert.equal(run.status, 1, `${run.stdout}${run.stderr}`);
    assert.equal(run.outputs["exit-code"], "1");
    assert.equal(run.outputs.verdict, "findings");
    const own = (format: string): string => {
      const out = join(scratch, `demo-${format}-${Date.now()}`);
      const cli = spawnSync(process.execPath, ["--experimental-strip-types", CLI, "--demo", "--format", format, "--out", out], { cwd: ROOT, encoding: "utf8" });
      assert.equal(cli.status, 1, cli.stderr);
      return readFileSync(out, "utf8");
    };
    const sarif = readFileSync(run.outputs["sarif-file"]!, "utf8");
    assert.deepEqual(sarifProblems(JSON.parse(sarif)), []);
    assert.equal(sarif, own("sarif"), "the Action's SARIF differs from `breaklint --format sarif`");
    const junit = readFileSync(run.outputs["junit-file"]!, "utf8");
    assert.deepEqual(junitProblems(junit), []);
    const untimed = (xml: string) => xml.replace(/ time="[\d.]+"/u, "");
    assert.equal(untimed(junit), untimed(own("junit")), "the Action's JUnit differs from `breaklint --format junit`");
    const markdown = readFileSync(run.outputs["markdown-file"]!, "utf8");
    assert.deepEqual(markdownProblems(markdown, "findings"), []);
    assert.equal(markdown, own("markdown"), "the Action's Markdown differs from `breaklint --format markdown`");
    assert.ok(run.summary.startsWith(markdown.trimEnd()), "the step summary does not open with the report");
    assert.match(run.summary, /breaklint exit \*\*1\*\* \(at least one non-experimental finding reached the threshold\) — this step fails on exits 1, 2, 3, 4\./u);
    assert.match(run.stdout, /verdict: findings/u, "the console projection is not in the log");
    const report = JSON.parse(readFileSync(run.outputs["report-json"]!, "utf8")) as { exitCode: number };
    assert.equal(report.exitCode, 1);
  });

  it("names every file in its outputs and hands breaklint the files it was asked to write", () => {
    const run = withReport("clean", 0, { "fail-on": "warn", profile: "strict", config: "cfg.json", "allow-network": "https://fonts.example" });
    assert.equal(run.status, 0);
    const argv = run.records[0]!.argv;
    const outputDir = run.outputs["output-dir"]!;
    assert.equal(outputDir, join(run.runnerTemp, "breaklint-report"));
    assert.deepEqual(argv.slice(1, 7), ["--format", "json", "--out", join(outputDir, "breaklint.json"), "--out-dir", join(outputDir, "evidence")]);
    assert.deepEqual(argv.slice(7, -1), ["--fail-on", "warn", "--profile", "strict", "--config", "cfg.json", "--allow-network", "https://fonts.example"]);
    for (const [output, name] of [["report-json", "json"], ["sarif-file", "sarif"], ["junit-file", "junit"], ["markdown-file", "markdown"]] as const) {
      assert.equal(run.outputs[output], join(outputDir, REPORT_FILES[name]));
      assert.ok(existsSync(run.outputs[output]!), `${output} does not exist`);
    }
    assert.equal(run.outputs["breaklint-version"], PACKAGE.version);
    assert.equal(run.records[0]!.chrome, process.execPath);
  });
});

describe("installing breaklint", () => {
  function installRun(env: Record<string, string> = {}, inputs: Record<string, unknown> = {}, runnerTemp?: string): ActionRun {
    const source = mkdtempSync(join(scratch, "pkg-"));
    const workspace = mkdtempSync(join(scratch, "ws-"));
    writeFileSync(join(workspace, "doc.html"), "<p>x</p>");
    return runAction({
      workspace,
      project: false,
      ...(runnerTemp ? { runnerTemp } : {}),
      inputs: { paths: "doc.html", "use-project-install": "false", ...inputs },
      env: { FAKE_NPM_SOURCE: env.FAKE_NPM_SOURCE ?? fakePackage(source), FAKE_REPORT: reports.clean, FAKE_EXIT: "0", ...env },
    });
  }

  it("installs the pinned version and the pinned peers with scripts off, and resolves them for breaklint", () => {
    const run = installRun();
    assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
    assert.equal(run.npmRecords.length, 1);
    assert.deepEqual(run.npmRecords[0]!.args, [
      "install", "--no-audit", "--no-fund", "--ignore-scripts", "--no-package-lock", "--loglevel=error",
      `breaklint@${PACKAGE.version}`, "puppeteer-core@25.8.0", "pagedjs@0.4.3", "pdfjs-dist@6.2.108",
    ]);
    const installDir = run.npmRecords[0]!.cwd;
    assert.ok(installDir.startsWith(join(run.runnerTemp, "breaklint-action")), "installed outside RUNNER_TEMP");
    // breaklint resolves its peers from the working directory, and the workspace has none: the
    // Action's install is reached through NODE_PATH, and breaklint runs in the workspace.
    assert.equal(run.records[0]!.nodePath, join(installDir, "node_modules"));
    assert.equal(run.records[0]!.cwd, run.workspace);
    assert.equal(run.records[0]!.argv[0], join(installDir, "node_modules", "breaklint", "dist", "cli", "index.js"));
  });

  it("reuses an install within a job, and reinstalls one that did not finish", () => {
    const runnerTemp = mkdtempSync(join(scratch, "rt-"));
    const first = installRun({}, {}, runnerTemp);
    assert.equal(first.status, 0);
    const second = installRun({}, {}, runnerTemp);
    assert.equal(second.status, 0);
    assert.equal(second.npmRecords.length, 1, "the second run installed again");
    const installDir = second.npmRecords[0]!.cwd;
    rmSync(join(installDir, ".breaklint-action-install"));
    const third = installRun({}, {}, runnerTemp);
    assert.equal(third.status, 0);
    assert.equal(third.npmRecords.length, 2, "an install without its completion marker was reused");
  });

  it("stops with exit 3 when npm fails or installs something other than the pins", () => {
    assert.equal(installRun({ FAKE_NPM: "fail" }).status, 3);
    const wrongPeer = installRun({ FAKE_NPM: "wrong-peer" });
    assert.equal(wrongPeer.status, 3);
    assert.match(wrongPeer.stdout, /peer pagedjs: expected 0\.4\.3, installed 0\.4\.2/u);
    const other = mkdtempSync(join(scratch, "pkg-"));
    const wrongVersion = installRun({ FAKE_NPM_SOURCE: fakePackage(other, "0.0.1") });
    assert.equal(wrongVersion.status, 3);
    assert.match(wrongVersion.stdout, /installed breaklint 0\.0\.1, but this Action ref pins/u);
    for (const run of [wrongPeer, wrongVersion]) assert.equal(run.records.length, 0, "breaklint ran on an install that failed its check");
  });

  it("installs a named tarball instead, and refuses a missing one or a conflicting mode", () => {
    const workspace = mkdtempSync(join(scratch, "ws-"));
    writeFileSync(join(workspace, "breaklint-9.9.9.tgz"), "tarball bytes");
    writeFileSync(join(workspace, "doc.html"), "<p>x</p>");
    const source = fakePackage(mkdtempSync(join(scratch, "pkg-")), "9.9.9");
    const run = runAction({
      workspace, project: false,
      inputs: { paths: "doc.html", "use-project-install": "false", "breaklint-tarball": "breaklint-9.9.9.tgz" },
      env: { FAKE_NPM_SOURCE: source, FAKE_REPORT: reports.clean, FAKE_EXIT: "0" },
    });
    assert.equal(run.status, 0, run.stdout);
    assert.equal(run.npmRecords[0]!.args[6], join(workspace, "breaklint-9.9.9.tgz"));
    assert.equal(run.outputs["breaklint-version"], "9.9.9");
    assert.equal(installRun({}, { "breaklint-tarball": "missing.tgz" }).status, 2);
    assert.equal(installRun({}, { "breaklint-tarball": "breaklint.tar" }).status, 2);
    assert.equal(runAction({ inputs: { paths: "doc.html", "use-project-install": "true", "breaklint-tarball": "x.tgz" } }).status, 2);
  });

  it("says so when the project has no breaklint of its own, and warns about a shadowing peer", () => {
    const empty = runAction({ project: false, inputs: { paths: "doc.html", "use-project-install": "true" } });
    assert.equal(empty.status, 3);
    assert.match(empty.stdout, /breaklint is not installed in this workspace/u);
    const workspace = mkdtempSync(join(scratch, "ws-"));
    mkdirSync(join(workspace, "node_modules", "pagedjs"), { recursive: true });
    writeFileSync(join(workspace, "node_modules", "pagedjs", "package.json"), JSON.stringify({ name: "pagedjs", version: "0.4.1" }));
    writeFileSync(join(workspace, "doc.html"), "<p>x</p>");
    const shadowed = runAction({
      workspace, project: false,
      inputs: { paths: "doc.html", "use-project-install": "false" },
      env: { FAKE_NPM_SOURCE: fakePackage(mkdtempSync(join(scratch, "pkg-"))), FAKE_REPORT: reports.clean, FAKE_EXIT: "0" },
    });
    assert.match(shadowed.stdout, /^::warning title=breaklint Action%3A peer shadowed::pagedjs@0\.4\.1/mu);
  });
});

describe("the browser the Action hands breaklint", () => {
  it("takes chrome-path only as an existing absolute file, and never a missing BREAKLINT_CHROME", () => {
    assert.equal(withReport("clean", 0, { "chrome-path": "chrome" }).status, 2);
    assert.equal(withReport("clean", 0, { "chrome-path": join(scratch, "no-such-chrome") }).status, 2);
    const chosen = withReport("clean", 0, { "chrome-path": RUN });
    assert.equal(chosen.status, 0);
    assert.equal(chosen.records[0]!.chrome, RUN);
    assert.equal(chosen.outputs["chrome-path"], RUN);
    const missing = runAction({ inputs: { paths: "doc.html" }, env: { BREAKLINT_CHROME: join(scratch, "gone") } });
    assert.equal(missing.status, 3);
    assert.equal(missing.records.length, 0);
  });
});

describe("the CI job's assertion step can fail", () => {
  // `tests/tools/action-selftest.mjs` is what turns the `action` job's continue-on-error arms
  // back into a verdict. A checker that passes everything would make that job green over nothing.
  it("accepts an arm that did what it must, and names each way one did not", () => {
    const run = withReport("clean", 0);
    assert.equal(run.status, 0);
    const step = { outcome: "success", conclusion: "success", outputs: run.outputs };
    assert.deepEqual(checkArm("CLEAN", step, ARMS.CLEAN), []);
    const wrong = (patch: Record<string, unknown>, outputs: Record<string, string> = {}) =>
      checkArm("CLEAN", { ...step, ...patch, outputs: { ...run.outputs, ...outputs } }, ARMS.CLEAN);
    assert.match(wrong({ outcome: "failure" }).join("\n"), /step outcome failure/u);
    assert.match(wrong({}, { "exit-code": "4" }).join("\n"), /exit-code output "4"/u);
    assert.match(wrong({}, { verdict: "findings" }).join("\n"), /verdict output/u);
    assert.match(wrong({}, { "sarif-file": join(scratch, "no-such.sarif") }).join("\n"), /sarif-file names no file/u);
    const sarif = JSON.parse(readFileSync(run.outputs["sarif-file"]!, "utf8"));
    sarif.runs[0].invocations[0].exitCode = 1;
    const tampered = join(scratch, `tampered-${Date.now()}.sarif`);
    writeFileSync(tampered, JSON.stringify(sarif));
    assert.match(wrong({}, { "sarif-file": tampered }).join("\n"), /SARIF invocation exitCode 1/u);
    // An arm that must not have a report fails when it has one.
    assert.match(checkArm("USAGE", { outcome: "failure", outputs: { ...run.outputs, "exit-code": "2", verdict: "usage" } }, ARMS.USAGE).join("\n"), /report-json is set/u);
  });

  it("is wired to every arm of the action job, and only the failing arms continue on error", () => {
    const ci = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
    const job = ci.slice(ci.indexOf("\n  action:\n"), ci.indexOf("\n  action-code-scanning:\n"));
    assert.ok(job.length > 100, "ci.yml has no action job");
    const wired = Object.fromEntries([...job.matchAll(/^\s+ARM_([A-Z]+): \$\{\{ toJSON\(steps\.([a-z]+)\) \}\}$/gmu)].map((m) => [m[1], m[2]]));
    assert.deepEqual(Object.keys(wired).sort(), Object.keys(ARMS).sort());
    const steps = job.split(/\n(?=      - )/u);
    for (const [arm, id] of Object.entries(wired)) {
      assert.equal(id, arm.toLowerCase());
      const step = steps.find((text) => new RegExp(`\\n\\s+id: ${id}\\n`, "u").test(text));
      assert.ok(step, `ci.yml has no step with id ${id}`);
      assert.match(step, /uses: \.\/\n/u, `${id} does not run the Action from this checkout`);
      assert.equal(/continue-on-error: true/u.test(step), ARMS[arm as keyof typeof ARMS].outcome === "failure", `${id}: continue-on-error disagrees with the expected outcome`);
    }
    assert.match(job, /INJECTION_CANARY: \$\{\{ runner\.temp \}\}\/breaklint-action-canary/u);
    assert.match(job, /\$\(touch "\$RUNNER_TEMP\/breaklint-action-canary"\)\.html/u);
    const code = job.split("\n").filter((line) => !/^\s*#/u.test(line)).join("\n");
    assert.doesNotMatch(code, /security-events/u, "the job that renders HTML holds a security-events permission");
  });

  it("fails when the workflow stops passing an arm", () => {
    const run = spawnSync(process.execPath, [join(ROOT, "tests/tools/action-selftest.mjs")], { encoding: "utf8", env: { PATH: process.env.PATH ?? "" } });
    assert.equal(run.status, 1);
    assert.match(run.stderr, /ARM_CLEAN is not set/u);
    assert.match(run.stderr, /INJECTION_CANARY is not set/u);
  });
});

describe("the runner's small parts", () => {
  it("reads the engines range and refuses Windows", () => {
    assert.equal(nodeSatisfies("v22.13.0", ">=22.13.0"), true);
    assert.equal(nodeSatisfies("22.12.9", ">=22.13.0"), false);
    assert.equal(nodeSatisfies("v24.0.0", ">=22.13.0"), true);
    assert.equal(nodeSatisfies("v20.19.0", ">=22.13.0"), false);
    assert.equal(nodeSatisfies("v24.0.0", "^22"), false, "an unreadable range must not read as satisfied");
    assert.match(platformRefusal("win32") ?? "", /Windows/u);
    assert.equal(platformRefusal("linux"), null);
  });

  it("cuts a summary below GitHub's limit and keeps the gate sentence", () => {
    const trailer = gateSentence(1, new Set([1, 2, 3, 4]));
    const small = summaryText("# breaklint — findings\n", trailer);
    assert.ok(small.endsWith(`${trailer}\n`));
    const big = `# breaklint — findings\n${"| a | b |\n".repeat(200_000)}`;
    const cut = summaryText(big, trailer);
    assert.ok(Buffer.byteLength(cut, "utf8") <= SUMMARY_LIMIT_BYTES);
    assert.match(cut, /was cut at \d+ bytes/u);
    assert.ok(cut.endsWith(`${trailer}\n`));
    assert.ok(cut.startsWith("# breaklint — findings\n"));
  });
});
