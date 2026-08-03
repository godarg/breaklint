#!/usr/bin/env node
/**
 * The command line.
 *
 * Three states, and the middle one is why this file exists at all: a checker that exits 0 when
 * it passed *and* 0 when it did nothing reports its own idleness as success. So a run that
 * could not measure ends with 4, a run that could not start ends with 2 or 3, and only a run
 * that measured something and found nothing above the threshold ends with 0.
 *
 * Input is N paths to HTML files. There is no directory recursion, no glob expansion inside the
 * tool and no symlink following. The shell has done this correctly for fifty years, including
 * symlink cycles; `breaklint docs/**\/*.html` works and is legible. An earlier design promised
 * "file or directory" and carried the discovery problems as an open gap — a promised capability
 * whose design is missing is not a gap, it is a hole.
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";

import { SUPPORTED_PAGEDJS_VERSION } from "../core/enums.ts";
import { buildReport } from "../core/build-report.ts";
import { runDocument } from "../core/engine.ts";
import type { DocumentInput } from "../core/engine.ts";
import { loweredFloorMap, resolveConfig, UsageError } from "../config/resolve.ts";
import type { ConfigFile } from "../config/resolve.ts";
import { render } from "../report/index.ts";
import { parseArgs } from "./args.ts";
import type { Snapshot } from "../core/types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const VERSION = readPackageVersion();

export async function main(argv: string[]): Promise<number> {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`breaklint: ${(error as Error).message}\n`);
    return 2;
  }

  if (args.help) {
    process.stdout.write(helpText());
    return 0;
  }
  if (args.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  let config;
  try {
    config = resolveConfig({ file: loadConfigFile(args.config), cli: args });
  } catch (error) {
    if (error instanceof UsageError) {
      process.stderr.write(`breaklint: ${error.message}\n`);
      return 2;
    }
    throw error;
  }

  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  let inputs: DocumentInput[];
  let mode: "demo" | "live";
  let source: "rendered" | "recorded snapshot fixture" | "handwritten snapshot fixture";

  if (args.demo) {
    mode = "demo";
    const fixture = loadDemoSnapshot();
    source = fixture.source;
    inputs = [{ path: fixture.path, snapshot: fixture.snapshot, infrastructure: [] }];
  } else {
    mode = "live";
    source = "rendered";
    if (args.paths.length === 0) {
      process.stderr.write(
        "breaklint: no input files given.\n" +
          "  usage: breaklint [options] <file.html> [more.html ...]\n" +
          "  try:   npx breaklint --demo\n",
      );
      return 2;
    }
    for (const p of args.paths) {
      if (!existsSync(p)) {
        // A path that does not exist is a typo in the invocation, not a finding about a
        // document. Exit 2, and the message names the path rather than the count.
        process.stderr.write(`breaklint: input not found: ${p}\n`);
        return 2;
      }
    }
    // The live path needs a renderer. Saying which one, with a command that installs it, is
    // the difference between a tool that failed and a tool that told you how to proceed.
    const { renderDocuments } = await import("../acquire/render-run.ts");
    const rendered = await renderDocuments(args.paths, {
      outDir: config.outDir,
      evidenceBinding: config.evidenceBinding,
      sourceMapInjection: config.sourceMapInjection,
      network: config.network,
      locale: config.locale,
    });
    if (rendered.fatal) {
      process.stderr.write(rendered.fatal.message + "\n");
      return rendered.fatal.exitCode;
    }
    inputs = rendered.documents;
  }

  const outcomes = inputs.map((input) =>
    runDocument(input, {
      failOn: config.failOn,
      activeRules: config.activeRules,
      optionsByRule: config.optionsByRule,
      loweredFloors: loweredFloorMap(config),
    }),
  );

  const report = buildReport({
    outcomes,
    mode,
    source,
    toolVersion: VERSION,
    commit: null,
    startedAt,
    durationMs: Date.now() - t0,
    rulesRun: config.activeRules.length,
    failOn: config.failOn,
    environment: {
      browserVersion: inputs[0]?.snapshot?.meta.browserVersion ?? "",
      platform: process.platform,
      rendererPath: null,
      rendererPresent: mode === "live",
      pagedjsVersion: inputs[0]?.snapshot?.meta.pagedjsVersion ?? SUPPORTED_PAGEDJS_VERSION,
      rasterizer: null,
      rasterizerVersion: null,
      textPositionExtractor: null,
      fontFamiliesResolved: inputs[0]?.snapshot?.meta.inputIdentity?.fontFamilies ?? [],
      locale: config.locale,
    },
    config: {
      profile: config.profile,
      failOn: config.failOn,
      activeRules: config.activeRules.map((r) => r.id),
      disabledRules: config.disabledRuleIds,
      loweredFloors: config.loweredFloors,
      interventions: inputs[0]?.snapshot?.meta.interventions ?? [],
      sourceMapInjection: config.sourceMapInjection,
      evidenceBinding: config.evidenceBinding,
      network: { ...config.network, blocked: 0 },
    },
  });

  const rendered = render(report, config.format, { colour: process.stdout.isTTY === true });
  if (args.outFile) {
    mkdirSync(dirname(resolvePath(args.outFile)), { recursive: true });
    writeFileSync(args.outFile, rendered);
    process.stdout.write(`breaklint: ${config.format} report written to ${relative(process.cwd(), args.outFile)}\n`);
  } else {
    process.stdout.write(rendered);
  }
  return report.exitCode;
}

function loadConfigFile(path: string | undefined): ConfigFile | null {
  const candidate = path ?? "breaklint.config.json";
  if (!existsSync(candidate)) {
    if (path) throw new UsageError(`--config ${path}: file not found.`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(candidate, "utf8")) as ConfigFile;
  } catch (error) {
    throw new UsageError(`--config ${candidate}: not valid JSON (${(error as Error).message}).`);
  }
}

function loadDemoSnapshot(): {
  path: string;
  snapshot: Snapshot;
  source: "recorded snapshot fixture" | "handwritten snapshot fixture";
} {
  // The demo runs the real rule chain over a stored snapshot. It demonstrates the rules and
  // the reporters; it does not demonstrate the render path, and the report says so in its own
  // `mode` and `source` fields rather than leaving the reader to assume.
  const file = resolvePath(HERE, "../../examples/demo-snapshot.json");
  const parsed = JSON.parse(readFileSync(file, "utf8")) as {
    breaklintDemo: { documentPath: string; source: "recorded snapshot fixture" | "handwritten snapshot fixture" };
    snapshot: Snapshot;
  };
  return {
    path: parsed.breaklintDemo.documentPath,
    snapshot: parsed.snapshot,
    source: parsed.breaklintDemo.source,
  };
}

function readPackageVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(resolvePath(HERE, "../../package.json"), "utf8")) as { version: string };
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

function helpText(): string {
  return `breaklint ${VERSION} — layout checks for documents generated from HTML to PDF

usage
  breaklint [options] <file.html> [more.html ...]
  breaklint --demo

  There is no directory recursion and no glob expansion in the tool. Use the shell:
      breaklint docs/**/*.html

