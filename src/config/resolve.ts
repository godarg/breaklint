/**
 * Configuration resolution.
 *
 * JSON only, never JavaScript. A JS config file means executing code from a foreign repository
 * inside CI, and it means an agent maintaining this project cannot change a threshold without
 * writing a program. Both are worse than the ergonomics are better.
 *
 * Precedence, lowest to highest: rule defaults, profile, config file, command line. Anything
 * the command line changed appears in the report, so a reader can tell a default from a choice.
 */

import { FAIL_ON_VALUES, IS } from "../core/enums.ts";
import type { FailOn, OutputFormat } from "../core/enums.ts";
import type { RuleOptions } from "../core/rule.ts";
import { ALL_RULES, RULES_BY_ID } from "../rules/index.ts";
import type { Rule } from "../core/rule.ts";

export interface ResolvedConfig {
  profile: string;
  failOn: FailOn;
  format: OutputFormat;
  outDir: string;
  activeRules: Rule[];
  disabledRuleIds: string[];
  optionsByRule: Record<string, RuleOptions>;
  /** Only entries the user actually lowered. An empty list means no floor was touched. */
  loweredFloors: { ruleId: string; default: number; configured: number }[];
  evidenceBinding: boolean;
  sourceMapInjection: boolean;
  network: { mode: "offline" | "allowlist"; allowed: string[] };
  locale: string;
}

export interface ConfigFile {
  profile?: string;
  failOn?: string;
  rules?: Record<string, boolean | Record<string, unknown>>;
  coverageFloors?: Record<string, number>;
  locale?: string;
}

export class UsageError extends Error {}

export function resolveConfig(input: {
  file: ConfigFile | null;
  cli: {
    failOn?: string | undefined;
    format?: string | undefined;
    outDir?: string | undefined;
    disable?: string[] | undefined;
    only?: string[] | undefined;
    noEvidenceBinding?: boolean | undefined;
    noSourceMap?: boolean | undefined;
    allowNetwork?: string[] | undefined;
    locale?: string | undefined;
  };
}): ResolvedConfig {
  const file = input.file ?? {};
  const cli = input.cli;

  const failOnRaw = cli.failOn ?? file.failOn ?? "error";
  if (!IS.failOn.has(failOnRaw)) {
    throw new UsageError(
      `--fail-on ${failOnRaw} is not one of ${FAIL_ON_VALUES.join(", ")}. ` +
        `The default is "error": two rules carry a named proof source, and the other thirteen ` +
        `are heuristics that should not break a build unless you ask them to.`,
    );
  }
  const format = cli.format ?? "console";
  if (!IS.outputFormat.has(format)) {
    throw new UsageError(`--format ${format} is not a known output format.`);
  }

  const disabled = new Set(cli.disable ?? []);
  for (const id of disabled) {
    if (!RULES_BY_ID.has(id)) throw new UsageError(`--disable ${id}: no such rule.`);
  }
  const only = cli.only && cli.only.length > 0 ? new Set(cli.only) : null;
  if (only) {
    for (const id of only) {
      if (!RULES_BY_ID.has(id)) throw new UsageError(`--only ${id}: no such rule.`);
    }
  }
  for (const [id, value] of Object.entries(file.rules ?? {})) {
    if (!RULES_BY_ID.has(id)) throw new UsageError(`config: rules."${id}" is not a known rule.`);
    if (value === false) disabled.add(id);
  }

  const activeRules = ALL_RULES.filter((r) => (only ? only.has(r.id) : true) && !disabled.has(r.id));

  const optionsByRule: Record<string, RuleOptions> = {};
  for (const rule of ALL_RULES) {
    const fromFile = file.rules?.[rule.id];
    const overrides =
      fromFile && typeof fromFile === "object" ? (fromFile as Record<string, never>) : {};
    optionsByRule[rule.id] = { ...rule.defaultOptions, ...overrides, locale: cli.locale ?? file.locale ?? "de-DE" };
  }

  // A lowered floor is a deliberate act and appears in the report. A floor that dropped
  // quietly would let a run pass while a rule looked at half the document.
  const loweredFloors: ResolvedConfig["loweredFloors"] = [];
  for (const [ruleId, configured] of Object.entries(file.coverageFloors ?? {})) {
    const rule = RULES_BY_ID.get(ruleId);
    if (!rule) throw new UsageError(`config: coverageFloors."${ruleId}" is not a known rule.`);
    if (typeof configured !== "number" || configured < 0 || configured > 1) {
      throw new UsageError(`config: coverageFloors."${ruleId}" must be between 0 and 1.`);
    }
    const defaultFloor = rule.severity === "error" ? 1 : rule.severity === "warn" ? 0.5 : 0;
    if (configured < defaultFloor) {
      loweredFloors.push({ ruleId, default: defaultFloor, configured });
    }
  }

  return {
    profile: file.profile ?? "default",
    failOn: failOnRaw as FailOn,
    format: format as OutputFormat,
    outDir: cli.outDir ?? "breaklint-report",
    activeRules: [...activeRules],
    disabledRuleIds: [...disabled],
    optionsByRule,
    loweredFloors,
    evidenceBinding: !cli.noEvidenceBinding,
    sourceMapInjection: !cli.noSourceMap,
    network: {
      mode: cli.allowNetwork && cli.allowNetwork.length > 0 ? "allowlist" : "offline",
      allowed: cli.allowNetwork ?? [],
    },
    locale: cli.locale ?? file.locale ?? "de-DE",
  };
}

export function loweredFloorMap(config: ResolvedConfig): Record<string, number> {
  return Object.fromEntries(config.loweredFloors.map((f) => [f.ruleId, f.configured]));
}
