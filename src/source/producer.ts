/**
 * The narrow producer boundary used by `checkProducedDocuments`.
 *
 * A source manifest may describe bytes, but it never gets to select a program.  The host owns
 * the executable, argv, program files and options, starts that program without a shell, and
 * accepts a record only after the process boundary and every referenced byte have been checked.
 */

import { createHash, randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

import { parseDeclaredManifest, type SourceManifestV1 } from "./provenance.ts";
import { captureBoundedSourceFile, decodeUtf8Strict } from "./bytes.ts";
import { coordinateAtUtf8Byte } from "./bytes.ts";
import {
  CapturedResourceClosureError,
  capturedResourceClosure,
  renderCapturedDocuments,
  type RenderOptions,
} from "../acquire/render-run.ts";
import { runDocument } from "../core/engine.ts";
import { buildReport } from "../core/build-report.ts";
import { redactReport } from "../report/redact.ts";
import { coverageFloorMap, resolveConfig, toReportConfig } from "../config/resolve.ts";
import type { ConfigFile } from "../config/contract.ts";
import type { Report } from "../core/types.ts";
import type { DocumentRevision } from "../core/types.ts";
import { identitiesForProducedOutput } from "./identity.ts";
import { captureHostGit, bindCapturedRevision, type HostGitRevisionOptions } from "./revision.ts";

export const PRODUCER_RECORD_PROTOCOL = "studio-producer-record-v1" as const;
export const PRODUCER_RECORD_MAX_BYTES = 10 * 1024 * 1024;
export const PRODUCER_TIMEOUT_MS = 120_000;
export const PRODUCER_MAX_FILES = 2_000;
export const PRODUCER_MAX_TOTAL_BYTES = 256 * 1024 * 1024;

export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type SourceRole = "authoring" | "dependency" | "asset";

export interface ProducerFile {
  id: string;
  /** Absolute host-selected file. This value is never serialised into a report. */
  path: string;
}

export interface HostControlledProducer {
  trust: "host-controlled-producer";
  id: string;
  executable: string;
  argv: readonly string[];
  codeFiles: readonly ProducerFile[];
  producerOptions: JsonValue;
}

export interface ProducerInputRecord {
  path: string;
  sha256: string;
  bytes: number;
  role: SourceRole;
}

export interface CopyPiece {
  kind: "copy";
  inputPath: string;
  inputStart: number;
  inputEnd: number;
  outputStart: number;
  outputEnd: number;
}

export interface GeneratedPiece {
  kind: "generated";
  outputStart: number;
  outputEnd: number;
}
export type ProducerPiece = CopyPiece | GeneratedPiece;

export interface ProducerOutputRecord {
  path: string;
  sha256: string;
  bytes: number;
  pieces: readonly ProducerPiece[];
}

export type ProducedSourceOrigin =
  | { status: "exact-original-range"; path: string; start: number; end: number; role: SourceRole }
  | { status: "generated-or-unknown" }
  | { status: "ambiguous"; candidates: number };

export interface CodeDigestRecord { id: string; sha256: string; bytes: number; }
export interface ProducerRecord {
  protocol: typeof PRODUCER_RECORD_PROTOCOL;
  runId: string;
  producerId: string;
  complete: true;
  expected: readonly ProducerInputRecord[];
  reads: readonly ProducerInputRecord[];
  outputs: readonly ProducerOutputRecord[];
  options: JsonValue;
  code: { sha256: string; files: readonly CodeDigestRecord[]; dependencies: readonly CodeDigestRecord[] };
}

export interface ProducerFailure {
  ok: false;
  code: "source/producer-record-mismatch" | "source/producer-incomplete";
  detail: string;
}
declare const producedDocumentCapability: unique symbol;
/** Opaque, non-serialisable authority. It is valid only when present in this module's WeakMap. */
export interface ProducedDocumentCapability { readonly [producedDocumentCapability]: "produced-document-capability"; }
interface PrivateCapability {
  revision?: DocumentRevision;
  record: ProducerRecord;
  receiptHash: string;
  outputs: ReadonlyMap<string, Buffer>;
  inputs: ReadonlyMap<string, Buffer>;
  inputRoles: ReadonlyMap<string, SourceRole>;
}
const PRIVATE_CAPABILITIES = new WeakMap<ProducedDocumentCapability, PrivateCapability>();
export interface ProducerSuccess { ok: true; capability: ProducedDocumentCapability; }
/** Internal acquisition seam; deliberately not exported from the package root. */
export function producedBytesForInternalRender(capability: ProducedDocumentCapability): {
  revision?: DocumentRevision;
  outputs: ReadonlyMap<string, Buffer>;
  inputs: ReadonlyMap<string, Buffer>;
  inputRoles: ReadonlyMap<string, SourceRole>;
  producerId: string;
  receiptHash: string;
  sourceFiles: readonly { file: string; sha256: string; byteLength: number; role: SourceRole }[];
  codeSha256: string;
  optionsSha256: string;
  sourceOrigin: (outputPath: string, start: number, end: number) => ProducedSourceOrigin;
} {
  const privateState = PRIVATE_CAPABILITIES.get(capability);
  if (!privateState) throw new Error("unknown or expired produced-document capability");
  return {
    ...(privateState.revision ? { revision: privateState.revision } : {}),
    outputs: privateState.outputs, inputs: privateState.inputs, inputRoles: privateState.inputRoles,
    producerId: privateState.record.producerId, receiptHash: privateState.receiptHash,
    sourceFiles: privateState.record.reads.map((input) => ({ file: input.path, sha256: input.sha256, byteLength: input.bytes, role: input.role })),
    codeSha256: privateState.record.code.sha256,
    optionsSha256: sha256(Buffer.from(canonical(privateState.record.options), "utf8")),
    sourceOrigin: (outputPath, start, end) => resolveProducedSourceOrigin(privateState.record, outputPath, start, end),
  };
}
export type ProducerCheckResult = ProducerFailure | ProducerSuccess;

export interface CheckProducedDocumentsOptions {
  revision?: HostGitRevisionOptions;
  /** Host-created only. It is deliberately opaque to the producer record. */
  runRoot?: string;
  timeoutMs?: number;
  /** An imported declaration may be compared by a caller, but can never create a receipt. */
  manifest?: unknown;
  keepRunRoot?: boolean;
}

interface CapturedCode { record: CodeDigestRecord; bytes: Buffer; }

function sha256(bytes: Buffer | string): string { return createHash("sha256").update(bytes).digest("hex"); }
/** Only host-authored structured categories cross the public failure boundary. */
class PublicProducerError extends Error {}
function safeFailureDetail(value: unknown): string {
  if (value instanceof PublicProducerError) return value.message;
  if (value instanceof CapturedResourceClosureError) return "captured required resource closure is absent or invalid";
  // OS, configuration, renderer and child errors may contain arbitrary quoted paths, fragments
  // or secrets. Do not infer a path grammar from their text or truncate it before sanitizing.
  const code = value && typeof value === "object" ? (value as { code?: unknown }).code : undefined;
  const safeCode = typeof code === "string" && ["ENOENT", "EACCES", "EPERM", "EIO", "ENOSPC", "EMFILE", "ENOTDIR", "EEXIST", "EINVAL"].includes(code) ? ` (${code})` : "";
  return `producer acquisition or configuration failed${safeCode}; private error details withheld`;
}
function canonical(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(",")}]`;
  const object = value as { readonly [key: string]: JsonValue };
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key]!)}`).join(",")}}`;
}
function isDigest(value: unknown): value is CodeDigestRecord {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && /^[a-f0-9]{64}$/u.test(String(v.sha256)) && Number.isSafeInteger(v.bytes) && Number(v.bytes) >= 0;
}
function isRelativePath(path: string): boolean {
  return path.length > 0 && path.length <= 4096 && !path.includes("\\") && !path.includes("\0") &&
    !path.startsWith("/") && !/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(path) &&
    path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}
function sameDigest(a: readonly CodeDigestRecord[], b: readonly CodeDigestRecord[]): boolean {
  const order = (values: readonly CodeDigestRecord[]) => [...values].sort((x, y) => x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
  return codeDigest(order(a)) === codeDigest(order(b));
}
/** Cross-language protocol digest: file key order is part of the byte-level contract. */
function codeDigest(files: readonly CodeDigestRecord[]): string {
  const json = `[${[...files].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map((file) =>
    `{\"id\":${JSON.stringify(file.id)},\"sha256\":${JSON.stringify(file.sha256)},\"bytes\":${file.bytes}}`,
  ).join(",")}]`;
  return sha256(Buffer.from(json, "utf8"));
}
function stableRead(path: string, limit = PRODUCER_RECORD_MAX_BYTES): Buffer {
  const absolute = resolve(path); const root = dirname(absolute); const leaf = basename(absolute);
  return captureBoundedSourceFile(root, leaf, limit, "producer code");
}
function captureCode(files: readonly ProducerFile[]): CapturedCode[] {
  if (files.length === 0 || files.length > PRODUCER_MAX_FILES) throw new PublicProducerError("invalid producer code file inventory");
  const ids = new Set<string>();
  return files.map(({ id, path }) => {
    if (!/^@[A-Za-z0-9._/-]+$/u.test(id) || ids.has(id)) throw new PublicProducerError("invalid duplicate code file id");
    ids.add(id);
    const bytes = stableRead(path);
    return { bytes, record: { id, sha256: sha256(bytes), bytes: bytes.length } };
  });
}
function blob(runRoot: string, digest: string): Buffer {
  if (!/^[a-f0-9]{64}$/u.test(digest)) throw new PublicProducerError("invalid blob digest");
  const file = join(runRoot, "blobs", digest);
  const root = resolve(runRoot, "blobs");
  if (!existsSync(root) || lstatSync(root).isSymbolicLink() || basename(file) !== digest || !existsSync(file) || lstatSync(file).isSymbolicLink() || realpathSync(dirname(file)) !== realpathSync(root)) {
    throw new PublicProducerError("private blob is absent or unsafe");
  }
  return captureBoundedSourceFile(root, digest, PRODUCER_MAX_TOTAL_BYTES, "private producer blob");
}
function validInput(value: unknown): value is ProducerInputRecord {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return exactly(v, ["path", "sha256", "bytes", "role"]) && typeof v.path === "string" && isRelativePath(v.path) && /^[a-f0-9]{64}$/u.test(String(v.sha256)) &&
    Number.isSafeInteger(v.bytes) && Number(v.bytes) >= 0 && ["authoring", "dependency", "asset"].includes(String(v.role));
}
function validPiece(value: unknown): value is ProducerPiece {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const bounds = [v.outputStart, v.outputEnd].every((n) => Number.isSafeInteger(n) && Number(n) >= 0) && Number(v.outputStart) <= Number(v.outputEnd);
  if (!bounds) return false;
  return (v.kind === "generated" && exactly(v, ["kind", "outputStart", "outputEnd"])) || (v.kind === "copy" && exactly(v, ["kind", "inputPath", "inputStart", "inputEnd", "outputStart", "outputEnd"]) && typeof v.inputPath === "string" && isRelativePath(v.inputPath) &&
    Number.isSafeInteger(v.inputStart) && Number(v.inputStart) >= 0 && Number.isSafeInteger(v.inputEnd) && Number(v.inputEnd) >= Number(v.inputStart));
}
function validOutput(value: unknown): value is ProducerOutputRecord {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return exactly(v, ["path", "sha256", "bytes", "pieces"]) && typeof v.path === "string" && isRelativePath(v.path) && /^[a-f0-9]{64}$/u.test(String(v.sha256)) &&
    Number.isSafeInteger(v.bytes) && Number(v.bytes) >= 0 && Array.isArray(v.pieces) && v.pieces.every(validPiece);
}
function validateRecord(value: unknown): value is ProducerRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  const code = r.code as Record<string, unknown> | null;
  return exactly(r, ["protocol", "runId", "producerId", "complete", "expected", "reads", "outputs", "options", "code"]) && r.protocol === PRODUCER_RECORD_PROTOCOL && typeof r.runId === "string" && typeof r.producerId === "string" && r.complete === true &&
    Array.isArray(r.expected) && r.expected.every(validInput) && Array.isArray(r.reads) && r.reads.every(validInput) &&
    Array.isArray(r.outputs) && r.outputs.every(validOutput) && code !== null && typeof code === "object" &&
    exactly(code, ["sha256", "files", "dependencies"]) && /^[a-f0-9]{64}$/u.test(String(code.sha256)) && Array.isArray(code.files) && code.files.every(isDigest) &&
    Array.isArray(code.dependencies) && code.dependencies.every(isDigest);
}
function exactly(value: Record<string, unknown>, fields: readonly string[]): boolean { return Object.keys(value).every((key) => fields.includes(key)) && fields.every((field) => Object.hasOwn(value, field)); }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function closed(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object`);
  const unknown = Object.keys(value).filter((key) => !fields.includes(key)).sort();
  if (unknown.length > 0) throw new TypeError(`${label} has unknown field ${unknown[0]}`);
  return value;
}
function required(value: Record<string, unknown>, field: string, label: string): unknown {
  if (!Object.hasOwn(value, field)) throw new TypeError(`${label}.${field} is required`);
  return value[field];
}
function stringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.includes("\0"))) {
    throw new TypeError(`${label} must be an array of strings without NUL`);
  }
  return value;
}
function jsonValue(value: unknown, label: string, depth = 0): asserts value is JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number") {
    if (Number.isFinite(value)) return;
    throw new TypeError(`${label} must contain only finite JSON numbers`);
  }
  if (depth >= 64) throw new TypeError(`${label} exceeds the JSON nesting limit`);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => jsonValue(entry, `${label}[${index}]`, depth + 1));
    return;
  }
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) jsonValue(entry, `${label}.${key}`, depth + 1);
    return;
  }
  throw new TypeError(`${label} must be a JSON value`);
}

