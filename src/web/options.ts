import type { CheckPageOptions, HostBuildContainerBinding, NamedScreenException } from "./types.ts";

const MAX_TARGETS = 5_000;
const MAX_TIMEOUT_MS = 15_000;
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, allowed: readonly string[], label: string): void => {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new TypeError(`${label} has unknown field ${unknown.sort()[0]}`);
};
const string = (value: unknown, label: string, max = 512): string => {
  if (typeof value !== "string" || value.trim() === "" || value.length > max || value.includes("\0")) throw new TypeError(`${label} must be a non-empty bounded string`);
  return value;
};
function exceptions(value: unknown, label: string): readonly NamedScreenException[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100) throw new TypeError(`${label} must be a bounded array`);
  return value.map((entry, index) => {
    if (!isRecord(entry)) throw new TypeError(`${label}[${index}] must be an object`);
    keys(entry, ["selector", "reason"], `${label}[${index}]`);
    return { selector: string(entry.selector, `${label}[${index}].selector`), reason: string(entry.reason, `${label}[${index}].reason`) };
  });
}
function binding(value: unknown): HostBuildContainerBinding | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new TypeError("sourceBinding must be an object");
  keys(value, ["kind", "root", "receiptPath", "buildOutputReceiptPath", "compiledBuildSelector", "compiledBuildAttribute", "containers"], "sourceBinding");
  if (value.kind !== "host-build-container") throw new TypeError("sourceBinding.kind must be host-build-container");
  if (!Array.isArray(value.containers) || value.containers.length > 200) throw new TypeError("sourceBinding.containers must be a bounded array");
  return {
    kind: "host-build-container", root: string(value.root, "sourceBinding.root", 4_096), receiptPath: string(value.receiptPath, "sourceBinding.receiptPath"), ...(value.buildOutputReceiptPath === undefined ? {} : { buildOutputReceiptPath: string(value.buildOutputReceiptPath, "sourceBinding.buildOutputReceiptPath") }),
    compiledBuildSelector: string(value.compiledBuildSelector, "sourceBinding.compiledBuildSelector"), compiledBuildAttribute: string(value.compiledBuildAttribute, "sourceBinding.compiledBuildAttribute"),
    containers: value.containers.map((entry, index) => {
      if (!isRecord(entry)) throw new TypeError(`sourceBinding.containers[${index}] must be an object`);
      keys(entry, ["selector", "file"], `sourceBinding.containers[${index}]`);
      return { selector: string(entry.selector, `sourceBinding.containers[${index}].selector`), file: string(entry.file, `sourceBinding.containers[${index}].file`) };
    }),
  };
}

