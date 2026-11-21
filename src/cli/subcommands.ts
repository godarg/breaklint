import { randomBytes } from "node:crypto";
import { closeSync, constants, existsSync, mkdirSync, openSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, type Stats } from "node:fs";
import { basename, dirname, join, relative } from "node:path";

import { compareReports, type ReportComparison } from "../api/compare.ts";
import { CONTEXT_MAX_FINDINGS, CONTEXT_MAX_TEXT, CONTEXT_MIN_TEXT, createContextPack } from "../api/context.ts";
import { writeReportBundle } from "../api/bundle.ts";
import { physicalPath } from "../api/output-path.ts";
import { UsageError } from "../config/resolve.ts";
import type { Report } from "../core/types.ts";
import type { ReadableScreenReport } from "../web/types.ts";
import { err, notice, out } from "./out.ts";
import { assertReadableReport } from "./report-input.ts";

export const CLI_SUBCOMMANDS = new Set(["compare", "context", "bundle"]);

/**
 * The exit contract of the subcommands, in one place so the help texts and the code cannot drift.
 * It is a contract about THIS invocation: whether the requested output was written, and for
 * `compare` whether the comparison can state anything about a repair. The verdicts of the input
 * reports are data inside the output.
 */
const SUBCOMMAND_EXIT_CODES = `exit codes
  0  the output was written completely
  1  compare --fail-on-new only: at least one comparison result is "new"
  2  invalid invocation or input: unknown option, a file that is not a breaklint report of a
     readable version, an output that would overwrite an input, a non-empty bundle directory
  3  the output could not be written, or compare's after report is "infrastructure"
  4  compare only: the after report is "insufficient-coverage", or findings exist and none of
     them can be matched: no stable identity, or no document of the same comparison scope
  A before report that ended with "infrastructure" or "insufficient-coverage" is a warning on
  stderr; it does not change the exit code.
`;

function readJsonFile(path: string, label: string): unknown {
  if (!existsSync(path)) throw new UsageError(`${label} not found: ${path}`);
  if (!statSync(path).isFile()) throw new UsageError(`${label} is not a regular file: ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new UsageError(`${label} is not valid JSON (${path}): ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The CLI boundary: only a report of a readable version whose consumed fields have their types. */
function readReportFile(path: string, label: string, accept: "document"): Report;
function readReportFile(path: string, label: string, accept: "document-or-screen"): Report | ReadableScreenReport;
function readReportFile(path: string, label: string, accept: "document" | "document-or-screen"): Report | ReadableScreenReport {
  const raw = readJsonFile(path, label);
  try {
    return assertReadableReport(raw, accept);
  } catch (error) {
    const wanted = accept === "document" ? "document report of schema 4 or 5" : "document report of schema 4 or 5, or a screen report of schema 1 or 2";
    throw new UsageError(`${label} is not a breaklint report (${path}): ${error instanceof Error ? error.message : String(error)}; expected a ${wanted}.`);
  }
}

function requirePathValue(raw: string | undefined, flag: string): string {
  if (raw === undefined || raw.trim() === "" || raw.startsWith("-")) {
    throw new UsageError(`${flag} needs a value.`);
  }
  return raw;
}

function requireTextValue(raw: string | undefined, flag: string): string {
  if (raw === undefined || raw.trim() === "" || raw.startsWith("-")) {
    throw new UsageError(`${flag} needs a value.`);
  }
  return raw;
}

function isIoError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^(?:EACCES|EPERM|ENOENT|EISDIR|ENOTDIR|ENOSPC|EROFS|EBUSY|EMFILE|ENFILE|EIO|EEXIST|ENAMETOOLONG|EFBIG|EDQUOT|EXDEV)$/u.test(code);
}

function validateComparisonInput(raw: unknown, label: string): ReportComparison {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new UsageError(`${label} must be a JSON object.`);
  }
  const obj = raw as Record<string, unknown>;
  if (
    obj.schemaVersion !== 1 ||
    obj.identityContract !== "logical-source-value-v1" ||
    typeof obj.beforeRunId !== "string" || obj.beforeRunId.length === 0 ||
    typeof obj.afterRunId !== "string" || obj.afterRunId.length === 0 ||
    !Array.isArray(obj.results)
  ) {
    throw new UsageError(`${label} is not a valid ReportComparison (schemaVersion 1).`);
  }
  for (const item of obj.results) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new UsageError(`${label} contains an invalid comparison result entry.`);
    }
    const r = item as Record<string, unknown>;
    if (
      typeof r.status !== "string" ||
      !["new", "persisting", "resolved", "unmatchable", "not-sufficiently-measured"].includes(r.status) ||
      !(r.beforeRunFindingId === null || typeof r.beforeRunFindingId === "string") ||
      !Array.isArray(r.afterRunFindingIds) ||
      !r.afterRunFindingIds.every((id) => typeof id === "string") ||
      !Array.isArray(r.reasons) ||
      !r.reasons.every((reason) => typeof reason === "string")
    ) {
      throw new UsageError(`${label} contains a malformed comparison result entry.`);
    }
  }
  return raw as ReportComparison;
}