/**
 * Public producer calls have a closed runtime shape before their host-owned executable can start.
 * Shape/type misuse rejects as TypeError, while a valid invocation that cannot acquire a receipt
 * keeps the typed ProducerFailure result. Configuration semantics use that latter result too.
 */
function validateProducedCheckInput(value: unknown): { producer: HostControlledProducer; manifest?: unknown; options: ProducedCheckOptions } {
  const input = closed(value, ["producer", "manifest", "options"], "checkProducedDocuments input");
  const rawProducer = closed(required(input, "producer", "checkProducedDocuments input"), ["trust", "id", "executable", "argv", "codeFiles", "producerOptions"], "producer");
  if (rawProducer.trust !== "host-controlled-producer") throw new TypeError("producer.trust must be host-controlled-producer");
  if (typeof rawProducer.id !== "string" || typeof rawProducer.executable !== "string") throw new TypeError("producer.id and producer.executable must be strings");
  const argv = stringArray(rawProducer.argv, "producer.argv");
  if (!Array.isArray(rawProducer.codeFiles)) throw new TypeError("producer.codeFiles must be an array");
  rawProducer.codeFiles.forEach((file, index) => {
    const row = closed(file, ["id", "path"], `producer.codeFiles[${index}]`);
    if (typeof row.id !== "string" || typeof row.path !== "string" || row.path.includes("\0")) {
      throw new TypeError(`producer.codeFiles[${index}] must contain string id and path without NUL`);
    }
  });
  if (!Object.hasOwn(rawProducer, "producerOptions")) throw new TypeError("producer.producerOptions is required");
  jsonValue(rawProducer.producerOptions, "producer.producerOptions");

  const rawOptions = closed(required(input, "options", "checkProducedDocuments input"), [
    "revision", "outputPaths", "config", "profile", "failOn", "only", "disable", "outDir",
    "evidenceBinding", "sourceMapInjection", "network", "locale", "timeoutMs", "runRoot",
  ], "checkProducedDocuments options");
  const outputPaths = stringArray(required(rawOptions, "outputPaths", "checkProducedDocuments options"), "options.outputPaths");
  for (const field of ["profile", "failOn", "outDir", "locale", "runRoot"] as const) {
    if (rawOptions[field] !== undefined && (typeof rawOptions[field] !== "string" || rawOptions[field].includes("\0"))) throw new TypeError(`options.${field} must be a string without NUL`);
  }
  for (const field of ["only", "disable"] as const) {
    if (rawOptions[field] !== undefined) stringArray(rawOptions[field], `options.${field}`);
  }
  for (const field of ["evidenceBinding", "sourceMapInjection"] as const) {
    if (rawOptions[field] !== undefined && typeof rawOptions[field] !== "boolean") throw new TypeError(`options.${field} must be a boolean`);
  }
  if (rawOptions.timeoutMs !== undefined && (typeof rawOptions.timeoutMs !== "number" || !Number.isSafeInteger(rawOptions.timeoutMs) || rawOptions.timeoutMs < 1)) {
    throw new TypeError("options.timeoutMs must be a positive safe integer");
  }
  if (rawOptions.config !== undefined && !isRecord(rawOptions.config)) throw new TypeError("options.config must be an object");
  if (rawOptions.network !== undefined) {
    const network = closed(rawOptions.network, ["mode", "allowed"], "options.network");
    if (network.mode !== "offline" && network.mode !== "allowlist") throw new TypeError("options.network.mode must be offline or allowlist");
    const allowed = stringArray(required(network, "allowed", "options.network"), "options.network.allowed");
    if ((network.mode === "offline" && allowed.length !== 0) || (network.mode === "allowlist" && allowed.length === 0)) {
      throw new TypeError("options.network mode must agree with whether its allowlist is empty");
    }
  }
  if (rawOptions.revision !== undefined) {
    const revision = closed(rawOptions.revision, ["repositoryRoot", "sourcePrefix"], "options.revision");
    if (typeof required(revision, "repositoryRoot", "options.revision") !== "string" ||
      (revision.sourcePrefix !== undefined && typeof revision.sourcePrefix !== "string")) {
      throw new TypeError("options.revision requires string repositoryRoot and optional string sourcePrefix");
    }
  }
  return {
    producer: {
      trust: "host-controlled-producer", id: rawProducer.id, executable: rawProducer.executable, argv,
      codeFiles: rawProducer.codeFiles as readonly ProducerFile[], producerOptions: rawProducer.producerOptions,
    },
    ...(Object.hasOwn(input, "manifest") ? { manifest: input.manifest } : {}),
    options: {
      outputPaths, ...(rawOptions.config === undefined ? {} : { config: rawOptions.config as ConfigFile }),
      ...(rawOptions.profile === undefined ? {} : { profile: rawOptions.profile as string }), ...(rawOptions.failOn === undefined ? {} : { failOn: rawOptions.failOn as string }),
      ...(rawOptions.only === undefined ? {} : { only: rawOptions.only as string[] }), ...(rawOptions.disable === undefined ? {} : { disable: rawOptions.disable as string[] }),
      ...(rawOptions.outDir === undefined ? {} : { outDir: rawOptions.outDir as string }), ...(rawOptions.evidenceBinding === undefined ? {} : { evidenceBinding: rawOptions.evidenceBinding as boolean }),
      ...(rawOptions.sourceMapInjection === undefined ? {} : { sourceMapInjection: rawOptions.sourceMapInjection as boolean }),
      ...(rawOptions.network === undefined ? {} : { network: rawOptions.network as NonNullable<ProducedCheckOptions["network"]> }), ...(rawOptions.locale === undefined ? {} : { locale: rawOptions.locale as string }),
      ...(rawOptions.timeoutMs === undefined ? {} : { timeoutMs: rawOptions.timeoutMs as number }), ...(rawOptions.runRoot === undefined ? {} : { runRoot: rawOptions.runRoot as string }),
      ...(rawOptions.revision === undefined ? {} : { revision: rawOptions.revision as HostGitRevisionOptions }),
    },
  };
}
function noDuplicates<T extends { path: string }>(values: readonly T[], label: string): void {
  const set = new Set<string>();
  for (const value of values) { if (set.has(value.path)) throw new PublicProducerError(`duplicate ${label} path`); set.add(value.path); }
}
function validateBytes(record: ProducerRecord, runRoot: string): { inputs: ReadonlyMap<string, Buffer>; outputs: ReadonlyMap<string, Buffer> } {
  const cache = new Map<string, Buffer>();
  let total = 0;
  const load = (digest: string): Buffer => {
    const prior = cache.get(digest); if (prior) return prior;
    const bytes = blob(runRoot, digest); cache.set(digest, bytes); total += bytes.length;
    if (total > PRODUCER_MAX_TOTAL_BYTES) throw new PublicProducerError("producer record bytes exceed limit");
    return bytes;
  };
  const inputs = new Map<string, Buffer>();
  for (const input of record.reads) {
    const bytes = load(input.sha256);
    if (bytes.length !== input.bytes || sha256(bytes) !== input.sha256) throw new PublicProducerError("input blob hash mismatch");
    inputs.set(input.path, bytes);
  }
  const outputs = new Map<string, { record: ProducerOutputRecord; bytes: Buffer }>();
  for (const output of record.outputs) {
    const bytes = load(output.sha256);
    if (bytes.length !== output.bytes || sha256(bytes) !== output.sha256) throw new PublicProducerError("output blob hash mismatch");
    outputs.set(output.path, { record: output, bytes });
  }
  let pieces = 0;
  const sourceBytes = (path: string): Buffer | null => {
    const input = inputs.get(path); if (input) return input;
    const output = outputs.get(path); return output ? output.bytes : null;
  };
  for (const output of record.outputs) {
    const bytes = outputs.get(output.path)!.bytes;
    let cursor = 0;
    for (const piece of output.pieces) {
      if (++pieces > 100_000) throw new PublicProducerError("producer mapping exceeds piece limit");
      if (piece.outputStart !== cursor || piece.outputEnd > bytes.length) throw new PublicProducerError("output pieces do not partition");
      if (piece.kind === "copy") {
        const source = sourceBytes(piece.inputPath);
        if (!source || piece.inputEnd > source.length || piece.outputEnd - piece.outputStart !== piece.inputEnd - piece.inputStart ||
          !source.subarray(piece.inputStart, piece.inputEnd).equals(bytes.subarray(piece.outputStart, piece.outputEnd))) {
          throw new PublicProducerError("invalid copy edge");
        }
      }
      cursor = piece.outputEnd;
    }
    if (cursor !== bytes.length) throw new PublicProducerError("output pieces leave a gap");
  }
  // Copy edges between produced outputs are an explicit DAG. Byte equality is not a cycle proof.
  const graph = new Map<string, Set<string>>();
  for (const output of record.outputs) graph.set(output.path, new Set(output.pieces.flatMap((piece) =>
    piece.kind === "copy" && outputs.has(piece.inputPath) ? [piece.inputPath] : [])));
  const visiting = new Set<string>(); const done = new Set<string>();
  const visit = (path: string): void => {
    if (visiting.has(path)) throw new PublicProducerError("producer output copy graph contains a cycle");
    if (done.has(path)) return;
    visiting.add(path); for (const target of graph.get(path) ?? []) visit(target); visiting.delete(path); done.add(path);
  };
  for (const path of graph.keys()) visit(path);
  return { inputs, outputs: new Map([...outputs].map(([path, value]) => [path, value.bytes])) };
}

