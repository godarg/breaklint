/** Host build receipt verification for the screen adapter's optional source binding. */

import { captureBoundedSourceFile, sha256Bytes } from "../source/bytes.ts";
import { sha } from "./raw-sample.ts";
import type { HostBuildContainerBinding } from "./types.ts";

const MAX_RECEIPT_BYTES = 1_000_000;
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;
const MAX_SOURCE_TOTAL = 250 * 1024 * 1024;
const MAX_OUTPUT_FILES = 10_000;
const MAX_OUTPUT_TOTAL = 512 * 1024 * 1024;

export type Binding = { status: "verified-container-only" | "declared" | "unknown"; files: Set<string>; containerFiles: Map<number, string>; detail: string | null };

function sourcePath(path: string): boolean {
  return !!path && !path.includes("\\") && !path.includes("\0") && !path.startsWith("/") && path.split("/").every((part) => part && part !== "." && part !== ".." && part !== "__proto__" && part !== "constructor" && part !== "prototype");
}
function canonicalFiles(files: Record<string, { sha256: string; byteLength: number; role: string }>): string {
  return JSON.stringify(Object.entries(files).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([file, entry]) => [file, entry.sha256, entry.byteLength, entry.role]));
}
function receiptFiles(value: unknown, allowedRoles: readonly string[], label: string, maxFiles: number, maxTotal: number): Record<string, { sha256: string; byteLength: number; role: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} files are invalid`);
  const entries = Object.entries(value as Record<string, unknown>); if (entries.length === 0 || entries.length > maxFiles) throw new Error(`${label} file inventory is invalid`);
  const normalized: Record<string, { sha256: string; byteLength: number; role: string }> = Object.create(null); let total = 0;
  for (const [file, candidate] of entries) {
    if (!sourcePath(file) || !candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error(`${label} file path is invalid`);
    const entry = candidate as Record<string, unknown>; const byteLength = entry.byteLength;
    if (Object.keys(entry).some((key) => !["sha256", "byteLength", "role"].includes(key)) || typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(entry.sha256) || typeof byteLength !== "number" || !Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > MAX_SOURCE_BYTES || !allowedRoles.includes(String(entry.role))) throw new Error(`invalid ${label} file entry`);
    total += byteLength; if (total > maxTotal) throw new Error(`${label} byte budget exceeded`);
    normalized[file] = { sha256: entry.sha256, byteLength, role: String(entry.role) };
  }
  if (Object.keys(normalized).length === 0) throw new Error(`${label} file inventory is invalid`);
  return normalized;
}

/** Re-reads every inventoried output file and compares its bytes with the receipt entry. */
function verifyOutputFiles(root: string, files: Record<string, { sha256: string; byteLength: number; role: string }>): void {
  for (const [file, entry] of Object.entries(files)) {
    const bytes = captureBoundedSourceFile(root, file, MAX_SOURCE_BYTES, "screen build output");
    if (bytes.length !== entry.byteLength || sha256Bytes(bytes) !== entry.sha256) throw new Error(`build output mismatch: ${file}`);
  }
}

/**
 * Verifies compiled output receipts in either schemaVersion 1 (Next.js `.next/BUILD_ID`) or
 * schemaVersion 2 (framework-agnostic output directory manifest with optional `buildMarkerPath`).
 * Returns the verified output build id (`nextBuildId` or `buildId`).
 */
export function verifyOutputReceipt(input: HostBuildContainerBinding, sourceBuildId: string): string {
  if (!input.buildOutputReceiptPath) throw new Error("build output receipt path is required for verified host binding");
  if (!sourcePath(input.buildOutputReceiptPath)) throw new Error("unsafe build output receipt path");
  const raw = captureBoundedSourceFile(input.root, input.buildOutputReceiptPath, MAX_RECEIPT_BYTES, "screen build output receipt");
  const receipt: unknown = JSON.parse(raw.toString("utf8"));
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) throw new Error("build output receipt is not an object");
  const value = receipt as Record<string, unknown>;

  if (value.schemaVersion === 1) {
    if (Object.keys(value).some((key) => !["schemaVersion", "sourceBuildId", "nextBuildId", "files", "filesSha256"].includes(key)) || value.sourceBuildId !== sourceBuildId || typeof value.nextBuildId !== "string" || !/^[A-Za-z0-9_-]{1,256}$/u.test(value.nextBuildId) || typeof value.filesSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(value.filesSha256)) throw new Error("invalid build output receipt schema");
    const files = receiptFiles(value.files, ["build-output"], "build output receipt", MAX_OUTPUT_FILES, MAX_OUTPUT_TOTAL);
    if (!Object.hasOwn(files, ".next/BUILD_ID") || sha(canonicalFiles(files)) !== value.filesSha256) throw new Error("invalid build output receipt inventory");
    if (captureBoundedSourceFile(input.root, ".next/BUILD_ID", 512, "screen compiled build id").toString("utf8").trim() !== value.nextBuildId) throw new Error("compiled BUILD_ID does not match output receipt");
    verifyOutputFiles(input.root, files);
    return value.nextBuildId;
  }

  if (value.schemaVersion === 2) {
    if (Object.keys(value).some((key) => !["schemaVersion", "sourceBuildId", "buildId", "buildMarkerPath", "files", "filesSha256"].includes(key)) || value.sourceBuildId !== sourceBuildId || typeof value.buildId !== "string" || !/^[A-Za-z0-9_.:-]{1,256}$/u.test(value.buildId) || typeof value.filesSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(value.filesSha256)) throw new Error("invalid build output receipt schema");
    const files = receiptFiles(value.files, ["build-output"], "build output receipt", MAX_OUTPUT_FILES, MAX_OUTPUT_TOTAL);
    if (sha(canonicalFiles(files)) !== value.filesSha256) throw new Error("invalid build output receipt inventory");
    if (value.buildMarkerPath !== undefined) {
      if (typeof value.buildMarkerPath !== "string" || !sourcePath(value.buildMarkerPath) || !Object.hasOwn(files, value.buildMarkerPath)) {
        throw new Error("invalid build marker path in output receipt");
      }
      if (captureBoundedSourceFile(input.root, value.buildMarkerPath, 512, "screen compiled build marker").toString("utf8").trim() !== value.buildId) {
        throw new Error("compiled build marker does not match output receipt");
      }
    } else if (value.buildId !== value.filesSha256) {
      throw new Error("generic output receipt buildId must equal filesSha256 when buildMarkerPath is omitted");
    }
    verifyOutputFiles(input.root, files);
    return value.buildId;
  }

  throw new Error("invalid build output receipt schema");
}

/**
 * Verifies the host's source receipt, its output receipt, the rendered source build id and the
 * rendered output build id; never throws.
 */
export function verifyBinding(input: HostBuildContainerBinding | undefined, domBuildId: string | null, domOutputId: string | null): Binding {
  if (!input) return { status: "unknown", files: new Set(), containerFiles: new Map(), detail: null };
  try {
    if (!sourcePath(input.receiptPath)) throw new Error("unsafe receipt path");
    const raw = captureBoundedSourceFile(input.root, input.receiptPath, MAX_RECEIPT_BYTES, "screen build receipt");
    const receipt: unknown = JSON.parse(raw.toString("utf8"));
    if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) throw new Error("receipt is not an object");
    const value = receipt as Record<string, unknown>;
    if (Object.keys(value).some((key) => !["schemaVersion", "buildId", "files", "filesSha256"].includes(key)) || value.schemaVersion !== 1 || typeof value.buildId !== "string" || !/^[a-f0-9]{64}$/u.test(value.buildId) || typeof value.filesSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(value.filesSha256) || !value.files || typeof value.files !== "object" || Array.isArray(value.files)) throw new Error("invalid receipt schema");
    if (value.buildId !== value.filesSha256) throw new Error("receipt build id must equal file inventory digest");
    if (domBuildId !== value.buildId) throw new Error("compiled build id does not match receipt");
    const normalized = receiptFiles(value.files, ["source", "config", "lock"], "receipt", 2_000, MAX_SOURCE_TOTAL);
    for (const [file, entry] of Object.entries(normalized)) {
      const bytes = captureBoundedSourceFile(input.root, file, MAX_SOURCE_BYTES, "screen build source");
      if (bytes.length !== entry.byteLength || sha256Bytes(bytes) !== entry.sha256) throw new Error(`receipt source mismatch: ${file}`);
    }
    if (sha(canonicalFiles(normalized)) !== value.filesSha256) throw new Error("receipt inventory digest mismatch");
    const outputId = verifyOutputReceipt(input, value.buildId);
    // The output receipt describes files on disk; only the output id the page renders shows that
    // this page is that output (two builds of the same sources share the source id).
    if (input.compiledOutputAttribute === undefined) throw new Error("no rendered output id (sourceBinding.compiledOutputAttribute) ties the output receipt to the page");
    if (domOutputId !== outputId) throw new Error("rendered output id does not match the output receipt");
    for (const container of input.containers) if (!Object.hasOwn(normalized, container.file)) throw new Error(`container file absent from receipt: ${container.file}`);
    return { status: "verified-container-only", files: new Set(Object.keys(normalized)), containerFiles: new Map(input.containers.map((container, index) => [index, container.file])), detail: null };
  } catch (error) { return { status: "declared", files: new Set(), containerFiles: new Map(), detail: error instanceof Error ? error.message : String(error) }; }
}
