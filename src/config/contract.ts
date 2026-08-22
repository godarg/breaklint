/**
 * Configuration Contract v1.
 *
 * The rule registry is the only source for rule ids, default option names/types and proof source.
 * Runtime validation and the published JSON Schema both derive from it. A field copied into a
 * second table would eventually be accepted by one path and ignored by the other — the defect this
 * module exists to make structurally difficult.
 */

import { COVERAGE_FLOOR_BY_SEVERITY, FAIL_ON_VALUES } from "../core/enums.ts";
import type { FailOn } from "../core/enums.ts";
import { sha256 } from "../core/fingerprint.ts";
import type { Rule, RuleOptions } from "../core/rule.ts";
import { ALL_RULES, RULES_BY_ID } from "../rules/index.ts";

export const CONFIG_CONTRACT_VERSION = 1 as const;
export const CONFIG_SOURCES = ["default", "profile", "config", "cli"] as const;
export type ConfigSource = (typeof CONFIG_SOURCES)[number];

export const PROFILE_NAMES = ["default", "strict"] as const;
export type ProfileName = (typeof PROFILE_NAMES)[number];

export const LOCALE_PATTERN_SOURCE =
  "^[A-Za-z]{2,3}(?:-[A-Za-z]{4})?(?:-(?:[A-Za-z]{2}|[0-9]{3}))?(?:-(?:[A-Za-z0-9]{5,8}|[0-9][A-Za-z0-9]{3}))*$";
const LOCALE_PATTERN = new RegExp(LOCALE_PATTERN_SOURCE, "u");

export type ConfigFile = {
  profile?: string;
  failOn?: string;
  rules?: Record<string, boolean | Record<string, unknown>>;
  coverageFloors?: Record<string, number>;
  locale?: string;
};

export interface EffectiveRuleConfig {
  enabled: boolean;
  options: RuleOptions;
  coverageFloor: number;
}

export interface EffectiveConfig {
  failOn: FailOn;
  locale: string;
  evidenceBinding: boolean;
  sourceMapInjection: boolean;
  network: { mode: "offline" | "allowlist"; allowed: string[] };
  rules: Record<string, EffectiveRuleConfig>;
}

export interface ProfileDefinition {
  failOn: FailOn;
  coverageFloor(rule: Rule): number;
}

export const PROFILES: Readonly<Record<ProfileName, ProfileDefinition>> = Object.freeze({
  default: Object.freeze({
    failOn: "error" as const,
    coverageFloor: (rule: Rule) => defaultCoverageFloor(rule),
  }),
  strict: Object.freeze({
    failOn: "warn" as const,
    coverageFloor: (_rule: Rule) => 1,
  }),
});

export function defaultCoverageFloor(rule: Rule): number {
  return COVERAGE_FLOOR_BY_SEVERITY[rule.severity];
}