/** Imported declarations are compared to a live receipt; they never select or authorise it. */
function importedManifestMatchesRecord(value: unknown, record: ProducerRecord): boolean {
  let manifest: SourceManifestV1;
  try {
    const bytes = Buffer.isBuffer(value)
      ? value
      : Buffer.from(typeof value === "string" ? value : JSON.stringify(value), "utf8");
    manifest = parseDeclaredManifest(bytes);
  } catch { return false; }
  if (manifest.producer.id !== record.producerId) return false;
  // Manifest producer version is an untrusted declaration: the FD3 protocol has no host-bound
  // version field. Dependencies do have a receipt field, so compare their full digest inventory.
  if (!sameDigest(manifest.producer.dependencies, record.code.dependencies)) return false;
  const expected = new Map(record.expected.map((item) => [item.path, item]));
  if (manifest.inputs.length !== expected.size) return false;
  for (const input of manifest.inputs) {
    const actual = expected.get(input.path);
    if (!actual || actual.sha256 !== input.sha256 || actual.bytes !== input.bytes) return false;
  }
  const output = record.outputs.find((item) => item.path === manifest.output.path);
  if (!output || output.sha256 !== manifest.output.sha256 || output.bytes !== manifest.output.bytes) return false;
  for (const mapping of manifest.mappings) {
    const origin = resolveProducedSourceOrigin(record, manifest.output.path, mapping.outputStart, mapping.outputEnd);
    if (origin.status !== "exact-original-range" || origin.path !== mapping.sourcePath || origin.start !== mapping.sourceStart || origin.end !== mapping.sourceEnd) {
      return false;
    }
  }
  return true;
}

