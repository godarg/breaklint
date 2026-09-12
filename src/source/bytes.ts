/** Raw-byte source helpers. Source positions are never JavaScript UTF-16 string offsets. */

import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

export class StrictUtf8Error extends Error {
  constructor(message: string) { super(message); this.name = "StrictUtf8Error"; }
}

/** Decodes without replacement characters. A replacement character authored in UTF-8 remains valid. */
export function decodeUtf8Strict(bytes: Buffer, label = "input"): string {
  try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new StrictUtf8Error(`${label} is not valid UTF-8`); }
}

export function sha256Bytes(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }

function protectedComponent(component: string): boolean {
  const value = component.toLowerCase();
  return value === ".git" || value === ".ssh" || value === "secrets" || value === ".env" || value.startsWith(".env.");
}
type StableStat = { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint; file: boolean };
function stableStat(path: string): StableStat {
  const stat = lstatSync(path, { bigint: true });
  if (stat.isSymbolicLink()) throw new Error(`symlink is not an accepted source path: ${path}`);
  return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeNs: stat.mtimeNs, ctimeNs: stat.ctimeNs, file: stat.isFile() };
}
function sameStable(a: StableStat, b: StableStat): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.file === b.file;
}

/**
 * Capture one bounded regular file beneath an explicit trusted root without following any leaf
 * or component symlink. The returned buffer is the only byte source callers may hash, parse,
 * collide against, or serve. It never reopens the pathname after capture.
 */
export function captureBoundedSourceFile(root: string, relativePath: string, maxBytes: number, label = "source"): Buffer {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error(`invalid ${label} byte limit`);
  if (!relativePath || relativePath.includes("\\") || relativePath.includes("\0") || relativePath.startsWith("/") ||
    relativePath.split("/").some((part) => !part || part === "." || part === ".." || protectedComponent(part))) {
    throw new Error(`unsafe ${label} relative path: ${relativePath}`);
  }
  const rootPath = resolve(root);
  if (rootPath.split(sep).some((part) => protectedComponent(part))) {
    throw new Error(`unsafe ${label} root path`);
  }
  const rootBefore = stableStat(rootPath);
  if (rootBefore.file) throw new Error(`${label} root is not a directory`);
  const rootReal = realpathSync(rootPath);
  const components: { path: string; stat: StableStat }[] = [];
  let current = rootReal;
  for (const part of relativePath.split("/")) {
    current = resolve(current, part);
    const rel = relative(rootReal, current);
    if (rel === "" || rel.startsWith("..") || rel.includes(`..${sep}`)) throw new Error(`${label} path escapes root`);
    const stat = stableStat(current);
    components.push({ path: current, stat });
  }
  const leaf = components.at(-1)!;
  if (!leaf.stat.file || leaf.stat.size > BigInt(maxBytes)) throw new Error(`${label} is not a bounded regular file: ${relativePath}`);
  const fd = openSync(leaf.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const beforeFd = fstatSync(fd, { bigint: true });
    if (!beforeFd.isFile() || beforeFd.dev !== leaf.stat.dev || beforeFd.ino !== leaf.stat.ino || beforeFd.size !== leaf.stat.size || beforeFd.ctimeNs !== leaf.stat.ctimeNs || beforeFd.mtimeNs !== leaf.stat.mtimeNs) {
      throw new Error(`${label} changed before capture: ${relativePath}`);
    }
    const cap = Number(beforeFd.size) + 1;
    const buffer = Buffer.allocUnsafe(cap);
    let offset = 0;
    while (offset < cap) {
      const count = readSync(fd, buffer, offset, cap - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    if (offset > maxBytes) throw new Error(`${label} exceeds byte limit while captured: ${relativePath}`);
    const afterFd = fstatSync(fd, { bigint: true });
    const afterLeaf = stableStat(leaf.path);
    const rootAfter = stableStat(rootPath);
    if (afterFd.dev !== beforeFd.dev || afterFd.ino !== beforeFd.ino || afterFd.size !== beforeFd.size || afterFd.ctimeNs !== beforeFd.ctimeNs || afterFd.mtimeNs !== beforeFd.mtimeNs || !sameStable(leaf.stat, afterLeaf) || !sameStable(rootBefore, rootAfter)) {
      throw new Error(`${label} changed while captured: ${relativePath}`);
    }
    for (const component of components.slice(0, -1)) if (!sameStable(component.stat, stableStat(component.path))) throw new Error(`${label} component changed while captured: ${relativePath}`);
    return Buffer.from(buffer.subarray(0, offset));
  } finally { closeSync(fd); }
}

/** Converts a parse5 UTF-16 text offset into the matching raw UTF-8 byte offset. */
export function utf16OffsetToUtf8Byte(text: string, utf16Offset: number): number {
  if (!Number.isSafeInteger(utf16Offset) || utf16Offset < 0 || utf16Offset > text.length) throw new RangeError("invalid UTF-16 offset");
  if (utf16Offset > 0 && utf16Offset < text.length && /[\uD800-\uDBFF]/u.test(text[utf16Offset - 1]!) && /[\uDC00-\uDFFF]/u.test(text[utf16Offset]!)) {
    throw new RangeError("UTF-16 offset splits a surrogate pair");
  }
  return Buffer.byteLength(text.slice(0, utf16Offset), "utf8");
}

export interface SourceCoordinate {
  byteOffset: number;
  line: number;
  column: number;
}

/** 1-based Unicode-codepoint positions. CRLF is a single newline and a UTF-8 BOM is a codepoint. */
export function coordinateAtUtf8Byte(text: string, byteOffset: number): SourceCoordinate {
  if (!Number.isSafeInteger(byteOffset) || byteOffset < 0 || byteOffset > Buffer.byteLength(text, "utf8")) throw new RangeError("invalid byte offset");
  let seen = 0; let line = 1; let column = 1; let previousWasCr = false;
  for (const codePoint of text) {
    if (seen === byteOffset) return { byteOffset, line, column };
    const length = Buffer.byteLength(codePoint, "utf8");
    if (seen + length > byteOffset) throw new RangeError("byte offset splits a UTF-8 codepoint");
    seen += length;
    if (codePoint === "\n") {
      if (!previousWasCr) { line += 1; column = 1; }
      previousWasCr = false;
    } else if (codePoint === "\r") { line += 1; column = 1; previousWasCr = true; }
    else { column += 1; previousWasCr = false; }
  }
  if (seen !== byteOffset) throw new RangeError("byte offset is outside text");
  return { byteOffset, line, column };
}
