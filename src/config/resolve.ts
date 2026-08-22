/**
 * Configuration resolution.
 *
 * JSON only, never JavaScript. Precedence, lowest to highest:
 * defaults < profile < config file < command line. Every effective leaf records which layer won.
 */

import { FAIL_ON_VALUES, IS } from "../core/enums.ts";
import type { FailOn, OutputFormat } from "../core/enums.ts";
import type { Rule, RuleOptions } from "../core/rule.ts";
import type { ReportConfig } from "../core/types.ts";
import { ALL_RULES, RULES_BY_ID } from "../rules/index.ts";
import {
  CONFIG_CONTRACT_VERSION,
  PROFILES,
  PROFILE_NAMES,
  canonicalLocale,
  configPointer,
  defaultCoverageFloor,
  effectiveConfigFingerprint,
  validateConfigFile,
} from "./contract.ts";
import type {
  ConfigFile,
  ConfigSource,
  EffectiveConfig,
  ProfileName,
} from "./contract.ts";

export type { ConfigFile, ConfigSource, EffectiveConfig, ProfileName } from "./contract.ts";
export { CONFIG_CONTRACT_VERSION } from "./contract.ts";

export interface ResolvedConfig {
  contractVersion: typeof CONFIG_CONTRACT_VERSION;
  profile: ProfileName;
  profileSource: ConfigSource;
  failOn: FailOn;
  format: OutputFormat;
  outDir: string;
  activeRules: Rule[];
  disabledRuleIds: string[];
  optionsByRule: Record<string, RuleOptions>;
  coverageFloorsByRule: Record<string, number>;
  coverageFloors: { ruleId: string; default: number; effective: number; source: ConfigSource }[];
  evidenceBinding: boolean;
  sourceMapInjection: boolean;
  network: { mode: "offline" | "allowlist"; allowed: string[] };
  locale: string;
  effective: EffectiveConfig;
  sources: Record<string, ConfigSource>;
  fingerprint: string;
}

export class UsageError extends Error {}

function usage<T>(fn: () => T): T {
  try {
    return fn();
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
}

function assertOrigin(origin: string): void {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    throw new UsageError(`--allow-network ${origin}: expected an http(s) origin such as https://example.com.`);
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.origin !== origin || url.pathname !== "/") {
    throw new UsageError(`--allow-network ${origin}: expected an exact http(s) origin without path, query, or hash.`);
  }
}

