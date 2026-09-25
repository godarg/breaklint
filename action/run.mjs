#!/usr/bin/env node
/**
 * The runner behind the composite Action in `action.yml`.
 *
 * WHAT IT PROMISES. A step that ends green has evidence that breaklint ran over the documents it
 * was given, measured them, and found nothing the gate stops on. Every other outcome fails the
 * step with breaklint's own exit code (1 findings, 2 invalid invocation, 3 infrastructure, 4
 * nothing or too little was judged), and the Action's own setup failures use the same table: a
 * bad input is a 2, an install or environment that cannot run the check is a 3. Only exit 1 may
 * be left ungated (`fail-on-exit: 2,3,4`); 2, 3 and 4 always fail the step, because each of them
 * says that the requested check did not run, or judged too little, and a gate that passes on
 * them is a green over nothing.
 *
 * ONE RUN, FOUR FORMATS. breaklint is run once, with `--format json`. JSON is the canonical
 * report and every other format is a lossy projection of it, so SARIF, JUnit, Markdown and the
 * console text for the log are rendered from that one report by the installed package's own
 * reporter module. They therefore describe the same run, and a document is rendered by Chrome
 * once rather than four times. The reporter module is not a public export of the package, which
 * is why the Action installs the breaklint version of its own ref and refuses a build whose
 * reporter module it cannot load (exit 3) rather than guessing.
 *
 * NO INTERPOLATION. `action.yml` hands every input over as ONE environment variable holding
 * `toJSON(inputs)`. Nothing from an input is ever pasted into a shell script. Paths are expanded
 * by bash (`globstar`, byte-order sorting) with the patterns in an environment variable and no
 * `eval`, so a pattern is subject to word splitting on newlines and pathname expansion and to
 * nothing else. breaklint is spawned without a shell. A path that starts with `-` is passed as
 * `./-…`, because breaklint has no `--` and would otherwise read it as an option. breaklint's own
 * output is printed between `::stop-commands::` markers, so text from a document cannot issue
 * workflow commands to the runner.
 *
 * Plain Node built-ins only, and nothing newer than the oldest Node a runner may still carry, so
 * that a too-old Node gets a sentence rather than a syntax error.
 */

import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, posix, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ACTION_PACKAGE = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8"));

/**
 * The renderer peers this Action installs next to breaklint, exactly the set the packed-consumer
 * step in `.github/workflows/ci.yml` installs and measures. `tests/unit/action-runner.test.ts`
 * holds both, and `package.json`'s `peerDependencies`, against this list.
 */
export const PEERS = Object.freeze([
  ["puppeteer-core", "25.8.0"],
  ["pagedjs", "0.4.3"],
  ["pdfjs-dist", "6.2.108"],
]);

/** Every input `action.yml` declares, with the default it declares. Nothing else is accepted. */
export const INPUT_DEFAULTS = Object.freeze({
  "paths": "",
  "fail-on-exit": "1,2,3,4",
  "fail-on": "",
  "profile": "",
  "config": "",
  "allow-network": "",
  "output-dir": "",
  "chrome-path": "",
  "use-project-install": "false",
  "breaklint-tarball": "",
});

/** Exits that say the check did not run or judged too little. None of them may pass a step. */
export const ALWAYS_FAILING_EXITS = Object.freeze([2, 3, 4]);

export const EXIT_MEANING = Object.freeze({
  0: "checked, coverage met, nothing reached the threshold",
  1: "at least one non-experimental finding reached the threshold",
  2: "invalid invocation",
  3: "infrastructure: the check could not run to the end",
  4: "nothing or too little was judged",
});

export const REPORT_FILES = Object.freeze({
  json: "breaklint.json",
  sarif: "breaklint.sarif",
  junit: "breaklint.junit.xml",
  markdown: "breaklint.md",
});
export const EVIDENCE_DIR = "evidence";

/** GitHub rejects a step summary above 1 MiB; stay well below it and say what was cut. */
export const SUMMARY_LIMIT_BYTES = 900 * 1024;

const INSTALL_MARKER = ".breaklint-action-install";
/** Set once breaklint has been started, so a later failure is not reported as "never ran". */
let breaklintStarted = false;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/u;