/**
 * Traces an output byte interval through actual recorder pieces. This is the link from a rendered
 * output range to a source input, not a heuristic over equal text. A generated piece remains
 * unknown; competing copy paths remain visibly ambiguous.
 */
export function resolveProducedSourceOrigin(
  record: ProducerRecord,
  outputPath: string,
  start: number,
  end: number,
): ProducedSourceOrigin {
  if (!isRelativePath(outputPath) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
    return { status: "generated-or-unknown" };
  }
  const reads = new Map(record.reads.map((item) => [item.path, item]));
  const outputs = new Map(record.outputs.map((item) => [item.path, item]));
  const visit = (path: string, from: number, to: number, seen: Set<string>): ProducedSourceOrigin[] => {
    const output = outputs.get(path);
    if (!output || seen.has(`${path}:${from}:${to}`)) return [];
    const matches = output.pieces.filter((piece) => piece.outputStart <= from && piece.outputEnd >= to);
    if (matches.length !== 1) return matches.length === 0 ? [{ status: "generated-or-unknown" }] : [{ status: "ambiguous", candidates: matches.length }];
    const piece = matches[0]!;
    if (piece.kind === "generated") return [{ status: "generated-or-unknown" }];
    const sourceStart = piece.inputStart + (from - piece.outputStart);
    const sourceEnd = sourceStart + (to - from);
    const leaf = reads.get(piece.inputPath);
    if (leaf) return [{ status: "exact-original-range", path: leaf.path, start: sourceStart, end: sourceEnd, role: leaf.role }];
    return visit(piece.inputPath, sourceStart, sourceEnd, new Set([...seen, `${path}:${from}:${to}`]));
  };
  const candidates = visit(outputPath, start, end, new Set());
  const exact = candidates.filter((candidate): candidate is Extract<ProducedSourceOrigin, { status: "exact-original-range" }> => candidate.status === "exact-original-range");
  if (exact.length === 1 && candidates.length === 1) return exact[0]!;
  if (exact.length > 1 || candidates.some((candidate) => candidate.status === "ambiguous")) return { status: "ambiguous", candidates: exact.length || candidates.length };
  return { status: "generated-or-unknown" };
}
/** Verifies closure of the process group created for this producer, independently of its leader. */
async function cleanupOwnedProducer(child: ReturnType<typeof spawn>): Promise<void> {
  if (!child.pid) return; // A process-start failure created no owned process group.
  if (process.platform === "win32") {
    child.kill("SIGKILL");
    throw new PublicProducerError("producer incomplete: owned process group cleanup is unsupported");
  }
  const group = -child.pid;
  const exists = (): boolean => {
    try { process.kill(group, 0); return true; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      throw new PublicProducerError("producer incomplete: owned process group cleanup could not be verified");
    }
  };
  const signal = (value: NodeJS.Signals): void => {
    try { process.kill(group, value); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw new PublicProducerError("producer incomplete: owned process group termination failed");
    }
  };
  const waitUntilAbsent = async (duration: number): Promise<boolean> => {
    const deadline = Date.now() + duration;
    while (exists()) {
      if (Date.now() >= deadline) return false;
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, 10));
    }
    return true;
  };
  if (!exists()) return;
  signal("SIGTERM");
  if (await waitUntilAbsent(500)) return;
  signal("SIGKILL");
  if (!(await waitUntilAbsent(1000))) throw new PublicProducerError("producer incomplete: owned process group survived bounded cleanup");
}

