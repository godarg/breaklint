#!/usr/bin/env node
/**
 * The README's demo excerpt is what the demo command prints — for the README that ships.
 *
 * WHY THIS EXISTS. The npm-published 0.6.0 README said "one of its seven findings" and
 * `rules run: 13`, while `npx breaklint --demo` from the same tarball printed five findings and
 * `rules run: 12`. The guard that existed read the repository's README and ran the SOURCE CLI, so
 * it could only ever see the tree, never the package a user installs. Between a tag and the next
 * release the two can differ, and did.
 *
 * ONE PARSER, TWO ORACLES. `checkReadmeDemo` is the only reader of the excerpt. The unit suite
 * feeds it the repository README and a real source CLI run; the CI packed-consumer steps feed it
 * the README inside `node_modules/breaklint/` and a real run of the installed `bin` — the symlink
 * npm links — in a child process. In both, the oracle is a command that was actually run, never
 * the parser and never a string typed into a test.
 *
 * WHAT IS COMPARED:
 *   1. the demo ends with exit 1;
 *   2. the excerpt's last line equals the CLI's one counter line, whole-line;
 *   3. the excerpt's finding block — header to `render` line — occurs verbatim and contiguously in
 *      the output, and is exactly one finding;
 *   4. "one of its N findings": N is the number of finding headers the CLI printed.
 *
 * Every `--consumer`/`--package` run also proves it can fail: it corrupts one character of a
 * quoted finding line, the counter line and the count word in memory and requires each corrupted
 * README to be rejected against the same output. A guard whose red state nobody has seen is a
 * claim.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Finding header lines of the console format: `<severity> <rule-id>  page <n>`. */
export const FINDING_HEADER = /^(error|warn|info) +[a-z]+\/[a-z0-9-]+ +page \d+$/u;
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const EXCERPT = /Below is one of its ([a-z]+) findings, plus the closing counters, copied from that\ncommand's output:\n\n```\n([\s\S]*?)\n```\n/u;

export function checkReadmeDemo(readmeText, demoStdout, demoExit) {
  const issues = [];
  if (demoExit !== 1) issues.push(`--demo must end with exit 1, it ended with ${demoExit}`);
  const output = demoStdout.replace(/\r\n/gu, "\n").split("\n");
  // CRLF-normalised: a Windows checkout with autocrlf would otherwise report a missing excerpt
  // instead of the actual difference.
  const intro = EXCERPT.exec(readmeText.replace(/\r\n/gu, "\n"));
  if (!intro) {
    issues.push("the README no longer carries the demo excerpt in the shape this guard reads");
    return { valid: false, issues };
  }
  const [, countWord, excerpt] = intro;
  const excerptLines = excerpt.split("\n");

  const documentedCounters = excerptLines.at(-1);
  const actualCounters = output.filter((line) => line.startsWith("inputs found:"));
  if (actualCounters.length !== 1) issues.push(`the demo printed ${actualCounters.length} counter lines, not one`);
  else if (documentedCounters !== actualCounters[0]) {
    issues.push(`README demo counters drifted from the actual output:\n    README: ${documentedCounters}\n    actual: ${actualCounters[0]}`);
  }

  const blank = excerptLines.indexOf("");
  if (blank <= 0) {
    issues.push("the README excerpt has no finding block before the counters");
  } else {
    const block = excerptLines.slice(0, blank);
    if (!FINDING_HEADER.test(block[0])) issues.push(`the README excerpt does not open with a finding: ${block[0]}`);
    if (!/^ {2}render {5}/u.test(block.at(-1))) issues.push("the README finding block does not end at its render line");
    if (block.slice(1).some((line) => FINDING_HEADER.test(line))) issues.push("the README finding block runs into a second finding");
    const start = output.indexOf(block[0]);
    if (start < 0) issues.push(`the demo prints no finding "${block[0]}"`);
    else {
      const actual = output.slice(start, start + block.length);
      const differing = block.findIndex((line, i) => line !== actual[i]);
      if (differing !== -1) {
        issues.push(
          `README finding block drifted from the actual output at excerpt line ${differing + 1}:\n` +
            `    README: ${block[differing]}\n    actual: ${actual[differing] ?? "(output ended)"}`,
        );
      }
    }
  }

  const printed = output.filter((line) => FINDING_HEADER.test(line)).length;
  if (printed === 0) issues.push("the demo printed no finding at all");
  else if (countWord !== NUMBER_WORDS[printed]) issues.push(`the README says "${countWord}" findings; the demo printed ${printed}`);
  return { valid: issues.length === 0, issues, countWord, printed };
}