options
  --demo                    Run the rule and reporter chain over a stored snapshot. No
                            renderer needed. Ends with exit 1, because the fixture contains
                            findings on purpose — a demo that ends 0 never shows you one.
  --format <f>              json | sarif | console | html | junit | markdown  (default console)
                            json is the truth; every other format is a lossy projection.
  --out <file>              Write the report to a file instead of stdout.
  --fail-on <level>         error | warn | never   (default error)
                            error: the two rules with a named proof source gate.
                            warn:  the heuristics gate too — deliberately, on request.
                            never: report only. Coverage still decides exit 4.
  --only <rule,...>         Run only these rules.
  --disable <rule,...>      Run everything except these.
  --config <file>           JSON config (default ./breaklint.config.json).
  --locale <tag>            Locale for the type/ rules (default de-DE).
  --no-evidence-binding     Skip the evidence marks. Findings keep bindsFinding: false.
  --no-source-map           Skip source id injection. Every finding then has source: null.
  --allow-network <origin>  Permit one origin. Repeatable. Default is fully offline.
  --help, --version

exit codes
  0  checked, coverage met, nothing reached the threshold
  1  at least one non-experimental finding reached the threshold
  2  invalid invocation: unknown option, bad config, input path does not exist
  3  infrastructure: no renderer, font failed, pagination aborted, checker crashed
  4  nothing or too little was judged — no input, no active rule, coverage below the floor

  Paged.js is pinned to exactly ${SUPPORTED_PAGEDJS_VERSION}. Any other resolved version stops
  the run with exit 3: the break cause is read from attributes the paginator writes and does
  not guarantee, so a report from an unmeasured version would state things nobody measured.
`;
}

const invokedDirectly = process.argv[1] && resolvePath(process.argv[1]) === resolvePath(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      process.stderr.write(`breaklint: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
      process.exit(3);
    });
}