function waitForResult(child: ReturnType<typeof spawn>, timeoutMs: number): Promise<{ exitCode: number | null; recordBytes: Buffer; stderrPresent: boolean }> {
  return new Promise((resolveResult, reject) => {
    const fd = child.stdio[3];
    const chunks: Buffer[] = []; let size = 0; let stderrPresent = false; let closed = false; let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = async (error: unknown, exitCode: number | null = null): Promise<void> => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      try {
        await cleanupOwnedProducer(child);
        if (error) reject(error);
        else resolveResult({ exitCode, recordBytes: Buffer.concat(chunks), stderrPresent });
      } catch (cleanupError) { reject(cleanupError); }
    };
    const fail = (message: string): void => { void finish(new PublicProducerError(message)); };
    // Install the start-error handler even when protocol-pipe setup fails.
    child.once("error", (error) => { void finish(error); });
    if (!fd || typeof (fd as { on?: unknown }).on !== "function") { fail("FD3 pipe unavailable"); return; }
    timer = setTimeout(() => fail("producer timeout or held FD3"), timeoutMs);
    (fd as NodeJS.ReadableStream).on("data", (chunk: Buffer) => { size += chunk.length; if (size > PRODUCER_RECORD_MAX_BYTES) fail("producer record exceeds limit"); else chunks.push(chunk); });
    (fd as NodeJS.ReadableStream).on("end", () => { closed = true; });
    // Draining stdout is required even though it is not protocol data: a verbose child otherwise
    // blocks on its pipe before it can close FD3.
    (child.stdout as NodeJS.ReadableStream).on("data", () => {});
    // Drain without retaining untrusted text. Exit status is useful public context; arbitrary
    // child stderr is not a portable diagnostic and cannot safely be sanitized by guessing.
    (child.stderr as NodeJS.ReadableStream).on("data", (chunk: Buffer) => { stderrPresent ||= chunk.length > 0; });
    child.once("close", (exitCode) => {
      if (!closed) { fail("producer exited without FD3 EOF"); return; }
      void finish(null, exitCode);
    });
  });
}

