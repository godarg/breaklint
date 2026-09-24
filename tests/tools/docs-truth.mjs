#!/usr/bin/env node
/**
 * Every schema stamp a shipped document names is the stamp the built package carries.
 *
 * WHY THIS EXISTS. Report 5 shipped in 0.6.0, and the README, `docs/reporting.md`,
 * `docs/source-bound-findings.md`, `CONTRIBUTING.md` and `docs/status.md` went on saying Report 4 —
 * or 3 — in present-tense, current-state sentences. Contract tables are what integrators read, and
 * nothing compared them with the code. Stamps also move independently (the snapshot moves without
 * the report), so a number that is right today is not right by construction tomorrow.
 *
 * THE ORACLE IS THE BUILT PACKAGE, IN A CHILD PROCESS. `--package <dir>` points at a package root
 * with `dist/` — the installed `node_modules/breaklint` in CI, or a freshly built staging copy in
 * the unit suite. The stamps are read by running that package, never from this file and never from
 * the documents under test:
 *   - report: `schemaVersion` of `<dir>/dist/cli/index.js --demo --format json`, which must also
 *     equal the package's `REPORT_SCHEMA_VERSION`;
 *   - readable reports: `READABLE_REPORT_SCHEMA_VERSIONS`;
 *   - snapshot: `SNAPSHOT_SCHEMA_VERSION`;
 *   - context pack and comparison: `createContextPack(report).schemaVersion` and
 *     `compareReports(report, report).schemaVersion` from the package root;
 *   - configuration contract: `config.contractVersion` of the same report.
 *
 * THE GRAMMAR, which decides whether a mention is a claim about now. It is read per mention and per
 * sentence — never from the surrounding paragraph. A mention whose number differs from the current
 * stamp passes only in one of these forms, and a new stale mention cannot pass without taking one:
 *   1. the readable set: "readers accept Report 4 and 5", "Reports 4 and 5 are readable" — its
 *      numbers must be exactly `READABLE_REPORT_SCHEMA_VERSIONS`;
 *   2. an arrow on the mention itself: "Report 4 → 5", "Snapshot schema | 2 → 3";
 *   3. a dated transition, with a released version no newer than the package IN THE SAME SENTENCE:
 *      (a) the mention is followed by "from/until/since/before <version>" — "schema 3 from 0.2.3";
 *      (b) the mention is followed by "in <version>" and the sentence has a transition verb —
 *          "moved to schema 3 in 0.2.3";
 *      (c) the version comes first and a transition verb stands between it and the mention, or
 *          within four words after the mention — "0.5.0 moves live output to Report 4",
 *          "Report 3 consumers must migrate when adopting 0.5.0".
 *      Transition verbs: become(s), became, move(s), moved, stay(s), stayed, remain(s), remained,
 *      add(s), added, introduce(s|d), migrate(s|d), replace(s|d), drop(s|ped), raise(s|d).
 *   4. "legacy" immediately before the mention — "Legacy Report 3 input";
 *   5. a region explicitly marked `<!-- docs-truth: historical -->` … `<!-- docs-truth: end -->`.
 * Anything else is a current-state claim and must equal the current stamp. CHANGELOG.md is not
 * scanned: every entry in it states a change, so both sides of one appear by design.
 *
 * `--pending <file>` names mentions another change is about to correct, as JSON lines
 * `{"file","kind","number","unit","reason"}`: one entry matches exactly one issue with the same
 * file, kind, number and exact sentence, so a second copy of the sentence, or an edited one, is an
 * issue again. An entry that matches nothing fails too, so the list can only shrink.
 *
 * `--release` is for the release workflow: a pending entry is a stale sentence this check knows
 * about, and a tag must not ship one. With a non-empty pending list the run fails at once and says
 * what to do; with an empty one every mention is checked with no exception. Pull requests keep
 * accepting pending entries; tags do not — the same rule as `TBD-at-tag` in the changelog.
 *
 * KNOWN LIMITS, accepted: the history grammar is a heuristic over English. A sentence can take one
 * of its forms and still be false ("Live reports have used Report 4 since 0.5.0" passes form 3a),
 * and a stamp named in a shape no pattern reads — "schema version 4", "v4 reports", a number in a
 * code block — is not seen at all. What it does guarantee is that a stale current-state sentence in
 * the shapes these documents actually use fails, and that every exception is visible in its text.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const RELEASE = /\bv?(\d+)\.(\d+)\.(\d+)\b/gu;
const TRANSITION_VERB = "(?:becomes?|became|moves?|moved|stays?|stayed|remains?|remained|adds?|added|introduce[sd]?|migrate[sd]?|replace[sd]?|drops?|dropped|raise[sd]?)";
const TRANSITION = new RegExp(`\\b${TRANSITION_VERB}\\b`, "iu");

/** Reads the current stamps by running the built package, in child processes. */
export function currentStamps(packageDir) {
  const root = resolve(packageDir);
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const cli = join(root, manifest.bin.breaklint);
  const demo = spawnSync(process.execPath, [cli, "--demo", "--format", "json"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 60_000 });
  if (demo.status !== 1) throw new Error(`the built CLI's --demo ended ${demo.status}, expected 1: ${demo.stderr}`);
  const probe = `
    const [index, enums] = await Promise.all([
      import(${JSON.stringify(pathToFileURL(join(root, "dist/index.js")).href)}),
      import(${JSON.stringify(pathToFileURL(join(root, "dist/core/enums.js")).href)}),
    ]);
    let input = ""; for await (const chunk of process.stdin) input += chunk;
    const report = JSON.parse(input);
    process.stdout.write(JSON.stringify({
      report: report.schemaVersion,
      reportConstant: enums.REPORT_SCHEMA_VERSION,
      readable: [...enums.READABLE_REPORT_SCHEMA_VERSIONS].sort((a, b) => a - b),
      snapshot: enums.SNAPSHOT_SCHEMA_VERSION,
      context: index.createContextPack(report).schemaVersion,
      comparison: (await index.compareReports(report, report)).schemaVersion,
      config: report.config.contractVersion,
    }));`;
  const read = spawnSync(process.execPath, ["--input-type=module", "-e", probe], { cwd: root, input: demo.stdout, encoding: "utf8", timeout: 60_000 });
  if (read.status !== 0) throw new Error(`the built package could not be read: ${read.stderr}`);
  const stamps = JSON.parse(read.stdout);
  if (stamps.report !== stamps.reportConstant) {
    throw new Error(`the CLI writes report schema ${stamps.report} but REPORT_SCHEMA_VERSION is ${stamps.reportConstant}`);
  }
  for (const key of ["report", "snapshot", "context", "comparison", "config"]) {
    if (!Number.isInteger(stamps[key])) throw new Error(`the built package yielded no ${key} stamp`);
  }
  return { ...stamps, packageVersion: manifest.version };
}