function parsePositiveInt(raw: string | undefined, flag: string): number {
  if (raw === undefined || !/^[0-9]+$/u.test(raw)) throw new UsageError(`${flag} requires a positive integer.`);
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1) throw new UsageError(`${flag} requires a positive integer.`);
  return n;
}

/** Says on stderr when a requested bound is outside the range the context pack applies. */
function reportEffectiveLimits(maxFindings: number | undefined, maxText: number | undefined): void {
  if (maxFindings !== undefined && maxFindings > CONTEXT_MAX_FINDINGS) {
    err(`breaklint: --max-findings ${maxFindings} is above the limit; the context holds at most ${CONTEXT_MAX_FINDINGS} findings (range 1–${CONTEXT_MAX_FINDINGS}).\n`);
  }
  if (maxText !== undefined && maxText > CONTEXT_MAX_TEXT) {
    err(`breaklint: --max-text ${maxText} is above the limit; a text field keeps at most ${CONTEXT_MAX_TEXT} characters (range ${CONTEXT_MIN_TEXT}–${CONTEXT_MAX_TEXT}).\n`);
  }
  if (maxText !== undefined && maxText < CONTEXT_MIN_TEXT) {
    err(`breaklint: --max-text ${maxText} is below the minimum; a text field keeps up to ${CONTEXT_MIN_TEXT} characters (range ${CONTEXT_MIN_TEXT}–${CONTEXT_MAX_TEXT}).\n`);
  }
}

interface NamedInput { label: string; path: string }

function fileIdentity(path: string): { real: string; dev: number; ino: number } | null {
  try {
    const stat = statSync(path);
    // The operating system's realpath: the JavaScript one normalises `..` lexically first.
    return { real: realpathSync.native(path), dev: stat.dev, ino: stat.ino };
  } catch {
    return null;
  }
}

/**
 * An output must never replace an input. The same file can have several names: a relative alias
 * (`./x/../report.json`), a symlink, or a hard link, which has no common path at all. Path
 * equality after `realpath` covers the first two; device and inode equality covers the third.
 */
function assertOutputIsNotAnInput(outFile: string, inputs: readonly NamedInput[]): void {
  // The same resolution the writer uses, so the check and the write name one file.
  const output = fileIdentity(physicalPath(outFile));
  if (!output) return;
  for (const input of inputs) {
    const identity = fileIdentity(input.path);
    if (identity && (identity.real === output.real || (identity.dev === output.dev && identity.ino === output.ino))) {
      throw new UsageError(`--out would overwrite an input (${input.label} ${input.path}): ${outFile}. Write the output to a different file.`);
    }
  }
}

/**
 * Writes the whole output to a temporary file next to the target and renames it into place, so a
 * failed write (disk full, file-size limit, I/O error) leaves the previous file intact instead of
 * truncated. A symlinked target is written through to the file it names. A target that is not a
 * regular file and not absent (a device such as /dev/stdout, a FIFO) cannot be replaced by a
 * rename and is written directly, as before. The target is resolved by `physicalPath()`, the
 * resolution the collision check used: a lexical `..` after a symlinked directory once sent the
 * write to a different file than the one the check had looked at.
 */