export class ActionFailure extends Error {
  constructor(exitCode, message) {
    super(message);
    this.exitCode = exitCode;
  }
}
const usage = (message) => new ActionFailure(2, message);
const infrastructure = (message) => new ActionFailure(3, message);

/** Parse `toJSON(inputs)`. Unknown keys, non-string values and control characters are refused. */
export function parseActionInputs(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw usage("BREAKLINT_ACTION_INPUTS is not set; run this file through action.yml, which passes toJSON(inputs).");
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw usage(`BREAKLINT_ACTION_INPUTS is not JSON (${error.message}).`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw usage("BREAKLINT_ACTION_INPUTS must be a JSON object of input names to strings.");
  }
  const unknown = Object.keys(parsed).filter((key) => !Object.hasOwn(INPUT_DEFAULTS, key)).sort();
  if (unknown.length > 0) {
    throw usage(
      `unknown input${unknown.length === 1 ? "" : "s"} ${unknown.map((k) => `'${k}'`).join(", ")}. ` +
        `Accepted: ${Object.keys(INPUT_DEFAULTS).join(", ")}.`,
    );
  }
  const inputs = {};
  for (const [name, fallback] of Object.entries(INPUT_DEFAULTS)) {
    const value = Object.hasOwn(parsed, name) ? parsed[name] : fallback;
    if (typeof value !== "string") throw usage(`input '${name}' must be a string, got ${JSON.stringify(value)}.`);
    const normalised = value.replace(/\r\n?/gu, "\n");
    const multiLine = name === "paths" || name === "allow-network";
    if (CONTROL.test(normalised) || (!multiLine && normalised.includes("\n"))) {
      throw usage(`input '${name}' contains a control character${multiLine ? "" : " or a line break"}.`);
    }
    inputs[name] = normalised.trim() === "" ? fallback : normalised.trim();
  }
  return validateInputs(inputs);
}

function oneOf(name, value, allowed) {
  if (value !== "" && !allowed.includes(value)) {
    throw usage(`input '${name}' must be one of ${allowed.join(", ")}; got '${value}'.`);
  }
  return value;
}

export function splitLines(text) {
  return text.split("\n").map((line) => line.trim()).filter((line) => line !== "");
}

/**
 * `fail-on-exit`: which of breaklint's exit codes fail the step. 2, 3 and 4 are mandatory: each
 * says that the requested check did not run or judged too little. Only 1 may be left out.
 */
export function parseFailOnExit(text) {
  const tokens = text.split(/[\s,]+/u).filter(Boolean);
  if (tokens.length === 0) throw usage("input 'fail-on-exit' is empty.");
  const codes = new Set();
  for (const token of tokens) {
    if (!/^[1-4]$/u.test(token)) {
      throw usage(`input 'fail-on-exit' takes breaklint exit codes 1 to 4; '${token}' is not one.`);
    }
    codes.add(Number(token));
  }
  const missing = ALWAYS_FAILING_EXITS.filter((code) => !codes.has(code));
  if (missing.length > 0) {
    throw usage(
      `input 'fail-on-exit' leaves out ${missing.join(", ")}. Exits 2, 3 and 4 always fail the step: ` +
        "they say the check did not run or judged too little, and a gate that passes on them is a " +
        "green over nothing. Only exit 1 (findings) may be left out, e.g. 'fail-on-exit: 2,3,4'.",
    );
  }
  return codes;
}

function validateInputs(inputs) {
  const paths = splitLines(inputs["paths"]);
  if (paths.length === 0) throw usage("input 'paths' is required: one HTML path or bash glob per line.");
  const useProjectInstall = inputs["use-project-install"];
  if (useProjectInstall !== "true" && useProjectInstall !== "false") {
    throw usage(`input 'use-project-install' must be 'true' or 'false'; got '${useProjectInstall}'.`);
  }
  if (useProjectInstall === "true" && inputs["breaklint-tarball"] !== "") {
    throw usage("inputs 'use-project-install' and 'breaklint-tarball' exclude each other.");
  }
  const tarball = inputs["breaklint-tarball"];
  if (tarball !== "" && !tarball.endsWith(".tgz")) {
    throw usage(`input 'breaklint-tarball' must name an npm pack tarball ending in .tgz; got '${tarball}'.`);
  }
  const chrome = inputs["chrome-path"];
  if (chrome !== "" && !isAbsolute(chrome)) {
    throw usage(`input 'chrome-path' must be an absolute path; got '${chrome}'.`);
  }
  return {
    paths,
    failOnExit: parseFailOnExit(inputs["fail-on-exit"]),
    failOn: oneOf("fail-on", inputs["fail-on"], ["error", "warn", "never"]),
    profile: oneOf("profile", inputs["profile"], ["default", "strict"]),
    config: inputs["config"],
    allowNetwork: splitLines(inputs["allow-network"]),
    outputDir: inputs["output-dir"],
    chromePath: chrome,
    useProjectInstall: useProjectInstall === "true",
    tarball,
  };
}