function older(a, b) {
  for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}

/** Positions of the released versions a sentence names that are no newer than the package. */
function releasedVersions(text, packageVersion) {
  const current = packageVersion.split(".").map(Number);
  return [...text.matchAll(RELEASE)]
    .filter((match) => !older(current, match.slice(1, 4).map(Number)))
    .map((match) => ({ start: match.index, end: match.index + match[0].length }));
}

/**
 * Whether one mention is stated as history, by the forms in the header. `start` is where the
 * mention's words begin, `at` where its number is.
 */
function statedAsHistory(unit, mention, packageVersion) {
  const after = unit.slice(mention.at + String(mention.number).length);
  const before = unit.slice(0, mention.start);
  if (/^\s*(?:→|->)\s*`?\d/u.test(after) || /\d`?\s*(?:→|->)\s*(?:Report[- ]?|Snapshot[- ]?|schema[- ])?$/iu.test(unit.slice(0, mention.at))) return true;
  if (/\blegacy\s+(?:[\w-]+\s+)?$/iu.test(before)) return true;
  const versions = releasedVersions(unit, packageVersion);
  if (versions.length === 0) return false;
  const adjacent = /^\s*\)?\s*(from|until|since|before|in)\s+v?\d+\.\d+\.\d+\b/iu.exec(after);
  if (adjacent) {
    const version = releasedVersions(after.slice(0, adjacent[0].length), packageVersion).length > 0;
    if (version && (adjacent[1].toLowerCase() !== "in" || TRANSITION.test(unit))) return true;
  }
  if (new RegExp(`^\\W*(?:[\\w-]+\\W+){0,3}${TRANSITION_VERB}\\b`, "iu").test(after)) return true;
  return versions.some((version) => version.end <= mention.start && TRANSITION.test(unit.slice(version.end, mention.start)));
}