/** Strict, closed input validation before any host-page call. */
export function validateCheckPageOptions(value: unknown): CheckPageOptions {
  if (!isRecord(value)) throw new TypeError("checkPage options must be an object");
  keys(value, ["trust", "networkPolicy", "scenario", "projectId", "documentId", "runId", "output", "geometry", "sourceBinding"], "checkPage options");
  if (value.trust !== "host-controlled-page") throw new TypeError("trust must be host-controlled-page");
  if (value.networkPolicy !== "host-owned") throw new TypeError("networkPolicy must be host-owned");
  if (!isRecord(value.output)) throw new TypeError("output must be an object");
  keys(value.output, ["dir", "screenshot"], "output");
  const output = { dir: string(value.output.dir, "output.dir", 4_096), screenshot: value.output.screenshot };
  if (output.screenshot !== "viewport" && output.screenshot !== "full-page") throw new TypeError("output.screenshot must be viewport or full-page");
  let geometry: CheckPageOptions["geometry"];
  if (value.geometry !== undefined) {
    if (!isRecord(value.geometry)) throw new TypeError("geometry must be an object");
    keys(value.geometry, ["allowedScrollContainers", "intentionalOverlays", "maxTargets", "stabilizationTimeoutMs"], "geometry");
    if (value.geometry.maxTargets !== undefined && typeof value.geometry.maxTargets !== "number") throw new TypeError("geometry.maxTargets must be a number");
    if (value.geometry.stabilizationTimeoutMs !== undefined && typeof value.geometry.stabilizationTimeoutMs !== "number") throw new TypeError("geometry.stabilizationTimeoutMs must be a number");
    const maxTargets: number | undefined = value.geometry.maxTargets;
    const stabilizationTimeoutMs: number | undefined = value.geometry.stabilizationTimeoutMs;
    if (maxTargets !== undefined && (!Number.isInteger(maxTargets) || maxTargets < 1 || maxTargets > MAX_TARGETS)) throw new TypeError(`geometry.maxTargets must be an integer from 1 to ${MAX_TARGETS}`);
    if (stabilizationTimeoutMs !== undefined && (!Number.isInteger(stabilizationTimeoutMs) || stabilizationTimeoutMs < 0 || stabilizationTimeoutMs > MAX_TIMEOUT_MS)) throw new TypeError(`geometry.stabilizationTimeoutMs must be an integer from 0 to ${MAX_TIMEOUT_MS}`);
    const allowedScrollContainers = exceptions(value.geometry.allowedScrollContainers, "geometry.allowedScrollContainers");
    const intentionalOverlays = exceptions(value.geometry.intentionalOverlays, "geometry.intentionalOverlays");
    geometry = { ...(allowedScrollContainers !== undefined ? { allowedScrollContainers } : {}), ...(intentionalOverlays !== undefined ? { intentionalOverlays } : {}), ...(maxTargets !== undefined ? { maxTargets } : {}), ...(stabilizationTimeoutMs !== undefined ? { stabilizationTimeoutMs } : {}) };
  }
  const optionalId = (name: "projectId" | "documentId" | "runId"): string | undefined => value[name] === undefined ? undefined : string(value[name], name, 256);
  const projectId = optionalId("projectId"), documentId = optionalId("documentId"), runId = optionalId("runId"), sourceBinding = binding(value.sourceBinding);
  return { trust: "host-controlled-page", networkPolicy: "host-owned", scenario: string(value.scenario, "scenario"), output: output as CheckPageOptions["output"], ...(projectId !== undefined ? { projectId } : {}), ...(documentId !== undefined ? { documentId } : {}), ...(runId !== undefined ? { runId } : {}), ...(geometry !== undefined ? { geometry } : {}), ...(sourceBinding !== undefined ? { sourceBinding } : {}) };
}

// Mirrors string(): at least one non-whitespace character and no NUL. minLength alone accepted
// " " and "a\u0000", which validateCheckPageOptions rejects before the first page call.
const text = (maxLength: number) => ({ type: "string", minLength: 1, maxLength, pattern: "^[^\\u0000]*[^\\s\\u0000][^\\u0000]*$" }) as const;

const EXCEPTION_SCHEMA = {
  type: "object", additionalProperties: false, required: ["selector", "reason"],
  properties: { selector: text(512), reason: text(512) },
} as const;

/** Static projection of validateCheckPageOptions. Keep it closed: consumers use it preflight. */
export const SCREEN_OPTIONS_SCHEMA: Readonly<Record<string, unknown>> = Object.freeze({
  type: "object", additionalProperties: false, required: ["trust", "networkPolicy", "scenario", "output"],
  properties: {
    trust: { const: "host-controlled-page" }, networkPolicy: { const: "host-owned" },
    scenario: text(512), projectId: text(256),
    documentId: text(256), runId: text(256),
    output: { type: "object", additionalProperties: false, required: ["dir", "screenshot"], properties: { dir: text(4096), screenshot: { enum: ["viewport", "full-page"] } } },
    geometry: { type: "object", additionalProperties: false, properties: { allowedScrollContainers: { type: "array", maxItems: 100, items: EXCEPTION_SCHEMA }, intentionalOverlays: { type: "array", maxItems: 100, items: EXCEPTION_SCHEMA }, maxTargets: { type: "integer", minimum: 1, maximum: MAX_TARGETS }, stabilizationTimeoutMs: { type: "integer", minimum: 0, maximum: MAX_TIMEOUT_MS } } },
    sourceBinding: { type: "object", additionalProperties: false, required: ["kind", "root", "receiptPath", "compiledBuildSelector", "compiledBuildAttribute", "containers"], properties: { kind: { const: "host-build-container" }, root: text(4096), receiptPath: text(512), buildOutputReceiptPath: text(512), compiledBuildSelector: text(512), compiledBuildAttribute: text(512), containers: { type: "array", maxItems: 200, items: { type: "object", additionalProperties: false, required: ["selector", "file"], properties: { selector: text(512), file: text(512) } } } } },
  },
});