export function configPointer(...segments: string[]): string {
  return `/${segments.map((segment) => segment.replace(/~/gu, "~0").replace(/\//gu, "~1")).join("/")}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unknownKeys(value: Record<string, unknown>, allowed: readonly string[]): string[] {
  const allow = new Set(allowed);
  return Object.keys(value).filter((key) => !allow.has(key)).sort();
}

function assertLocale(value: unknown, path: string): asserts value is string {
  if (typeof value !== "string" || !LOCALE_PATTERN.test(value)) {
    throw new Error(`${path} must be a supported language tag such as de-DE or en-US.`);
  }
}

export function canonicalLocale(value: string): string {
  assertLocale(value, "locale");
  return value
    .split("-")
    .map((part, index) => {
      if (index === 0) return part.toLowerCase();
      if (/^[A-Za-z]{4}$/u.test(part)) return `${part[0]!.toUpperCase()}${part.slice(1).toLowerCase()}`;
      if (/^[A-Za-z]{2}$/u.test(part)) return part.toUpperCase();
      return part.toLowerCase();
    })
    .join("-");
}

function assertOptionValue(rule: Rule, key: string, value: unknown): void {
  const expected = rule.defaultOptions[key];
  const path = `config: rules."${rule.id}".${key}`;
  if (typeof expected === "number") {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`${path} must be a finite number greater than or equal to 0.`);
    }
    return;
  }
  if (typeof expected === "string") {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`${path} must be a non-empty string.`);
    }
    return;
  }
  if (typeof expected === "boolean") {
    if (typeof value !== "boolean") throw new Error(`${path} must be a boolean.`);
    return;
  }
  if (Array.isArray(expected)) {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.length === 0)) {
      throw new Error(`${path} must be an array of non-empty strings.`);
    }
    if (key === "excludeTags" && value.some((entry) => !/^[A-Za-z][A-Za-z0-9-]*$/u.test(entry))) {
      throw new Error(`${path} accepts HTML tag names, not CSS selectors.`);
    }
    return;
  }
  throw new Error(`${path} has no runtime option contract.`);
}

function validateRuleValue(rule: Rule, value: unknown): void {
  if (typeof value === "boolean") return;
  if (!isRecord(value)) {
    throw new Error(`config: rules."${rule.id}" must be true, false, or an options object.`);
  }
  const keys = Object.keys(value).sort();
  if (rule.proofSource === "A" && keys.length > 0) {
    throw new Error(
      `config: rules."${rule.id}" has a proof-source-A threshold; its options are fixed in ` +
        `Configuration Contract v1 and cannot be overridden.`,
    );
  }
  const allowed = Object.keys(rule.defaultOptions).filter((key) => key !== "locale");
  const unknown = unknownKeys(value, allowed);
  if (unknown.length > 0) {
    if (unknown[0] === "excludeSelectors" && Object.hasOwn(rule.defaultOptions, "excludeTags")) {
      throw new Error(
        `config: rules."${rule.id}" option "excludeSelectors" was renamed to "excludeTags" in ` +
          `Configuration Contract v1; provide HTML tag names, not CSS selectors.`,
      );
    }
    throw new Error(`config: rules."${rule.id}" has unknown option "${unknown[0]}".`);
  }
  for (const key of keys) assertOptionValue(rule, key, value[key]);
}

/** Validate a parsed JSON value before resolution. Unknown input never becomes an ignored field. */
export function validateConfigFile(raw: unknown): ConfigFile {
  if (!isRecord(raw)) throw new Error("config must be a JSON object.");
  const unknown = unknownKeys(raw, ["profile", "failOn", "rules", "coverageFloors", "locale"]);
  if (unknown.length > 0) throw new Error(`config: unknown top-level field "${unknown[0]}".`);

  if (raw.profile !== undefined) {
    if (typeof raw.profile !== "string" || !(PROFILE_NAMES as readonly string[]).includes(raw.profile)) {
      throw new Error(`config: profile must be one of ${PROFILE_NAMES.join(", ")}.`);
    }
  }
  if (raw.failOn !== undefined) {
    if (typeof raw.failOn !== "string" || !(FAIL_ON_VALUES as readonly string[]).includes(raw.failOn)) {
      throw new Error(`config: failOn must be one of ${FAIL_ON_VALUES.join(", ")}.`);
    }
  }
  if (raw.locale !== undefined) assertLocale(raw.locale, "config: locale");

  if (raw.rules !== undefined) {
    if (!isRecord(raw.rules)) throw new Error("config: rules must be an object.");
    for (const [id, value] of Object.entries(raw.rules)) {
      const rule = RULES_BY_ID.get(id);
      if (!rule) throw new Error(`config: rules."${id}" is not a known rule.`);
      validateRuleValue(rule, value);
    }
  }

  if (raw.coverageFloors !== undefined) {
    if (!isRecord(raw.coverageFloors)) throw new Error("config: coverageFloors must be an object.");
    for (const [id, value] of Object.entries(raw.coverageFloors)) {
      if (!RULES_BY_ID.has(id)) throw new Error(`config: coverageFloors."${id}" is not a known rule.`);
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error(`config: coverageFloors."${id}" must be a finite number between 0 and 1.`);
      }
    }
  }

  return raw as ConfigFile;
}

function optionSchema(key: string, defaultValue: RuleOptions[string]): Record<string, unknown> {
  if (typeof defaultValue === "number") return { type: "number", minimum: 0, default: defaultValue };
  if (typeof defaultValue === "string") return { type: "string", minLength: 1, default: defaultValue };
  if (typeof defaultValue === "boolean") return { type: "boolean", default: defaultValue };
  return {
    type: "array",
    items: {
      type: "string",
      minLength: 1,
      ...(key === "excludeTags" ? { pattern: "^[A-Za-z][A-Za-z0-9-]*$" } : {}),
    },
    default: [...defaultValue],
  };
}

/** JSON Schema is generated from the same runtime registry used by validateConfigFile(). */
export function configSchema(): Record<string, unknown> {
  const ruleProperties = Object.fromEntries(
    ALL_RULES.map((rule) => {
      const properties = Object.fromEntries(
        Object.entries(rule.defaultOptions)
          .filter(([key]) => key !== "locale" && rule.proofSource !== "A")
          .map(([key, value]) => [key, optionSchema(key, value)]),
      );
      return [
        rule.id,
        {
          oneOf: [
            { type: "boolean" },
            { type: "object", additionalProperties: false, properties },
          ],
          description:
            rule.proofSource === "A"
              ? "Rule enablement only. Proof-source-A options are fixed by Configuration Contract v1."
              : rule.summary,
        },
      ];
    }),
  );
  const floorProperties = Object.fromEntries(
    ALL_RULES.map((rule) => [
      rule.id,
      {
        type: "number",
        minimum: defaultCoverageFloor(rule),
        maximum: 1,
        description: "May raise the active profile floor; runtime rejects lowering a stricter profile.",
      },
    ]),
  );
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://dargel-solutions.de/schemas/breaklint/config-v1.json",
    title: "breaklint Configuration Contract v1",
    description: "JSON-only, fail-closed configuration for breaklint 0.2.x.",
    type: "object",
    additionalProperties: false,
    properties: {
      profile: { type: "string", enum: [...PROFILE_NAMES], default: "default" },
      failOn: { type: "string", enum: [...FAIL_ON_VALUES] },
      locale: { type: "string", pattern: LOCALE_PATTERN_SOURCE, default: "de-DE" },
      rules: { type: "object", additionalProperties: false, properties: ruleProperties },
      coverageFloors: { type: "object", additionalProperties: false, properties: floorProperties },
    },
    allOf: [
      {
        if: { properties: { profile: { const: "strict" } }, required: ["profile"] },
        then: {
          properties: {
            coverageFloors: {
              type: "object",
              additionalProperties: false,
              properties: Object.fromEntries(
                ALL_RULES.map((rule) => [rule.id, { type: "number", minimum: 1, maximum: 1 }]),
              ),
            },
          },
        },
      },
    ],
  };
}

/** Deterministic JSON for fingerprints and generated artifacts; arrays retain semantic order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function effectiveConfigFingerprint(config: EffectiveConfig): string {
  return sha256(`breaklint-effective-config-v1\0${canonicalJson(config)}`);
}