const KIND_WORDS = [
  { kind: "context", pattern: /\bcontext(?:\.json)?\b/giu },
  { kind: "comparison", pattern: /\bcomparison\b/giu },
  { kind: "snapshot", pattern: /\bsnapshots?\b/giu },
  { kind: "config", pattern: /\bconfiguration\b/giu },
  { kind: "report", pattern: /\breports?\b/giu },
];

/** The kind a bare "schema N" belongs to: the nearest kind word before it, in its unit or paragraph. */
function kindBefore(text, index) {
  let best = null;
  for (const { kind, pattern } of KIND_WORDS) {
    for (const match of text.slice(0, index).matchAll(pattern)) {
      if (!best || match.index > best.index) best = { kind, index: match.index };
    }
  }
  return best?.kind ?? null;
}

/** Stamp mentions in one unit of prose. Stamps are small integers; "JSON Schema 2020-12" is not one. */
function mentionsIn(unit, paragraph, unitOffset) {
  const found = [];
  const add = (kind, number, at, start = at) => {
    if (kind && number < 100) found.push({ kind, number, at, start });
  };
  const taken = new Set();
  const patterns = [
    { kind: "report", re: /\bReport[- ]?(\d+)\b/gu },
    { kind: "report", re: /\breport schema(?: is| at| to| moves to| stays| remains)?[- ](\d+)\b/giu },
    { kind: "report", re: /\bschema-(\d+) report/giu },
    { kind: "snapshot", re: /\bSnapshot[- ]?(\d+)\b/gu },
    { kind: "snapshot", re: /\bsnapshot schema(?: is| at| to| moves to| stays| remains)?[- ](\d+)\b/giu },
    { kind: "context", re: /\bcontext pack(?:\s+(?:schema|is|to|becomes|moves to|at|stays|version|v))*\s+(\d+)\b/giu },
    { kind: "config", re: /\bConfiguration Contract\s*v?(\d+)\b/giu },
  ];
  for (const { kind, re } of patterns) {
    for (const match of unit.matchAll(re)) {
      const at = match.index + match[0].length - match[1].length;
      taken.add(at);
      add(kind, Number(match[1]), at, match.index);
    }
  }
  for (const match of unit.matchAll(/\bschema[- ](\d+)\b/giu)) {
    const at = match.index + match[0].length - match[1].length;
    if (taken.has(at)) continue;
    add(kindBefore(paragraph, unitOffset + match.index) ?? kindBefore(unit, match.index), Number(match[1]), at, match.index);
  }
  // Contract tables: `| Document report | 5 | … |`.
  const row = /^\|\s*([^|]+?)\s*\|\s*`?(\d+)`?\s*(?:each\s*)?\|/u.exec(unit);
  if (row) {
    const label = row[1].toLowerCase();
    const kind = /context/u.test(label) ? "context" : /comparison/u.test(label) ? "comparison"
      : /snapshot/u.test(label) ? "snapshot" : /^configuration$/u.test(label) ? "config"
      : /^document report$/u.test(label) ? "report" : null;
    add(kind, Number(row[2]), row.index + row[0].indexOf(row[2]));
  }
  return found;
}