export function resolveConfig(input: {
  file: unknown | undefined;
  cli: {
    profile?: string | undefined;
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
  return usage(() => resolveValidated(input.file === undefined ? {} : validateConfigFile(input.file), input.cli));
}

function resolveValidated(file: ConfigFile, cli: Parameters<typeof resolveConfig>[0]["cli"]): ResolvedConfig {
  const sources: Record<string, ConfigSource> = {};
  const source = (path: string, value: ConfigSource): void => {
    sources[path] = value;
  };

  if (file.profile === "strict" && cli.profile === "default") {
    throw new UsageError(
      `--profile default cannot lower coverage established by config profile strict; ` +
        `Configuration Contract v1 permits stricter coverage only.`,
    );
  }
  const profile = (cli.profile ?? file.profile ?? "default") as ProfileName;
  if (!(PROFILE_NAMES as readonly string[]).includes(profile)) {
    throw new UsageError(`config: profile must be one of ${PROFILE_NAMES.join(", ")}.`);
  }
  const profileDefinition = PROFILES[profile];
  const profileSource: ConfigSource =
    cli.profile !== undefined ? "cli" : file.profile === undefined ? "default" : "config";

  const failOnRaw = cli.failOn ?? file.failOn ?? profileDefinition.failOn;
  if (!IS.failOn.has(failOnRaw)) {
    throw new UsageError(
      `--fail-on ${failOnRaw} is not one of ${FAIL_ON_VALUES.join(", ")}. ` +
        `The default is "error": two rules carry a named proof source, and the other thirteen ` +
        `are heuristics that should not break a build unless you ask them to.`,
    );
  }
  const failOn = failOnRaw as FailOn;
  source(
    configPointer("failOn"),
    cli.failOn !== undefined ? "cli" : file.failOn !== undefined ? "config" : profile === "default" ? "default" : "profile",
  );

  const formatRaw = cli.format ?? "console";
  if (!IS.outputFormat.has(formatRaw)) throw new UsageError(`--format ${formatRaw} is not a known output format.`);
  const format = formatRaw as OutputFormat;

  const outDir = cli.outDir ?? "breaklint-report";
  if (outDir.trim().length === 0) throw new UsageError("--out-dir needs a non-empty value.");

  const localeRaw = cli.locale ?? file.locale ?? "de-DE";
  let locale: string;
  try {
    locale = canonicalLocale(localeRaw);
  } catch {
    throw new UsageError(`--locale ${localeRaw}: expected a valid language tag such as de-DE or en-US.`);
  }
  const localeSource: ConfigSource = cli.locale !== undefined ? "cli" : file.locale !== undefined ? "config" : "default";
  source(configPointer("locale"), localeSource);

  const enabled = new Map(ALL_RULES.map((rule) => [rule.id, true]));
  const enabledSources = new Map(ALL_RULES.map((rule) => [rule.id, "default" as ConfigSource]));
  for (const [id, value] of Object.entries(file.rules ?? {})) {
    enabled.set(id, value !== false);
    enabledSources.set(id, "config");
  }
  if (cli.only && cli.only.length > 0) {
    const only = new Set(cli.only);
    for (const id of only) if (!RULES_BY_ID.has(id)) throw new UsageError(`--only ${id}: no such rule.`);
    for (const rule of ALL_RULES) {
      enabled.set(rule.id, only.has(rule.id));
      enabledSources.set(rule.id, "cli");
    }
  }
  for (const id of cli.disable ?? []) {
    if (!RULES_BY_ID.has(id)) throw new UsageError(`--disable ${id}: no such rule.`);
    enabled.set(id, false);
    enabledSources.set(id, "cli");
  }

  const optionsByRule: Record<string, RuleOptions> = {};
  const coverageFloorsByRule: Record<string, number> = {};
  const coverageFloors: ResolvedConfig["coverageFloors"] = [];
  const effectiveRules: EffectiveConfig["rules"] = {};

  for (const rule of ALL_RULES) {
    const optionValues: Record<string, RuleOptions[string]> = { ...rule.defaultOptions };
    const configured = file.rules?.[rule.id];
    const overrides = configured && typeof configured === "object" ? configured : {};
    for (const key of Object.keys(rule.defaultOptions)) {
      const path = configPointer("rules", rule.id, "options", key);
      if (key === "locale") {
        optionValues[key] = locale;
        source(path, localeSource);
      } else if (Object.hasOwn(overrides, key)) {
        const override = overrides[key] as RuleOptions[string];
        optionValues[key] =
          key === "excludeTags" && Array.isArray(override)
            ? [...new Set(override.map((tag) => tag.toLowerCase()))].sort()
            : override;
        source(path, "config");
      } else {
        source(path, "default");
      }
    }
    optionsByRule[rule.id] = Object.freeze(optionValues);

    const baseFloor = profileDefinition.coverageFloor(rule);
    const configuredFloor = file.coverageFloors?.[rule.id];
    if (configuredFloor !== undefined && configuredFloor < baseFloor) {
      throw new UsageError(
        `config: coverageFloors."${rule.id}" cannot lower the active ${profile} floor ` +
          `from ${baseFloor} to ${configuredFloor}; Configuration Contract v1 permits stricter floors only.`,
      );
    }
    const effectiveFloor = configuredFloor ?? baseFloor;
    const floorSource: ConfigSource =
      configuredFloor !== undefined ? "config" : profile === "strict" ? "profile" : "default";
    coverageFloorsByRule[rule.id] = effectiveFloor;
    coverageFloors.push({
      ruleId: rule.id,
      default: defaultCoverageFloor(rule),
      effective: effectiveFloor,
      source: floorSource,
    });

    const isEnabled = enabled.get(rule.id) ?? false;
    effectiveRules[rule.id] = {
      enabled: isEnabled,
      options: optionsByRule[rule.id]!,
      coverageFloor: effectiveFloor,
    };
    source(configPointer("rules", rule.id, "enabled"), enabledSources.get(rule.id) ?? "default");
    source(configPointer("rules", rule.id, "coverageFloor"), floorSource);
  }

  const allowed = [...new Set(cli.allowNetwork ?? [])];
  for (const origin of allowed) assertOrigin(origin);
  allowed.sort();
  const network = {
    mode: allowed.length > 0 ? ("allowlist" as const) : ("offline" as const),
    allowed,
  };
  const networkSource: ConfigSource = cli.allowNetwork && cli.allowNetwork.length > 0 ? "cli" : "default";
  source(configPointer("network", "mode"), networkSource);
  source(configPointer("network", "allowed"), networkSource);

  const evidenceBinding = !cli.noEvidenceBinding;
  const sourceMapInjection = !cli.noSourceMap;
  source(configPointer("evidenceBinding"), cli.noEvidenceBinding ? "cli" : "default");
  source(configPointer("sourceMapInjection"), cli.noSourceMap ? "cli" : "default");

  const effective: EffectiveConfig = {
    failOn,
    locale,
    evidenceBinding,
    sourceMapInjection,
    network,
    rules: effectiveRules,
  };

  const activeRules = ALL_RULES.filter((rule) => effectiveRules[rule.id]!.enabled);
  return {
    contractVersion: CONFIG_CONTRACT_VERSION,
    profile,
    profileSource,
    failOn,
    format,
    outDir,
    activeRules,
    disabledRuleIds: ALL_RULES.filter((rule) => !effectiveRules[rule.id]!.enabled).map((rule) => rule.id),
    optionsByRule,
    coverageFloorsByRule,
    coverageFloors,
    evidenceBinding,
    sourceMapInjection,
    network,
    locale,
    effective,
    sources,
    fingerprint: effectiveConfigFingerprint(effective),
  };
}

export function coverageFloorMap(config: ResolvedConfig): Record<string, number> {
  return { ...config.coverageFloorsByRule };
}

/** The one projection from the resolved contract into the public report model. */
export function toReportConfig(
  config: ResolvedConfig,
  runtime: { interventions: string[]; networkBlocked: number },
): ReportConfig {
  return {
    contractVersion: config.contractVersion,
    fingerprint: config.fingerprint,
    profile: config.profile,
    profileSource: config.profileSource,
    failOn: config.failOn,
    activeRules: config.activeRules.map((rule) => rule.id),
    disabledRules: config.disabledRuleIds,
    coverageFloors: config.coverageFloors,
    effective: config.effective,
    sources: config.sources,
    interventions: runtime.interventions,
    sourceMapInjection: config.sourceMapInjection,
    evidenceBinding: config.evidenceBinding,
    network: { ...config.network, blocked: runtime.networkBlocked },
  };
}
