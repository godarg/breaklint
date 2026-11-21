import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve as resolvePath } from "node:path";

import { compareReports, type ReportComparison } from "../api/compare.ts";
import { createContextPack } from "../api/context.ts";
import { writeReportBundle } from "../api/bundle.ts";
import { UsageError } from "../config/resolve.ts";
import type { Report } from "../core/types.ts";
import type { ReadableScreenReport } from "../web/types.ts";
import { err, notice, out } from "./out.ts";

export const CLI_SUBCOMMANDS = new Set(["compare", "context", "bundle"]);

function readJsonFile(path: string, label: string): unknown {
  if (!existsSync(path)) throw new UsageError(`${label} not found: ${path}`);
  if (!statSync(path).isFile()) throw new UsageError(`${label} is not a regular file: ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new UsageError(`${label} is not valid JSON (${path}): ${error instanceof Error ? error.message : String(error)}`);
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
  return typeof code === "string" && /^(?:EACCES|EPERM|ENOENT|EISDIR|ENOTDIR|ENOSPC|EROFS|EBUSY|EMFILE|ENFILE|EIO|EEXIST|ENAMETOOLONG)$/u.test(code);
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

function emitJson(payload: unknown, outFile: string | undefined, kind: string): void {
  const rendered = `${JSON.stringify(payload, null, 2)}\n`;
  if (outFile) {
    mkdirSync(dirname(resolvePath(outFile)), { recursive: true });
    writeFileSync(outFile, rendered);
    notice(`breaklint: ${kind} written to ${relative(process.cwd(), outFile)}\n`);
  } else {
    out(rendered);
  }
}

function subcommandHelp(name: string): string {
  if (name === "compare") {
    return `usage: breaklint compare <before.json> <after.json> [--out <file>]\n\nCompares two compatible canonical breaklint document reports (schema 4 or 5) and emits a canonical JSON comparison.\n`;
  }
  if (name === "context") {
    return `usage: breaklint context <report.json> [--out <file>] [--max-findings <n>] [--max-text <n>] [--comparison <file>]\n\nBuilds a bounded AI/reader context pack from a canonical document or screen report.\n`;
  }
  return `usage: breaklint bundle <report.json> --out-dir <dir> [--evidence-dir <dir>] [--title <text>] [--theme light|dark] [--comparison <file>] [--max-findings <n>]\n\nWrites a self-contained offline report bundle (report.json, context.json, bundle.json, report.html, verified assets).\n`;
}

export async function runSubcommand(name: string, argv: readonly string[]): Promise<number> {
  try {
    if (argv.includes("--help") || argv.includes("-h")) {
      out(subcommandHelp(name));
      return 0;
    }

    if (name === "compare") {
      const files: string[] = [];
      let outFile: string | undefined;
      for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i] ?? "";
        if (arg === "--out") {
          outFile = requirePathValue(argv[++i], "--out");
        } else if (arg.startsWith("-")) {
          throw new UsageError(`unknown option ${arg} for compare. Try breaklint compare --help.`);
        } else {
          files.push(arg);
        }
      }
      if (files.length !== 2) {
        throw new UsageError("compare requires exactly two report files: breaklint compare <before.json> <after.json>");
      }
      const before = readJsonFile(files[0]!, "before report") as Report;
      const after = readJsonFile(files[1]!, "after report") as Report;
      let comparison: ReportComparison;
      try {
        comparison = await compareReports(before, after);
      } catch (error) {
        if (isIoError(error)) {
          err(`breaklint: compare failed: ${error instanceof Error ? error.message : String(error)}\n`);
          return 3;
        }
        throw new UsageError(`compare failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      emitJson(comparison, outFile, "comparison");
      if (before.runVerdict === "infrastructure" || after.runVerdict === "infrastructure") {
        return 3;
      }
      if (before.runVerdict === "insufficient-coverage" || after.runVerdict === "insufficient-coverage") {
        return 4;
      }
      return 0;
    }

    if (name === "context") {
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
      const report = readJsonFile(files[0]!, "report");
      const comparison = comparisonPath ? validateComparisonInput(readJsonFile(comparisonPath, "comparison"), "comparison") : undefined;
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

    if (name === "bundle") {
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
      const report = readJsonFile(files[0]!, "report") as Report | ReadableScreenReport;
      const comparison = comparisonPath ? validateComparisonInput(readJsonFile(comparisonPath, "comparison"), "comparison") : undefined;
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
      notice(`breaklint: bundle written to ${relative(process.cwd(), result.outDir) || "."} (${result.assets.length} verified asset${result.assets.length === 1 ? "" : "s"})\n`);
      return 0;
    }

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