/** In-memory corruptions of a README that the check must reject against the same output. */
export function corruptions(readmeText) {
  const intro = EXCERPT.exec(readmeText.replace(/\r\n/gu, "\n"));
  if (!intro) return [];
  const [whole, countWord, excerpt] = intro;
  const lines = excerpt.split("\n");
  const flip = (line) => {
    // Change one character in the middle of the line, keeping its shape.
    const at = Math.floor(line.length / 2);
    const replacement = line[at] === "x" ? "y" : "x";
    return `${line.slice(0, at)}${replacement}${line.slice(at + 1)}`;
  };
  const withExcerpt = (next) => readmeText.replace(whole, whole.replace(excerpt, next.join("\n")));
  const quoted = Math.max(1, lines.findIndex((line) => line.startsWith("  detail ")));
  const nextWord = NUMBER_WORDS[(NUMBER_WORDS.indexOf(countWord) + 1) % NUMBER_WORDS.length];
  return [
    { name: `one character of quoted line ${quoted + 1}`, text: withExcerpt(lines.map((line, i) => (i === quoted ? flip(line) : line))) },
    { name: "one character of the counter line", text: withExcerpt(lines.map((line, i) => (i === lines.length - 1 ? flip(line) : line))) },
    { name: "the finding-count word", text: readmeText.replace(whole, whole.replace(`one of its ${countWord} findings`, `one of its ${nextWord} findings`)) },
  ];
}

function runInstalled(bin, cwd, viaNode) {
  // An installed `bin` is executed as the shell would, through npm's symlink and its shebang. A
  // freshly compiled entry has no execute bit, so a staged package runs it with this node.
  const [command, args] = viaNode ? [process.execPath, [bin, "--demo"]] : [bin, ["--demo"]];
  const run = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  if (run.error) throw run.error;
  return { stdout: run.stdout, stderr: run.stderr, code: run.status ?? -1 };
}

function verify(readmePath, bin, cwd, label, viaNode = false) {
  if (!existsSync(readmePath)) throw new Error(`${label}: no README at ${readmePath}`);
  if (!existsSync(bin)) throw new Error(`${label}: no breaklint executable at ${bin}`);
  const readme = readFileSync(readmePath, "utf8");
  const demo = runInstalled(bin, cwd, viaNode);
  const result = checkReadmeDemo(readme, demo.stdout, demo.code);
  if (!result.valid) {
    process.stderr.write(`README demo contract (${label}): FAILED\n${result.issues.map((issue) => `  - ${issue}`).join("\n")}\n${demo.stderr}`);
    process.exitCode = 1;
    return;
  }
  const controls = corruptions(readme);
  const survivors = controls.filter((control) => checkReadmeDemo(control.text, demo.stdout, demo.code).valid);
  if (controls.length !== 3 || survivors.length > 0) {
    process.stderr.write(`README demo contract (${label}): negative controls did not fail: ${survivors.map((s) => s.name).join(", ") || "none built"}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `README demo contract (${label}): the shipped README quotes what the shipped CLI prints ` +
      `(${result.printed} findings, counters and one finding verbatim); ${controls.length} corrupted copies rejected\n`,
  );
}

function isMain() {
  return Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
}

if (isMain()) {
  // Exactly these forms; anything else is exit 2, never a quieter run.
  const [mode, dir] = process.argv.slice(2);
  const directory = Boolean(dir) && !dir.startsWith("--") && process.argv.length === 4;
  if (mode === "--consumer" && directory) {
    // A clean consumer: the README npm installed, and the `bin` symlink npm linked, run from the
    // consumer directory exactly as `npx breaklint --demo` resolves it.
    const consumer = resolve(dir);
    verify(join(consumer, "node_modules/breaklint/README.md"), join(consumer, "node_modules/.bin/breaklint"), consumer, "installed package");
  } else if (mode === "--package" && directory) {
    // An unpacked or staged package directory: its README and its own built bin entry.
    const root = resolve(dir);
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    verify(join(root, "README.md"), join(root, manifest.bin.breaklint), root, "built package", true);
  } else {
    process.stderr.write("usage: readme-demo-contract.mjs --consumer <dir-with-node_modules> | --package <package-dir>\n");
    process.exitCode = 2;
  }
}