function writeOutputFile(outFile: string, content: string): void {
  const destination = physicalPath(outFile);
  let existing: Stats | null = null;
  try {
    existing = statSync(destination);
  } catch {
    existing = null;
  }
  if (existing?.isDirectory()) {
    throw Object.assign(new Error(`--out names a directory: ${outFile}`), { code: "EISDIR" });
  }
  if (existing && !existing.isFile()) {
    writeFileSync(destination, content);
    return;
  }
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = join(dirname(destination), `.${basename(destination)}.${process.pid}-${randomBytes(6).toString("hex")}.breaklint-tmp`);
  try {
    const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, existing ? existing.mode & 0o777 : 0o666);
    try {
      writeFileSync(fd, content, "utf8");
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, destination);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function emitJson(payload: unknown, outFile: string | undefined, kind: string): void {
  const rendered = `${JSON.stringify(payload, null, 2)}\n`;
  if (outFile) {
    writeOutputFile(outFile, rendered);
    notice(`breaklint: ${kind} written to ${relative(process.cwd(), outFile)}\n`);
  } else {
    out(rendered);
  }
}

/**
 * A bundle directory holds one bundle. Writing into a used one left files of the earlier run
 * beside the new ones, among them a comparison.json that belongs to a different report. So the
 * directory must not exist yet or be empty; a report inside it is refused by the same rule.
 */
function assertNewOrEmptyDirectory(outDir: string): void {
  let stat: Stats;
  try {
    // writeReportBundle() writes to physicalPath(outDir); the check reads the same directory.
    stat = statSync(physicalPath(outDir));
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return;
    throw error;
  }
  if (!stat.isDirectory()) {
    throw new UsageError(`--out-dir must be a new or empty directory: ${outDir} exists and is not a directory.`);
  }
  if (readdirSync(physicalPath(outDir)).length > 0) {
    throw new UsageError(`--out-dir must be a new or empty directory: ${outDir} is not empty. Choose a new directory or empty this one.`);
  }
}

function subcommandHelp(name: string): string {
  if (name === "compare") {
    return `usage: breaklint compare <before.json> <after.json> [--out <file>] [--repository <dir>] [--fail-on-new]

Compares two compatible canonical breaklint document reports (schema 4 or 5) and emits a canonical
JSON comparison. A finding can be matched across the two reports only when it carries a stable
identity, which producer-bound runs (checkProducedDocuments) record; findings of a plain CLI run
compare as "unmatchable".

  --out <file>         Write the comparison to a file instead of stdout. It must not be an input.
  --repository <dir>   The Git repository both producer-bound reports were captured from. Needed to
                       confirm a repair across two commits (the ancestry is read there); it has no
                       effect on reports without a verified revision.
  --fail-on-new        End with exit 1 when at least one result is "new".

${SUBCOMMAND_EXIT_CODES}`;
  }
  if (name === "context") {
    return `usage: breaklint context <report.json> [--out <file>] [--max-findings <n>] [--max-text <n>] [--comparison <file>]

Builds a bounded AI/reader context pack from a canonical document or screen report.

  --out <file>          Write the pack to a file instead of stdout. It must not be an input.
  --max-findings <n>    Finding cards kept, 1–${CONTEXT_MAX_FINDINGS} (default 40); a larger value is reduced to ${CONTEXT_MAX_FINDINGS}.
  --max-text <n>        Characters kept per document-supplied text field, ${CONTEXT_MIN_TEXT}–${CONTEXT_MAX_TEXT} (default 400).
  --comparison <file>   A comparison whose after report is this report.

${SUBCOMMAND_EXIT_CODES}`;
  }
  return `usage: breaklint bundle <report.json> --out-dir <dir> [--evidence-dir <dir>] [--title <text>] [--theme light|dark] [--comparison <file>] [--max-findings <n>]

Writes a self-contained offline report bundle (report.json, context.json, bundle.json, report.html,
verified assets).

  --out-dir <dir>       A new or empty directory for the bundle.
  --evidence-dir <dir>  Where the run wrote its evidence (a live run's --out-dir, by default
                        ./breaklint-report). Without it no evidence is copied.
  --title <text>        Title of report.html.
  --theme light|dark    Colour scheme of report.html (default light).
  --comparison <file>   A comparison whose after report is this report; written as comparison.json.
  --max-findings <n>    Finding cards kept, 1–${CONTEXT_MAX_FINDINGS} (default 40).

${SUBCOMMAND_EXIT_CODES}`;
}

async function runCompare(argv: readonly string[]): Promise<number> {
  const files: string[] = [];
  let outFile: string | undefined;
  let repository: string | undefined;
  let failOnNew = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--out") {
      outFile = requirePathValue(argv[++i], "--out");
    } else if (arg === "--repository") {
      repository = requirePathValue(argv[++i], "--repository");
    } else if (arg === "--fail-on-new") {
      failOnNew = true;
    } else if (arg.startsWith("-")) {
      throw new UsageError(`unknown option ${arg} for compare. Try breaklint compare --help.`);
    } else {
      files.push(arg);
    }
  }
  if (files.length !== 2) {
    throw new UsageError("compare requires exactly two report files: breaklint compare <before.json> <after.json>");
  }
  if (repository !== undefined && (!existsSync(repository) || !statSync(repository).isDirectory())) {
    throw new UsageError(`--repository must name an existing directory: ${repository}`);
  }
  const before = readReportFile(files[0]!, "before report", "document");
  const after = readReportFile(files[1]!, "after report", "document");
  if (outFile) assertOutputIsNotAnInput(outFile, [{ label: "before report", path: files[0]! }, { label: "after report", path: files[1]! }]);
  let comparison: ReportComparison;
  try {
    comparison = await compareReports(before, after, repository === undefined ? {} : { revision: { repositoryRoot: repository } });
  } catch (error) {
    if (isIoError(error)) {
      err(`breaklint: compare failed: ${error instanceof Error ? error.message : String(error)}\n`);
      return 3;
    }
    throw new UsageError(`compare failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  emitJson(comparison, outFile, "comparison");
  if (before.runVerdict === "infrastructure" || before.runVerdict === "insufficient-coverage") {
    err(`breaklint: warning: the before report ended with ${before.runVerdict}; its findings were not fully measured, so a result against it is at most "not-sufficiently-measured".\n`);
  }
  if (after.runVerdict === "infrastructure") {
    err("breaklint: the after report ended with infrastructure; the comparison was written but cannot confirm a repair (exit 3).\n");
    return 3;
  }
  if (after.runVerdict === "insufficient-coverage") {
    err("breaklint: the after report ended with insufficient-coverage; the comparison was written but cannot confirm a repair (exit 4).\n");
    return 4;
  }
  // A result was matched when its finding carried a stable identity AND the other report had a
  // document of the same comparison scope to look in. A "not-sufficiently-measured" result for a
  // missing scope compared nothing: two different documents handed in by mistake used to end 0.
  const unscoped = (result: ReportComparison["results"][number]) => result.reasons.includes("scope-incompatible-or-unknown") &&
    !(result.beforeRunFindingId !== null && result.afterRunFindingIds.length > 0);
  const withoutIdentity = comparison.results.filter((result) => result.status === "unmatchable").length;
  const withoutScope = comparison.results.filter((result) => result.status !== "unmatchable" && unscoped(result)).length;
  if (comparison.results.length > 0 && withoutIdentity + withoutScope === comparison.results.length) {
    const why = withoutScope === 0
      ? `none of the ${comparison.results.length} compared finding(s) carries a stable identity, so no result could be matched (exit 4). ` +
        "compare needs producer-bound reports (checkProducedDocuments); findings of a plain CLI run are always unmatchable.\n"
      : `none of the ${comparison.results.length} compared finding(s) could be matched (exit 4): ${withoutIdentity} carry no stable identity and ` +
        `${withoutScope} have no document of the same comparison scope in the other report. Check that both reports describe the same document.\n`;
    err(`breaklint: ${why}`);
    return 4;
  }
  if (failOnNew && comparison.results.some((result) => result.status === "new")) {
    err(`breaklint: ${comparison.results.filter((result) => result.status === "new").length} new finding(s) (--fail-on-new, exit 1).\n`);
    return 1;
  }
  return 0;
}

function runContext(argv: readonly string[]): number {
  const files: string[] = [];
  let outFile: string | undefined;
  let maxFindings: number | undefined;
  let maxTextPerField: number | undefined;
  let comparisonPath: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--out") {
      outFile = requirePathValue(argv[++i], "--out");
    } else if (arg === "--max-findings") {
      maxFindings = parsePositiveInt(argv[++i], "--max-findings");
    } else if (arg === "--max-text") {
      maxTextPerField = parsePositiveInt(argv[++i], "--max-text");
    } else if (arg === "--comparison") {
      comparisonPath = requirePathValue(argv[++i], "--comparison");
    } else if (arg.startsWith("-")) {
      throw new UsageError(`unknown option ${arg} for context. Try breaklint context --help.`);
    } else {
      files.push(arg);
    }
  }
  if (files.length !== 1) {
    throw new UsageError("context requires exactly one report file: breaklint context <report.json>");
  }
  const report = readReportFile(files[0]!, "report", "document-or-screen");
  const comparison = comparisonPath ? validateComparisonInput(readJsonFile(comparisonPath, "comparison"), "comparison") : undefined;
  if (outFile) {
    assertOutputIsNotAnInput(outFile, [
      { label: "report", path: files[0]! },
      ...(comparisonPath ? [{ label: "comparison", path: comparisonPath }] : []),
    ]);
  }
  reportEffectiveLimits(maxFindings, maxTextPerField);
  let pack;
  try {
    pack = createContextPack(report, {
      ...(maxFindings === undefined ? {} : { maxFindings }),
      ...(maxTextPerField === undefined ? {} : { maxTextPerField }),
      ...(comparison === undefined ? {} : { comparison }),
    });
  } catch (error) {
    if (isIoError(error)) {
      err(`breaklint: context failed: ${error instanceof Error ? error.message : String(error)}\n`);
      return 3;
    }
    throw new UsageError(`context failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  emitJson(pack, outFile, "context pack");
  return 0;
}

function runBundle(argv: readonly string[]): number {
  const files: string[] = [];
  let outDir: string | undefined;
  let evidenceDir: string | undefined;
  let title: string | undefined;
  let theme: "light" | "dark" | undefined;
  let comparisonPath: string | undefined;
  let maxFindings: number | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--out-dir") {
      outDir = requirePathValue(argv[++i], "--out-dir");
    } else if (arg === "--evidence-dir") {
      evidenceDir = requirePathValue(argv[++i], "--evidence-dir");
    } else if (arg === "--title") {
      title = requireTextValue(argv[++i], "--title");
    } else if (arg === "--theme") {
      const val = argv[++i];
      if (val !== "light" && val !== "dark") throw new UsageError("--theme must be light or dark.");
      theme = val;
    } else if (arg === "--comparison") {
      comparisonPath = requirePathValue(argv[++i], "--comparison");
    } else if (arg === "--max-findings") {
      maxFindings = parsePositiveInt(argv[++i], "--max-findings");
    } else if (arg.startsWith("-")) {
      throw new UsageError(`unknown option ${arg} for bundle. Try breaklint bundle --help.`);
    } else {
      files.push(arg);
    }
  }
  if (files.length !== 1) {
    throw new UsageError("bundle requires exactly one report file: breaklint bundle <report.json> --out-dir <dir>");
  }
  if (!outDir) {
    throw new UsageError("bundle requires --out-dir <dir>.");
  }
  const report = readReportFile(files[0]!, "report", "document-or-screen");
  const comparison = comparisonPath ? validateComparisonInput(readJsonFile(comparisonPath, "comparison"), "comparison") : undefined;
  assertNewOrEmptyDirectory(outDir);
  reportEffectiveLimits(maxFindings, undefined);
  let result;
  try {
    result = writeReportBundle(report, {
      outDir,
      ...(evidenceDir === undefined ? {} : { evidenceDir }),
      ...(title === undefined ? {} : { title }),
      ...(theme === undefined ? {} : { theme }),
      ...(comparison === undefined ? {} : { comparison }),
      ...(maxFindings === undefined ? {} : { maxFindings }),
    });
  } catch (error) {
    if (isIoError(error)) {
      err(`breaklint: bundle failed: ${error instanceof Error ? error.message : String(error)}\n`);
      return 3;
    }
    throw new UsageError(`bundle failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (evidenceDir === undefined) {
    err("breaklint: no --evidence-dir given, so no evidence was copied into the bundle. Pass --evidence-dir <dir> where the run wrote its evidence (a live run's --out-dir, by default ./breaklint-report).\n");
  }
  notice(`breaklint: bundle written to ${relative(process.cwd(), result.outDir) || "."} (${result.assets.length} verified asset${result.assets.length === 1 ? "" : "s"})\n`);
  return 0;
}

export async function runSubcommand(name: string, argv: readonly string[]): Promise<number> {
  try {
    if (argv.includes("--help") || argv.includes("-h")) {
      out(subcommandHelp(name));
      return 0;
    }
    if (name === "compare") return await runCompare(argv);
    if (name === "context") return runContext(argv);
    if (name === "bundle") return runBundle(argv);
    throw new UsageError(`unknown subcommand ${name}`);
  } catch (error) {
    if (error instanceof UsageError) {
      err(`breaklint: ${error.message}\n`);
      return 2;
    }
    if (isIoError(error)) {
      err(`breaklint: ${error instanceof Error ? error.message : String(error)}\n`);
      return 3;
    }
    throw error;
  }
}
