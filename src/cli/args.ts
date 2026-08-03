import { UsageError } from "../config/resolve.ts";

export interface ParsedArgs {
  paths: string[];
  demo: boolean;
  help: boolean;
  version: boolean;
  format?: string;
  outFile?: string;
  outDir?: string;
  failOn?: string;
  only?: string[];
  disable?: string[];
  config?: string;
  locale?: string;
  noEvidenceBinding?: boolean;
  noSourceMap?: boolean;
  allowNetwork?: string[];
}

/**
 * Argument parsing without a dependency.
 *
 * An unknown option is an error, not something to ignore. Silently dropping `--fail-onn warn`
 * would run the default gate while the caller believes they raised it — the caller then reads
 * exit 0 as "no warnings" when it means "warnings were not gated".
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const out: ParsedArgs = { paths: [], demo: false, help: false, version: false };
  const list = (raw: string | undefined, flag: string): string[] => {
    if (!raw) throw new UsageError(`${flag} needs a value.`);
    return raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    switch (arg) {
      case "--demo":
        out.demo = true;
        break;
      case "--help":
      case "-h":
        out.help = true;
        break;
      case "--version":
      case "-v":
        out.version = true;
        break;
      case "--format":
        {
          const value = argv[++i];
          if (!value) throw new UsageError("--format needs a value.");
          out.format = value;
        }
        break;
      case "--out":
        {
          const value = argv[++i];
          if (!value) throw new UsageError("--out needs a value.");
          out.outFile = value;
        }
        break;
      case "--out-dir":
        {
          const value = argv[++i];
          if (!value) throw new UsageError("--out-dir needs a value.");
          out.outDir = value;
        }
        break;
      case "--fail-on":
        {
          const value = argv[++i];
          if (!value) throw new UsageError("--fail-on needs a value.");
          out.failOn = value;
        }
        break;
      case "--only":
        out.only = list(argv[++i], "--only");
        break;
      case "--disable":
        out.disable = list(argv[++i], "--disable");
        break;
      case "--config":
        {
          const value = argv[++i];
          if (!value) throw new UsageError("--config needs a value.");
          out.config = value;
        }
        break;
      case "--locale":
        {
          const value = argv[++i];
          if (!value) throw new UsageError("--locale needs a value.");
          out.locale = value;
        }
        break;
      case "--no-evidence-binding":
        out.noEvidenceBinding = true;
        break;
      case "--no-source-map":
        out.noSourceMap = true;
        break;
      case "--allow-network": {
        const origin = argv[++i];
        if (!origin) throw new UsageError("--allow-network needs an origin.");
        // One origin per flag, repeatable. There is no wildcard: a wildcard turns an allowlist
        // into a formality, and this tool executes foreign HTML including its scripts.
        if (origin.includes("*")) {
          throw new UsageError("--allow-network takes one origin; there is no wildcard.");
        }
        (out.allowNetwork ??= []).push(origin);
        break;
      }
      default:
        if (arg.startsWith("-")) {
          throw new UsageError(`unknown option ${arg}. Try --help.`);
        }
        out.paths.push(arg);
    }
  }
  if (out.demo && out.paths.length > 0) {
    throw new UsageError("--demo runs a stored snapshot; it takes no input files.");
  }
  return out;
}