/** Executes only host-selected code and returns an internal receipt after complete validation. */
export async function acquireProducedDocuments(
  input: { producer: HostControlledProducer; manifest?: unknown; options?: Omit<CheckProducedDocumentsOptions, "manifest"> },
): Promise<ProducerCheckResult> {
  const { producer } = input;
  const options = input.options ?? {};
  if (producer.trust !== "host-controlled-producer" || !producer.id || !producer.executable || producer.argv.some((arg) => arg.includes("\0"))) {
    return { ok: false, code: "source/producer-record-mismatch", detail: "producer authority is malformed" };
  }
  const runId = randomBytes(16).toString("hex");
  const runRoot = options.runRoot ? resolve(options.runRoot) : join(process.cwd(), ".breaklint-private", `producer-${runId}`);
  let accepted = false;
  try {
    const gitBefore = options.revision ? await captureHostGit(options.revision) : null;
    mkdirSync(join(runRoot, "blobs"), { recursive: true, mode: 0o700 });
    const captured = captureCode(producer.codeFiles);
    const expectedCode = captured.map((item) => item.record);
    const child = spawn(producer.executable, [...producer.argv, "--record-fd", "3", "--run-id", runId, "--run-root", runRoot], {
      shell: false, stdio: ["ignore", "pipe", "pipe", "pipe"], windowsHide: true, detached: process.platform !== "win32",
    });
    const result = await waitForResult(child, options.timeoutMs ?? PRODUCER_TIMEOUT_MS);
    if (result.exitCode !== 0) throw new PublicProducerError(`producer exited ${result.exitCode ?? "by signal"}; record not accepted${result.stderrPresent ? "; private stderr withheld" : ""}`);
    let raw: unknown;
    try { raw = JSON.parse(decodeUtf8Strict(result.recordBytes, "producer FD3 record")); } catch { throw new PublicProducerError("FD3 did not contain one JSON object"); }
    if (!validateRecord(raw)) throw new PublicProducerError("producer record has an invalid schema");
    const record = raw;
    if (record.runId !== runId || record.producerId !== producer.id) throw new PublicProducerError("producer record run or producer id mismatch");
    if (canonical(record.options) !== canonical(producer.producerOptions)) throw new PublicProducerError("producer options mismatch");
    if (!sameDigest(record.code.files, expectedCode) || record.code.sha256 !== codeDigest(expectedCode) || record.code.dependencies.length !== 0) {
      throw new PublicProducerError("producer code inventory mismatch");
    }
    // Re-capture after completion: a changed producer source invalidates this run.
    const after = captureCode(producer.codeFiles).map((item) => item.record);
    if (!sameDigest(expectedCode, after)) throw new PublicProducerError("producer code changed during run");
    noDuplicates(record.expected, "expected"); noDuplicates(record.reads, "read"); noDuplicates(record.outputs, "output");
    const inputsAndOutputs = new Set(record.reads.map((item) => item.path));
    if (record.outputs.some((output) => inputsAndOutputs.has(output.path))) throw new PublicProducerError("input and output paths collide");
    if (record.expected.length > PRODUCER_MAX_FILES || record.reads.length > PRODUCER_MAX_FILES || record.outputs.length > PRODUCER_MAX_FILES) {
      throw new PublicProducerError("producer inventory exceeds file limit");
    }
    // Every actual read must have been expected. A producer cannot silently consume an undeclared leaf.
    const expected = new Map(record.expected.map((item) => [item.path, item]));
    if (record.expected.length !== record.reads.length) throw new PublicProducerError("producer expected/read inventory is incomplete");
    for (const read of record.reads) {
      const declared = expected.get(read.path);
      if (!declared || read.sha256 !== declared.sha256 || read.bytes !== declared.bytes || read.role !== declared.role) {
        throw new PublicProducerError("actual read was not expected");
      }
    }
    const capturedBytes = validateBytes(record, runRoot);
    if (input.manifest !== undefined && !importedManifestMatchesRecord(input.manifest, record)) {
      throw new PublicProducerError("imported source manifest does not match current producer record");
    }
    // Retain the exact buffers that passed hash, partition and copy validation. Reopening a blob
    // here would create a second authority after the receipt has already been accepted.
    const outputs = new Map(record.outputs.map((output) => [output.path, Buffer.from(capturedBytes.outputs.get(output.path)!)]));
    const inputs = new Map(record.reads.map((input) => [input.path, Buffer.from(capturedBytes.inputs.get(input.path)!)]));
    const gitAfter = options.revision ? await captureHostGit(options.revision) : null;
    const revision = gitBefore && gitAfter ? bindCapturedRevision(gitBefore, gitAfter,
      record.reads.map(file => ({ file: file.path, sha256: file.sha256, byteLength: file.bytes, role: file.role })),
      record.code.sha256, sha256(Buffer.from(canonical(record.options), "utf8"))) : undefined;
    const capability = {} as ProducedDocumentCapability;
    PRIVATE_CAPABILITIES.set(capability, {
      ...(revision ? { revision } : {}),
      record, receiptHash: sha256(result.recordBytes), outputs, inputs,
      inputRoles: new Map(record.reads.map((input) => [input.path, input.role])),
    });
    accepted = true;
    return { ok: true, capability };
  } catch (error) {
    const detail = safeFailureDetail(error);
    return { ok: false, code: /timeout|EOF|incomplete/iu.test(detail) ? "source/producer-incomplete" : "source/producer-record-mismatch", detail };
  } finally {
    // A caller-provided root can hold other local data. Only the random root this module created
    // is removed automatically; explicit debugging roots remain for their owner to clean up.
    if ((!accepted || !options.keepRunRoot) && !options.runRoot) {
      try { rmSync(runRoot, { recursive: true, force: true }); }
      catch { return { ok: false, code: "source/producer-incomplete", detail: "producer incomplete: private run directory cleanup failed" }; }
    }
  }
}