/** Splits a Markdown file into prose units, skipping fenced code and marked historical regions. */
function unitsOf(text) {
  const units = [];
  let fenced = false;
  let historical = false;
  let paragraph = [];
  const flush = () => {
    if (!paragraph.length) return;
    const joined = paragraph.map((p) => p.text).join(" ");
    const firstLine = paragraph[0].line;
    // Sentences: a full stop, colon or semicolon followed by space and a capital or a backtick.
    const bounds = [0];
    for (const match of joined.matchAll(/[.;:](?=\s+[A-Z`*(])/gu)) bounds.push(match.index + 1);
    bounds.push(joined.length);
    for (let i = 0; i + 1 < bounds.length; i += 1) {
      const unit = joined.slice(bounds[i], bounds[i + 1]);
      if (unit.trim()) units.push({ unit, paragraph: joined, offset: bounds[i], line: firstLine });
    }
    paragraph = [];
  };
  for (const [index, line] of text.replace(/\r\n/gu, "\n").split("\n").entries()) {
    if (/^\s*(```|~~~)/u.test(line)) { flush(); fenced = !fenced; continue; }
    if (fenced) continue;
    if (/<!--\s*docs-truth:\s*historical\b/u.test(line)) { flush(); historical = true; continue; }
    if (/<!--\s*docs-truth:\s*end\s*-->/u.test(line)) { flush(); historical = false; continue; }
    if (historical) continue;
    if (/^\s*\|/u.test(line)) { flush(); units.push({ unit: line, paragraph: line, offset: 0, line: index + 1 }); continue; }
    if (!line.trim() || /^#{1,6}\s/u.test(line)) { flush(); if (line.trim()) units.push({ unit: line, paragraph: line, offset: 0, line: index + 1 }); continue; }
    paragraph.push({ text: line.trim(), line: index + 1 });
  }
  flush();
  return units;
}

function readableSetOk(unit, stamps) {
  // "readers accept Report 4 and 5", or "Reports 4 and 5 are readable".
  const match = /\b(?:readers?|reads?|accepts?|accepted|readable)\b[^.;]{0,40}?(?:Report[- ]?)?(\d+)((?:,\s*\d+)*)\s*(?:and|or)\s*(\d+)/iu.exec(unit)
    ?? /\bReports?[- ]?(\d+)((?:,\s*\d+)*)\s*(?:and|or)\s*(\d+)\s+(?:are|remain|stay)\s+readable\b/iu.exec(unit);
  if (!match) return null;
  const numbers = [match[1], ...match[2].split(",").map((s) => s.trim()).filter(Boolean), match[3]].map(Number).sort((a, b) => a - b);
  return { numbers, ok: JSON.stringify(numbers) === JSON.stringify(stamps.readable), start: match.index, end: match.index + match[0].length };
}

/** Structured issues: `{ file, line, kind, number, unit, message }`, one per stale mention. */
export function scanIssues(file, text, stamps) {
  const issues = [];
  for (const { unit, paragraph, offset, line } of unitsOf(text)) {
    const sentence = unit.trim();
    const readable = readableSetOk(unit, stamps);
    if (readable && !readable.ok) {
      issues.push({
        file, line, kind: "readable", number: readable.numbers.join(","), unit: sentence,
        message: `${file}:${line}: names the readable report set ${readable.numbers.join(" and ")}, but the package reads ${stamps.readable.join(" and ")}: ${sentence}`,
      });
    }
    for (const mention of mentionsIn(unit, paragraph, offset)) {
      if (mention.number === stamps[mention.kind]) continue;
      if (readable && mention.kind === "report" && mention.at >= readable.start && mention.at <= readable.end) continue;
      if (statedAsHistory(unit, mention, stamps.packageVersion)) continue;
      issues.push({
        file, line, kind: mention.kind, number: mention.number, unit: sentence,
        message: `${file}:${line}: says ${mention.kind} ${mention.number}, but the built package is at ${stamps[mention.kind]}: ${sentence}`,
      });
    }
  }
  return issues;
}

export function scanText(file, text, stamps) {
  return scanIssues(file, text, stamps).map((issue) => issue.message);
}

function markdownUnder(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? markdownUnder(path) : entry.name.endsWith(".md") ? [path] : [];
  });
}

/** The shipped documents of a package: README, SECURITY and every Markdown file under docs/. */
export function shippedDocuments(packageDir) {
  const root = resolve(packageDir);
  return [join(root, "README.md"), join(root, "SECURITY.md"), ...markdownUnder(join(root, "docs"))].filter((path) => existsSync(path));
}

/**
 * `packageDir` supplies the stamps (its `dist/`); `docsRoot`, which defaults to it, supplies the
 * documents. They differ only in the unit suite, which builds `dist/` into a staging directory and
 * reads the repository's own documents.
 */
export function checkDocsTruth({ packageDir, docsRoot = packageDir, extra = [], pending = [], stamps = currentStamps(packageDir) }) {
  const root = resolve(docsRoot);
  const files = [...shippedDocuments(root), ...extra.map((path) => resolve(path))];
  const issues = [];
  // One entry absorbs exactly one issue: same file, kind, number and exact sentence.
  const pendingLeft = new Set(pending.map((_, i) => i));
  let scanned = 0;
  for (const path of files) {
    const text = readFileSync(path, "utf8");
    const name = path.startsWith(root) ? relative(root, path) : path;
    scanned += 1;
    for (const issue of scanIssues(name, text, stamps)) {
      const match = [...pendingLeft].find((i) => {
        const entry = pending[i];
        return entry.file === name && entry.kind === issue.kind && String(entry.number) === String(issue.number) && entry.unit === issue.unit;
      });
      if (match !== undefined) pendingLeft.delete(match);
      else issues.push(issue.message);
    }
  }
  // A check that read nothing has checked nothing, and must not say otherwise.
  if (scanned === 0) issues.push(`no README, SECURITY.md or docs/**/*.md was found under ${root}; nothing was checked`);
  for (const i of pendingLeft) {
    const entry = pending[i];
    issues.push(`pending entry matches no issue, so remove it: ${entry.file}: ${entry.kind} ${entry.number} in "${entry.unit}" (${entry.reason})`);
  }
  return { valid: issues.length === 0, issues, scanned, stamps };
}

function isMain() {
  return Boolean(process.argv[1]) && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
}

function readPending(file) {
  return file ? readFileSync(file, "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line)) : [];
}

function main(args) {
  const valueOf = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const packageDir = valueOf("--package");
  if (!packageDir || !statSync(packageDir, { throwIfNoEntry: false })?.isDirectory()) {
    process.stderr.write("usage: docs-truth.mjs --package <package-dir> [--docs-root <dir>] [--extra <file> ...] [--pending <jsonl>] [--release]\n");
    return 2;
  }
  const pendingFile = valueOf("--pending");
  const pending = readPending(pendingFile);
  const release = args.includes("--release");
  if (release && pending.length > 0) {
    process.stderr.write(
      `docs truth: FAILED — a release must not ship documents this check knows are stale, and ${pendingFile} lists ${pending.length}:\n` +
        `${pending.map((entry) => `  - ${entry.file}: ${entry.kind} ${entry.number} in "${entry.unit}" (${entry.reason})`).join("\n")}\n` +
        "Correct those sentences and delete their entries in a commit on main, let CI go green on that commit, and tag that commit.\n",
    );
    return 1;
  }
  const extra = args.flatMap((arg, i) => (arg === "--extra" ? [args[i + 1]] : []));
  const result = checkDocsTruth({ packageDir, docsRoot: valueOf("--docs-root") ?? packageDir, extra, pending: release ? [] : pending });
  const { stamps } = result;
  const summary = `report ${stamps.report} (reads ${stamps.readable.join(", ")}), snapshot ${stamps.snapshot}, context pack ${stamps.context}, comparison ${stamps.comparison}, configuration contract ${stamps.config}`;
  if (!result.valid) {
    process.stderr.write(`docs truth: FAILED against the built package (${summary})\n${result.issues.map((issue) => `  - ${issue}`).join("\n")}\n`);
    return 1;
  }
  process.stdout.write(`docs truth: ${result.scanned} documents name only the stamps the built package carries${release ? ", with no pending exception" : ""}: ${summary}\n`);
  return 0;
}

if (isMain()) process.exitCode = main(process.argv.slice(2));
