/** Strict declared-manifest v1 verifier. It proves matching bytes, never producer authorship. */

import { createHash } from "node:crypto";

import { captureBoundedSourceFile, decodeUtf8Strict } from "./bytes.ts";

export const SOURCE_MANIFEST_SCHEMA_VERSION = 1 as const;
const MAX_MANIFEST_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 2_000;
const MAX_MAPPINGS = 100_000;
const MAX_SOURCE_BYTES = 256 * 1024 * 1024;

export interface DeclaredFile { path: string; sha256: string; bytes: number; }
export interface CopyMapping {
  outputStart: number; outputEnd: number; sourcePath: string; sourceStart: number; sourceEnd: number;
  sourceId: string; authorId?: string;
}
export interface SourceManifestV1 {
  schemaVersion: 1; projectId: string; documentId: string;
  producer: { id: string; version: string; dependencies: readonly { id: string; sha256: string; bytes: number }[] };
  inputs: readonly DeclaredFile[]; output: DeclaredFile; mappings: readonly CopyMapping[];
  revision?: string; delivery?: { path: string; sha256: string; bytes: number };
}
export interface DeclaredProvenanceResult {
  ok: boolean;
  binding: "declared" | "unavailable";
  copyIntegrity: "verified" | "unavailable";
  diagnostics: string[];
}
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
function own(object: Record<string, unknown>, allowed: readonly string[]): boolean { return Object.keys(object).every((key) => allowed.includes(key)); }
export function isSafeRelativePath(path: string): boolean {
  return path.length > 0 && path.length <= 4096 && !path.includes("\0") && !path.includes("\\") && !path.startsWith("/") &&
    !/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(path) && path.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}
function file(value: unknown): value is DeclaredFile {
  if (!value || typeof value !== "object") return false; const v = value as Record<string, unknown>;
  return own(v, ["path", "sha256", "bytes"]) && typeof v.path === "string" && isSafeRelativePath(v.path) && /^[a-f0-9]{64}$/u.test(String(v.sha256)) && Number.isSafeInteger(v.bytes) && Number(v.bytes) >= 0;
}
function dependency(value: unknown): value is { id: string; sha256: string; bytes: number } {
  if (!value || typeof value !== "object") return false; const v = value as Record<string, unknown>;
  return own(v, ["id", "sha256", "bytes"]) && typeof v.id === "string" && v.id.length > 0 && /^[a-f0-9]{64}$/u.test(String(v.sha256)) && Number.isSafeInteger(v.bytes) && Number(v.bytes) >= 0;
}
function mapping(value: unknown): value is CopyMapping {
  if (!value || typeof value !== "object") return false; const v = value as Record<string, unknown>;
  const numbers = [v.outputStart, v.outputEnd, v.sourceStart, v.sourceEnd];
  return own(v, ["outputStart", "outputEnd", "sourcePath", "sourceStart", "sourceEnd", "sourceId", "authorId"]) &&
    numbers.every((item) => Number.isSafeInteger(item) && Number(item) >= 0) && Number(v.outputStart) <= Number(v.outputEnd) && Number(v.sourceStart) <= Number(v.sourceEnd) &&
    typeof v.sourcePath === "string" && isSafeRelativePath(v.sourcePath) && typeof v.sourceId === "string" && v.sourceId.length > 0 &&
    (v.authorId === undefined || typeof v.authorId === "string");
}
/** Rejects unknown fields and unrecognised mapping methods before any project path is opened. */
export function parseDeclaredManifest(bytes: Buffer): SourceManifestV1 {
  if (bytes.length > MAX_MANIFEST_BYTES) throw new Error("source manifest exceeds byte limit");
  const text = decodeUtf8Strict(bytes, "source manifest");
  let raw: unknown; try { raw = JSON.parse(text); } catch { throw new Error("source manifest is not JSON"); }
  if (!raw || typeof raw !== "object") throw new Error("source manifest is not an object");
  const value = raw as Record<string, unknown>;
  if (!own(value, ["schemaVersion", "projectId", "documentId", "producer", "inputs", "output", "mappings", "revision", "delivery"]) || value.schemaVersion !== 1 ||
    typeof value.projectId !== "string" || !value.projectId || typeof value.documentId !== "string" || !value.documentId || !Array.isArray(value.inputs) ||
    !value.inputs.every(file) || !file(value.output) || !Array.isArray(value.mappings) || !value.mappings.every(mapping) || value.inputs.length > MAX_FILES || value.mappings.length > MAX_MAPPINGS) {
    throw new Error("source manifest violates schema v1");
  }
  const producer = value.producer as Record<string, unknown> | null;
  if (!producer || typeof producer !== "object" || !own(producer, ["id", "version", "dependencies"]) || typeof producer.id !== "string" || typeof producer.version !== "string" || !Array.isArray(producer.dependencies) || !producer.dependencies.every(dependency)) {
    throw new Error("source manifest producer violates schema v1");
  }
  if (value.revision !== undefined && (typeof value.revision !== "string" || value.revision.length === 0)) throw new Error("source manifest revision violates schema v1");
  if (value.delivery !== undefined && !file(value.delivery)) throw new Error("source manifest delivery violates schema v1");
  const paths = [...value.inputs.map((input) => input.path), value.output.path, ...(value.delivery ? [value.delivery.path] : [])];
  if (new Set(paths).size !== paths.length) throw new Error("source manifest has duplicate file paths");
  if (new Set(producer.dependencies.map((entry) => entry.id)).size !== producer.dependencies.length) throw new Error("source manifest has duplicate producer dependency ids");
  return value as unknown as SourceManifestV1;
}
function safeRead(root: string, path: string): Buffer {
  if (!isSafeRelativePath(path)) throw new Error(`unsafe source path: ${path}`);
  return captureBoundedSourceFile(root, path, MAX_SOURCE_BYTES, "declared source");
}
/** Validates exactly the copy predicate. Success deliberately says declared, never producer-bound. */
export function verifyDeclaredManifest(root: string, manifestBytes: Buffer): DeclaredProvenanceResult {
  try {
    const manifest = parseDeclaredManifest(manifestBytes);
    const all = [...manifest.inputs, manifest.output];
    if (new Set(all.map((item) => item.path)).size !== all.length) throw new Error("duplicate declared file path");
    const snapshots = new Map<string, Buffer>(); let total = 0;
    for (const declared of all) {
      const bytes = safeRead(root, declared.path);
      total += bytes.length;
      if (total > MAX_SOURCE_BYTES || bytes.length !== declared.bytes || hash(bytes) !== declared.sha256) throw new Error(`declared bytes mismatch: ${declared.path}`);
      snapshots.set(declared.path, bytes);
    }
    const output = snapshots.get(manifest.output.path)!;
    for (const edge of manifest.mappings) {
      const source = snapshots.get(edge.sourcePath);
      if (!source || edge.outputEnd > output.length || edge.sourceEnd > source.length || edge.outputEnd - edge.outputStart !== edge.sourceEnd - edge.sourceStart ||
        !source.subarray(edge.sourceStart, edge.sourceEnd).equals(output.subarray(edge.outputStart, edge.outputEnd))) throw new Error(`copy predicate failed: ${edge.sourceId}`);
    }
    return { ok: true, binding: "declared", copyIntegrity: "verified", diagnostics: [] };
  } catch (error) {
    return { ok: false, binding: "unavailable", copyIntegrity: "unavailable", diagnostics: [error instanceof Error ? error.message : String(error)] };
  }
}