/** `>=X.Y.Z`, the one form `engines` uses here. Anything else is unreadable, not satisfied. */
export function nodeSatisfies(version, range) {
  const want = /^>=\s*(\d+)\.(\d+)\.(\d+)$/u.exec(String(range).trim());
  const have = /^v?(\d+)\.(\d+)\.(\d+)/u.exec(String(version));
  if (!want || !have) return false;
  for (let i = 1; i <= 3; i += 1) {
    const a = Number(have[i]);
    const b = Number(want[i]);
    if (a !== b) return a > b;
  }
  return true;
}

export function platformRefusal(platform) {
  return platform === "win32"
    ? "breaklint does not support Windows: process termination rests on POSIX process groups. Use a Linux runner."
    : null;
}

/**
 * Expand patterns the way `breaklint <patterns>` in bash would, with `globstar` on and a byte
 * order that does not depend on the runner's locale. A pattern that matches nothing stays
 * literal, as it does in bash, so breaklint itself reports it as a missing input (exit 2).
 * Duplicates (the same normalised path from two patterns) are checked once.
 */
export function expandPatterns(patterns, cwd) {
  const script = [
    "shopt -s globstar 2>/dev/null || { echo 'bash without globstar (bash 4 or newer is required)' >&2; exit 97; }",
    "shopt -u nullglob failglob dotglob nocaseglob extglob",
    "IFS=$'\\n'",
    "set +f",
    // Unquoted on purpose: word splitting on newlines, then pathname expansion, and nothing else.
    // The value is never evaluated, so `$(...)`, backticks and `;` inside it stay literal.
    'for pattern in $BREAKLINT_ACTION_PATTERNS; do printf "%s\\0" "$pattern"; done',
  ].join("\n");
  const run = spawnSync("bash", ["--noprofile", "--norc", "-c", script], {
    cwd,
    // A minimal environment: no BASH_ENV, SHELLOPTS or GLOBIGNORE from the job can reach it.
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin", LC_ALL: "C", BREAKLINT_ACTION_PATTERNS: patterns.join("\n") },
    encoding: "buffer",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (run.error) throw infrastructure(`could not run bash to expand 'paths': ${run.error.message}`);
  if (run.status !== 0) {
    throw infrastructure(`bash could not expand 'paths' (exit ${run.status}): ${run.stderr.toString("utf8").trim()}`);
  }
  const seen = new Set();
  const paths = [];
  for (const entry of run.stdout.toString("utf8").split("\0")) {
    if (entry === "") continue;
    // Compared normalised, passed on as bash produced it.
    const key = posix.normalize(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push(entry);
  }
  return paths;
}

/** breaklint has no `--`, so an input path must never be able to read as an option. */
export function guardPath(path) {
  return path.startsWith("-") ? `./${path}` : path;
}

export function breaklintArguments({ cli, jsonPath, evidenceDir, inputs, paths }) {
  return [
    cli,
    "--format", "json",
    "--out", jsonPath,
    "--out-dir", evidenceDir,
    ...(inputs.failOn ? ["--fail-on", inputs.failOn] : []),
    ...(inputs.profile ? ["--profile", inputs.profile] : []),
    ...(inputs.config ? ["--config", inputs.config] : []),
    ...inputs.allowNetwork.flatMap((origin) => ["--allow-network", origin]),
    ...paths.map(guardPath),
  ];
}

// ---------------------------------------------------------------------------------------------
// Workflow commands, outputs and the step summary.

export function escapeData(text) {
  return String(text).replace(/%/gu, "%25").replace(/\r/gu, "%0D").replace(/\n/gu, "%0A");
}

function escapeProperty(text) {
  return escapeData(text).replace(/:/gu, "%3A").replace(/,/gu, "%2C");
}

function annotate(level, title, message) {
  process.stdout.write(`::${level} title=${escapeProperty(title)}::${escapeData(message)}\n`);
}

/** Print text no workflow command inside of which is honoured. */
export function printUntrusted(text) {
  if (!text) return;
  const token = randomBytes(16).toString("hex");
  process.stdout.write(`::stop-commands::${token}\n`);
  process.stdout.write(text.endsWith("\n") ? text : `${text}\n`);
  process.stdout.write(`::${token}::\n`);
}

function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  const text = String(value);
  if (!file) {
    process.stdout.write(`breaklint Action output ${name}=${text}\n`);
    return;
  }
  let delimiter;
  do delimiter = `breaklint_${randomBytes(12).toString("hex")}`; while (text.includes(delimiter));
  appendFileSync(file, `${name}<<${delimiter}\n${text}\n${delimiter}\n`);
}

/** A fence longer than any backtick run inside, so no text can close it. */
function fenced(text) {
  const longest = Math.max(2, ...[...String(text).matchAll(/`+/gu)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  return `${fence}text\n${text}\n${fence}`;
}

export function gateSentence(exitCode, failOnExit) {
  const gated = [...failOnExit].sort((a, b) => a - b).join(", ");
  const meaning = EXIT_MEANING[exitCode] ?? "unknown";
  if (failOnExit.has(exitCode)) {
    return `breaklint exit **${exitCode}** (${meaning}) — this step fails on exits ${gated}.`;
  }
  if (exitCode === 0) return `breaklint exit **0** (${meaning}) — this step passes; it fails on exits ${gated}.`;
  return (
    `breaklint exit **${exitCode}** (${meaning}) — **not gated**: this step fails only on exits ${gated}, ` +
    "so the findings above are reported, not enforced."
  );
}

/** The Markdown for the step summary, cut below GitHub's 1 MiB limit with a pointer to the rest. */
export function summaryText(markdown, trailer, limit = SUMMARY_LIMIT_BYTES) {
  const full = `${markdown.replace(/\n*$/u, "")}\n\n${trailer}\n`;
  if (Buffer.byteLength(full, "utf8") <= limit) return full;
  const note = `\n\n> The report above was cut at ${limit} bytes to fit the step summary. ` +
    "The complete Markdown is in the Action's `markdown-file` output; the canonical JSON in `report-json`.\n\n" +
    `${trailer}\n`;
  let cut = Buffer.from(markdown, "utf8").subarray(0, limit - Buffer.byteLength(note, "utf8")).toString("utf8");
  cut = cut.replace(/\uFFFD$/u, "");
  return `${cut.slice(0, cut.lastIndexOf("\n") + 1)}${note}`;
}

function appendSummary(text) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, text.endsWith("\n") ? `${text}\n` : `${text}\n\n`);
}

// ---------------------------------------------------------------------------------------------
// Resolving and installing breaklint.

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function readVersion(packageDir) {
  try {
    return JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")).version ?? null;
  } catch {
    return null;
  }
}

/** The CommonJS lookup chain from `cwd`, which is where breaklint looks for its peers first. */
export function shadowingPeers(cwd) {
  const found = [];
  for (const [name] of PEERS) {
    let dir = resolve(cwd);
    for (;;) {
      const candidate = join(dir, "node_modules", name);
      if (existsSync(join(candidate, "package.json"))) {
        found.push({ name, dir: candidate, version: readVersion(candidate) });
        break;
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return found;
}

function projectInstall(workspace) {
  let packageJson;
  try {
    packageJson = createRequire(join(workspace, "noop.js")).resolve("breaklint/package.json");
  } catch {
    throw infrastructure(
      "use-project-install is true, but breaklint is not installed in this workspace. " +
        "Add breaklint and its peers to devDependencies and run `npm ci` before this step.",
    );
  }
  return { root: dirname(packageJson), nodePath: null };
}

function actionInstall(workspace, inputs) {
  const spec = inputs.tarball
    ? resolve(workspace, inputs.tarball)
    : `breaklint@${ACTION_PACKAGE.version}`;
  let tarballSha256 = null;
  if (inputs.tarball) {
    if (!existsSync(spec) || !statSync(spec).isFile()) {
      throw usage(`input 'breaklint-tarball' names no file: ${inputs.tarball}`);
    }
    tarballSha256 = sha256File(spec);
  }
  const specs = [spec, ...PEERS.map(([name, version]) => `${name}@${version}`)];
  // Reused within a job when the same bytes were installed the same way; anything else reinstalls.
  const key = createHash("sha256")
    .update(JSON.stringify({ specs, tarballSha256, node: process.versions.node, platform: process.platform }))
    .digest("hex");
  const base = process.env.RUNNER_TEMP || tmpdir();
  const dir = join(base, "breaklint-action", key.slice(0, 20));
  const marker = join(dir, INSTALL_MARKER);
  const reused = existsSync(marker) && readFileSync(marker, "utf8") === key;
  if (!reused) {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), `${JSON.stringify({ name: "breaklint-action-install", private: true }, null, 2)}\n`);
    process.stdout.write(`breaklint Action: installing ${specs.map((s) => (s === spec && inputs.tarball ? inputs.tarball : s)).join(" ")}\n`);
    const npm = spawnSync(
      "npm",
      ["install", "--no-audit", "--no-fund", "--ignore-scripts", "--no-package-lock", "--loglevel=error", ...specs],
      {
        cwd: dir,
        stdio: ["ignore", "inherit", "inherit"],
        // puppeteer-core never downloads a browser; the flags hold if a peer ever pulls in one that would.
        env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: "1", PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: "1" },
      },
    );
    if (npm.error) throw infrastructure(`could not run npm to install breaklint: ${npm.error.message}`);
    if (npm.status !== 0) throw infrastructure(`npm install of breaklint and its peers failed (exit ${npm.status}).`);
  } else {
    process.stdout.write("breaklint Action: reusing the install made earlier in this job\n");
  }
  const root = join(dir, "node_modules", "breaklint");
  const installed = readVersion(root);
  if (installed === null) throw infrastructure(`npm reported success, but ${root} holds no breaklint package.`);
  if (!inputs.tarball && installed !== ACTION_PACKAGE.version) {
    throw infrastructure(`npm installed breaklint ${installed}, but this Action ref pins ${ACTION_PACKAGE.version}.`);
  }
  for (const [name, version] of PEERS) {
    const got = readVersion(join(dir, "node_modules", name));
    if (got !== version) throw infrastructure(`peer ${name}: expected ${version}, installed ${got ?? "nothing"}.`);
  }
  if (!reused) writeFileSync(marker, key);
  return { root, nodePath: join(dir, "node_modules") };
}

function resolveChrome(inputs) {
  if (inputs.chromePath) {
    if (!existsSync(inputs.chromePath) || !statSync(inputs.chromePath).isFile()) {
      throw usage(`input 'chrome-path' names no file: ${inputs.chromePath}`);
    }
    return inputs.chromePath;
  }
  const fromEnv = process.env.BREAKLINT_CHROME;
  if (fromEnv) {
    // breaklint itself would fall back to its own candidates; the Action does not let a browser
    // other than the one the job named do the rendering.
    if (!existsSync(fromEnv) || !statSync(fromEnv).isFile()) {
      throw infrastructure(`BREAKLINT_CHROME is set to ${fromEnv}, which is not a file.`);
    }
    return fromEnv;
  }
  // The runner images put Google Chrome on PATH. Without one, breaklint's own resolver decides
  // and names every place it looked.
  for (const name of ["google-chrome", "google-chrome-stable"]) {
    for (const dir of (process.env.PATH ?? "").split(":")) {
      const candidate = join(dir || ".", name);
      if (isAbsolute(candidate) && existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
  }
  return null;
}

async function loadReporters(root) {
  const file = join(root, "dist", "report", "index.js");
  if (!existsSync(file)) {
    throw infrastructure(`this breaklint build has no reporter module at dist/report/index.js; the Action cannot project SARIF, JUnit or Markdown from it.`);
  }
  const reporters = await import(pathToFileURL(file).href);
  if (typeof reporters.render !== "function") {
    throw infrastructure("the installed breaklint reporter module exports no render(); the Action cannot project SARIF, JUnit or Markdown from it.");
  }
  return reporters;
}

// ---------------------------------------------------------------------------------------------
// The run.

function removeStale(outputDir) {
  // A failed run must never leave the previous run's SARIF looking like this run's.
  for (const name of Object.values(REPORT_FILES)) rmSync(join(outputDir, name), { force: true });
  rmSync(join(outputDir, EVIDENCE_DIR), { recursive: true, force: true });
}

function finish(exitCode, failOnExit, summary) {
  setOutput("exit-code", exitCode);
  appendSummary(summary);
  process.exitCode = failOnExit.has(exitCode) ? exitCode : 0;
}

function actionError(failure, failOnExit) {
  const code = failure instanceof ActionFailure ? failure.exitCode : 3;
  const message = failure instanceof Error ? failure.message : String(failure);
  annotate("error", `breaklint Action: exit ${code}`, message);
  setOutput("verdict", breaklintStarted ? "infrastructure" : "not-run");
  const what = breaklintStarted
    ? "breaklint ran, but what it left is not a verdict the Action can pass on."
    : "The Action stopped before breaklint ran.";
  finish(code, failOnExit, `# breaklint — no report (exit ${code})\n\n${what}\n\n${fenced(message)}\n\n${gateSentence(code, failOnExit)}`);
}

export async function main() {
  // Until the inputs are read, the default gate applies to the Action's own failures.
  let failOnExit = parseFailOnExit(INPUT_DEFAULTS["fail-on-exit"]);
  try {
    const refusal = platformRefusal(process.platform);
    if (refusal) throw infrastructure(refusal);
    const inputs = parseActionInputs(process.env.BREAKLINT_ACTION_INPUTS);
    failOnExit = inputs.failOnExit;
    await runAction(inputs);
  } catch (failure) {
    if (!(failure instanceof ActionFailure)) {
      process.stderr.write(`${failure instanceof Error ? failure.stack ?? failure.message : String(failure)}\n`);
    }
    actionError(failure, failOnExit);
  }
}

async function runAction(inputs) {
  const workspace = resolve(process.env.GITHUB_WORKSPACE || process.cwd());
  const outputDir = resolve(workspace, inputs.outputDir || join(process.env.RUNNER_TEMP || tmpdir(), "breaklint-report"));
  if (existsSync(outputDir) && !statSync(outputDir).isDirectory()) {
    throw usage(`input 'output-dir' names a file, not a directory: ${inputs.outputDir}`);
  }
  mkdirSync(outputDir, { recursive: true });
  removeStale(outputDir);
  const files = Object.fromEntries(Object.entries(REPORT_FILES).map(([format, name]) => [format, join(outputDir, name)]));
  const evidenceDir = join(outputDir, EVIDENCE_DIR);
  setOutput("output-dir", outputDir);

  const engines = ACTION_PACKAGE.engines?.node ?? "";
  if (!nodeSatisfies(process.versions.node, engines)) {
    throw infrastructure(
      `breaklint needs Node ${engines || "(unreadable engines field)"}; this runner has ${process.version}. ` +
        "Add actions/setup-node with node-version 24 before this step.",
    );
  }

  const chrome = resolveChrome(inputs);
  if (chrome) setOutput("chrome-path", chrome);
  const installation = inputs.useProjectInstall ? projectInstall(workspace) : actionInstall(workspace, inputs);
  const version = readVersion(installation.root);
  setOutput("breaklint-version", version ?? "");
  if (installation.nodePath) {
    for (const peer of shadowingPeers(workspace)) {
      annotate(
        "warning",
        "breaklint Action: peer shadowed",
        `${peer.name}@${peer.version ?? "unknown"} in the workspace is resolved before the Action's pinned copy. ` +
          "breaklint looks for its peers from the working directory first. Pin the peers in your project and set " +
          "use-project-install: true, or remove the other copy.",
      );
    }
  }
  const reporters = await loadReporters(installation.root);

  const paths = expandPatterns(inputs.paths, workspace);
  const cli = join(installation.root, "dist", "cli", "index.js");
  const args = breaklintArguments({ cli, jsonPath: files.json, evidenceDir, inputs, paths });
  const env = { ...process.env, PUPPETEER_SKIP_DOWNLOAD: "1", PUPPETEER_SKIP_CHROMIUM_DOWNLOAD: "1" };
  if (chrome) env.BREAKLINT_CHROME = chrome;
  if (installation.nodePath) {
    env.NODE_PATH = process.env.NODE_PATH ? `${installation.nodePath}:${process.env.NODE_PATH}` : installation.nodePath;
  }
  process.stdout.write(`breaklint Action: breaklint ${version} over ${paths.length} path(s); Chrome: ${chrome ?? "breaklint's own lookup"}\n`);

  // The marker has to reach the runner before the first byte breaklint writes, and both of
  // breaklint's streams go to this one stdout so no line can overtake it on another pipe.
  const token = randomBytes(16).toString("hex");
  await new Promise((done) => process.stdout.write(`::stop-commands::${token}\n`, done));
  breaklintStarted = true;
  const child = spawnSync(process.execPath, args, { cwd: workspace, env, stdio: ["ignore", 1, 1] });
  process.stdout.write(`::${token}::\n`);

  if (child.error) throw infrastructure(`could not start breaklint: ${child.error.message}`);
  if (child.signal) throw infrastructure(`breaklint was terminated by ${child.signal}; no verdict exists.`);
  const status = child.status;
  if (!Number.isInteger(status) || status < 0 || status > 4) {
    throw infrastructure(`breaklint exited ${status}, which is not one of its exit codes (0-4).`);
  }

  let report = null;
  if (existsSync(files.json)) {
    try {
      report = JSON.parse(readFileSync(files.json, "utf8"));
    } catch (error) {
      throw infrastructure(`breaklint exited ${status} and wrote a report that is not JSON (${error.message}).`);
    }
  }
  if (report === null) {
    // Exit 2 and a pre-render exit 3 never write a report. A 0 or a 1 without one is not a
    // verdict: an uncaught crash in node also exits 1, and must not read as "findings".
    if (status === 0 || status === 1) {
      throw infrastructure(`breaklint exited ${status} without writing its report; that is no verdict.`);
    }
    annotate("error", `breaklint: exit ${status}`, `${EXIT_MEANING[status]}; breaklint wrote no report (see the log above).`);
    setOutput("verdict", status === 2 ? "usage" : status === 3 ? "infrastructure" : "insufficient-coverage");
    finish(
      status,
      inputs.failOnExit,
      `# breaklint — no report (exit ${status})\n\nbreaklint ended before it wrote a report: ${EXIT_MEANING[status]}. ` +
        "Its own message is in the step log.\n\n" + gateSentence(status, inputs.failOnExit),
    );
    return;
  }
  if (report.exitCode !== status) {
    throw infrastructure(`breaklint exited ${status}, but its report says ${JSON.stringify(report.exitCode)}; the two must agree.`);
  }

  const rendered = {
    sarif: reporters.render(report, "sarif"),
    junit: reporters.render(report, "junit"),
    markdown: reporters.render(report, "markdown"),
  };
  JSON.parse(rendered.sarif);
  writeFileSync(files.sarif, rendered.sarif);
  writeFileSync(files.junit, rendered.junit);
  writeFileSync(files.markdown, rendered.markdown);
  printUntrusted(reporters.render(report, "console", { colour: false }));

  setOutput("verdict", report.runVerdict);
  setOutput("report-json", files.json);
  setOutput("sarif-file", files.sarif);
  setOutput("junit-file", files.junit);
  setOutput("markdown-file", files.markdown);
  if (existsSync(evidenceDir)) setOutput("evidence-dir", evidenceDir);

  const trailer = gateSentence(status, inputs.failOnExit);
  if (status !== 0) {
    annotate(
      inputs.failOnExit.has(status) ? "error" : "warning",
      `breaklint: exit ${status}`,
      `${EXIT_MEANING[status]} — verdict ${report.runVerdict}, ${report.findings?.length ?? 0} finding(s), ` +
        `${report.pagesAnalysed} page(s) analysed.${inputs.failOnExit.has(status) ? "" : " Not gated by this step."}`,
    );
  }
  finish(status, inputs.failOnExit, summaryText(rendered.markdown, trailer));
}

function isSameFile(a, b) {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return resolve(a) === resolve(b);
  }
}

const invokedDirectly = Boolean(process.argv[1]) && isSameFile(process.argv[1], fileURLToPath(import.meta.url));
if (invokedDirectly) await main();