export interface ProducedCheckOptions {
  /** Host-owned local Git continuity, never accepted from manifest data. */
  revision?: HostGitRevisionOptions;
  outputPaths: readonly string[];
  config?: ConfigFile;
  profile?: string;
  failOn?: string;
  only?: string[];
  disable?: string[];
  outDir?: string;
  evidenceBinding?: boolean;
  sourceMapInjection?: boolean;
  network?: { mode: "offline" | "allowlist"; allowed: string[] };
  locale?: string;
  timeoutMs?: number;
  runRoot?: string;
}
/** The public result intentionally contains no receipt, capability, or copy-origin authority. */
export type ProducedDocumentsResult =
  | { ok: true; report: Report }
  | { ok: false; code: ProducerFailure["code"]; detail: string };

/** The single public producer entry point: produce, render captured bytes, evaluate and report. */
export async function checkProducedDocuments(input: {
  producer: HostControlledProducer;
  manifest?: unknown;
  options: ProducedCheckOptions;
}): Promise<ProducedDocumentsResult> {
  const checked = validateProducedCheckInput(input);
  let resolved: ReturnType<typeof resolveConfig>;
  try {
    // Resolve the complete configuration before creating the producer process. A semantically
    // invalid config remains a typed acquisition failure, as do later receipt failures.
    resolved = resolveConfig({ file: checked.options.config, cli: {
      profile: checked.options.profile, failOn: checked.options.failOn, outDir: checked.options.outDir,
      only: checked.options.only, disable: checked.options.disable,
      noEvidenceBinding: checked.options.evidenceBinding === false,
      noSourceMap: checked.options.sourceMapInjection === false,
      allowNetwork: checked.options.network?.mode === "allowlist" ? checked.options.network.allowed : [], locale: checked.options.locale,
    } });
  } catch (error) {
    return { ok: false, code: "source/producer-record-mismatch", detail: safeFailureDetail(error) };
  }
  const requested = [...new Set(checked.options.outputPaths)];
  if (requested.length === 0 || requested.length !== checked.options.outputPaths.length) {
    return { ok: false, code: "source/producer-record-mismatch", detail: "outputPaths must be a non-empty unique list" };
  }
  const startedAt = new Date().toISOString(); const started = Date.now();
  const acquired = await acquireProducedDocuments({ producer: checked.producer, manifest: checked.manifest, options: checked.options });
  if (!acquired.ok) return acquired;
  try {
    const state = producedBytesForInternalRender(acquired.capability);
    const inputs = requested.map((path) => {
      const html = state.outputs.get(path);
      if (!html) throw new PublicProducerError("requested produced output is absent");
      const assets = capturedResourceClosure(
        decodeUtf8Strict(html, path),
        path,
        [...state.inputs].flatMap(([logicalPath, bytes]) => {
          const role = state.inputRoles.get(logicalPath);
          return role === "dependency" || role === "asset" ? [{ logicalPath, bytes, role }] : [];
        }),
      );
      return {
        path, html, assets, sourceFiles: state.sourceFiles,
        producer: {
          id: state.producerId, receiptHash: state.receiptHash,
          codeSha256: state.codeSha256, optionsSha256: state.optionsSha256,
        },
        sourceRefForOutput: (start: number, end: number) => {
          const origin = state.sourceOrigin(path, start, end);
          if (origin.status !== "exact-original-range" || origin.role !== "authoring") return null;
          const bytes = state.inputs.get(origin.path); if (!bytes) return null;
          const text = decodeUtf8Strict(bytes, origin.path);
          const a = coordinateAtUtf8Byte(text, origin.start); const b = coordinateAtUtf8Byte(text, origin.end);
          return { file: origin.path, offset: origin.start, endOffset: origin.end, line: a.line, column: a.column, endLine: b.line, endColumn: b.column, coordinateSystem: "utf8-bytes-unicode-codepoints-v1" as const };
        },
      };
    });
    const renderOptions: RenderOptions = { outDir: resolved.outDir, evidenceBinding: resolved.evidenceBinding, sourceMapInjection: resolved.sourceMapInjection, network: resolved.network, locale: resolved.locale };
    const rendered = await renderCapturedDocuments(inputs, renderOptions);
    if (rendered.fatal || !rendered.environment) return { ok: false, code: "source/producer-incomplete", detail: "captured renderer setup failed; private error details withheld" };
    const outcomes = rendered.documents.map((document) => {
      const output = state.outputs.get(document.path);
      const identity = output ? identitiesForProducedOutput({ outputPath: document.path, output,
        inputs: state.inputs, inputRoles: state.inputRoles, sourceOrigin: state.sourceOrigin }) : undefined;
      return runDocument({ ...document,
        ...(identity ? { sourceIdentity: identity } : {}),
        ...(state.revision ? { revision: state.revision, comparisonScope: {
          projectId: state.revision.projectId, documentId: sha256(JSON.stringify([state.revision.projectId, document.path])), scenario: "document-print" as const,
        } } : {}),
      }, {
      failOn: resolved.failOn, activeRules: resolved.activeRules,
      optionsByRule: resolved.optionsByRule, coverageFloors: coverageFloorMap(resolved),
      });
    });
    const version = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version?: string };
    return {
      ok: true,
      report: redactReport(buildReport({
        outcomes, mode: "live", source: "rendered", toolVersion: version.version ?? "0.0.0", commit: null,
        startedAt, durationMs: Date.now() - started, rulesRun: resolved.activeRules.length,
        environment: rendered.environment,
        config: toReportConfig(resolved, { interventions: [], networkBlocked: rendered.environment.networkBlocked }),
        failOn: resolved.failOn, runId: randomBytes(12).toString("hex"),
      })),
    };
  } catch (error) {
    return {
      ok: false,
      code: error instanceof CapturedResourceClosureError ? "source/producer-incomplete" : "source/producer-record-mismatch",
      detail: safeFailureDetail(error),
    };
  }
}
