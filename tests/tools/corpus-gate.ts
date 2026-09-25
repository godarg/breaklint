/**
 * The closed-world gate over `corpus/public/selfauthored-v1`.
 *
 * The corpus README ("How a gate consumes this", "Targets", "Declines") is the only procedure;
 * this file turns it into code and adds nothing to it except integrity checks that make a run
 * fail rather than pass on a broken harness. Every rule it applies is cited by the README
 * section it comes from.
 *
 * What makes this an oracle and not a mirror of the tool under test:
 *
 * - The truth (`expected/*.json`) is frozen with the documents and bound by SHA-256 in
 *   `manifest.json`. The gate never writes to the corpus and never reads a breaklint report
 *   before it has verified every byte it will judge the report against.
 * - Element spans are computed here, with parse5 over the source bytes, in UTF-8 bytes. Nothing
 *   from `src/measure/**` or `src/source/**` is imported: an oracle that borrowed the tool's own
 *   source map would agree with the tool by construction. Only report TYPES are imported.
 * - breaklint runs the way a consumer runs it: the built CLI, one document per invocation, the
 *   default profile, the canonical JSON report.
 *
 * Fail closed: zero documents, a hash or length mismatch, an unknown field in an expected file,
 * a malformed target, a missing report, a finding no entry accounts for and a required decline
 * count that differs are all failures. The process exits 0 only when every document passed.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import type { DocumentReport, Finding, NotMeasured, Report } from "../../src/core/types.ts";

type Element = DefaultTreeAdapterMap["element"];
type ParentNode = DefaultTreeAdapterMap["parentNode"];

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const DEFAULT_CORPUS = join(ROOT, "corpus/public/selfauthored-v1");

/**
 * Literal on purpose, as in the real-document gate: a report stamp change must be noticed here
 * rather than followed. Source of truth: REPORT_SCHEMA_VERSION in src/core/enums.ts.
 */
export const ACCEPTED_REPORT_SCHEMA_VERSION = 5;

export class GateError extends Error {}

function fail(message: string): never {
  throw new GateError(message);
}

// ---------------------------------------------------------------------------------------------
// Step 1: manifest and bytes.

export interface ManifestDocument {
  id: string;
  htmlPath: string;
  expectedPath: string;
  sha256: string;
  byteLength: number;
  expectedSha256: string;
  pagesRange: [number, number];
  expectedExit: number[];
}

export interface VerifiedManifest {
  root: string;
  manifestId: string;
  documents: ManifestDocument[];
  filesVerified: number;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function insideRoot(root: string, relativePath: unknown, label: string): string {
  if (typeof relativePath !== "string" || relativePath.length === 0) fail(`${label}: path is missing`);
  const absolute = resolve(root, relativePath);
  const rel = relative(root, absolute);
  if (rel.startsWith("..") || rel.split(sep).includes("..") || resolve(root, rel) !== absolute) {
    fail(`${label}: path ${relativePath} leaves the corpus directory`);
  }
  return absolute;
}

/**
 * README step 1: "Read `manifest.json` and verify the SHA-256 and byte length of every file in
 * `files`. Zero documents read is a failure, never a skip."
 *
 * Also closed over the two directories the gate judges: a document or expected file on disk that
 * the manifest does not bind is a failure, so a file cannot be added beside the manifest and
 * silently ignored.
 */
export function verifyManifest(corpusRoot: string): VerifiedManifest {
  const root = resolve(corpusRoot);
  const manifestPath = join(root, "manifest.json");
  if (!existsSync(manifestPath)) fail(`manifest.json not found in ${root}`);
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail(`manifest.json is not JSON: ${(error as Error).message}`);
  }
  if (!isObject(manifest)) fail("manifest.json is not an object");
  if (manifest.contractVersion !== "selfauthored-corpus-v1") fail(`manifest contractVersion is ${String(manifest.contractVersion)}, expected selfauthored-corpus-v1`);
  if (manifest.calibrationEvidenceEligible !== false) fail("manifest must declare calibrationEvidenceEligible: false");
  if (manifest.profile !== "default") fail(`manifest profile is ${String(manifest.profile)}, the gate is defined for the default profile`);
  const files = manifest.files;
  if (!Array.isArray(files) || files.length === 0) fail("manifest lists no files; zero files verified is a failure");
  const verified = new Map<string, string>();
  for (const [index, entry] of files.entries()) {
    if (!isObject(entry)) fail(`manifest files[${index}] is not an object`);
    const path = insideRoot(root, entry.path, `manifest files[${index}]`);
    if (verified.has(path)) fail(`manifest files lists ${String(entry.path)} twice`);
    if (!existsSync(path) || !statSync(path).isFile()) fail(`${String(entry.path)}: listed in the manifest but missing`);
    const bytes = readFileSync(path);
    if (bytes.length !== entry.byteLength) fail(`${String(entry.path)}: byte length ${bytes.length}, manifest says ${String(entry.byteLength)}`);
    const digest = sha256(bytes);
    if (digest !== entry.sha256) fail(`${String(entry.path)}: SHA-256 ${digest}, manifest says ${String(entry.sha256)}`);
    verified.set(path, digest);
  }

  const documentsRaw = manifest.documents;
  if (!Array.isArray(documentsRaw) || documentsRaw.length === 0) fail("manifest lists zero documents; zero documents read is a failure, never a skip");
  if (manifest.documentCount !== documentsRaw.length) fail(`manifest documentCount ${String(manifest.documentCount)} differs from ${documentsRaw.length} listed documents`);
  const documents: ManifestDocument[] = [];
  const ids = new Set<string>();
  for (const [index, raw] of documentsRaw.entries()) {
    if (!isObject(raw) || !isObject(raw.artifact) || !isObject(raw.expected)) fail(`manifest documents[${index}] is malformed`);
    const id = raw.id;
    if (typeof id !== "string" || !/^[a-z0-9-]+$/u.test(id)) fail(`manifest documents[${index}] has no valid id`);
    if (ids.has(id)) fail(`manifest lists document ${id} twice`);
    ids.add(id);
    const htmlPath = insideRoot(root, raw.artifact.relativePath, `${id} artifact`);
    const expectedPath = insideRoot(root, raw.expected.relativePath, `${id} expected`);
    const htmlDigest = verified.get(htmlPath);
    const expectedDigest = verified.get(expectedPath);
    if (htmlDigest === undefined) fail(`${id}: its document is not bound by manifest files`);
    if (expectedDigest === undefined) fail(`${id}: its expected file is not bound by manifest files`);
    if (raw.artifact.sha256 !== htmlDigest) fail(`${id}: documents[].artifact.sha256 differs from the verified bytes`);
    if (raw.artifact.byteLength !== readFileSync(htmlPath).length) fail(`${id}: documents[].artifact.byteLength differs from the verified bytes`);
    if (raw.expected.sha256 !== expectedDigest) fail(`${id}: documents[].expected.sha256 differs from the verified bytes`);
    if (raw.expected.schemaVersion !== "selfauthored-expected-v1") fail(`${id}: expected schemaVersion ${String(raw.expected.schemaVersion)} is not selfauthored-expected-v1`);
    const pagesRange = raw.pagesRange;
    const expectedExit = raw.expectedExit;
    if (!Array.isArray(pagesRange) || pagesRange.length !== 2 || !pagesRange.every(Number.isInteger)) fail(`${id}: manifest pagesRange is malformed`);
    if (!Array.isArray(expectedExit) || expectedExit.length === 0 || !expectedExit.every(Number.isInteger)) fail(`${id}: manifest expectedExit is malformed`);
    documents.push({
      id,
      htmlPath,
      expectedPath,
      sha256: htmlDigest,
      byteLength: raw.artifact.byteLength as number,
      expectedSha256: expectedDigest,
      pagesRange: [pagesRange[0] as number, pagesRange[1] as number],
      expectedExit: expectedExit as number[],
    });
  }

  for (const directory of ["documents", "expected"]) {
    const absolute = join(root, directory);
    if (!existsSync(absolute)) fail(`${directory}/ is missing`);
    for (const name of readdirSync(absolute)) {
      if (!verified.has(join(absolute, name))) fail(`${directory}/${name} is on disk but not bound by the manifest`);
    }
  }
  if (typeof manifest.manifestId !== "string") fail("manifest has no manifestId");
  return { root, manifestId: manifest.manifestId, documents, filesVerified: verified.size };
}

// ---------------------------------------------------------------------------------------------
// Source index: element spans in UTF-8 bytes, computed here with parse5.

export interface SourceElement {
  node: Element;
  tag: string;
  namespace: string;
  id: string | null;
  parent: SourceElement | null;
  /** UTF-8 byte offsets; `start` is the `<` of the start tag, `end` the end of the element. */
  start: number;
  end: number;
}

export interface SourceIndex {
  elements: SourceElement[];
  byId: Map<string, SourceElement[]>;
  byNode: Map<Element, SourceElement>;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const HTML_NS = "http://www.w3.org/1999/xhtml";

/** Code-unit index -> UTF-8 byte offset, for every index that starts a code point. */
function utf8OffsetTable(text: string): Int32Array {
  const table = new Int32Array(text.length + 1).fill(-1);
  let bytes = 0;
  for (let i = 0; i < text.length;) {
    table[i] = bytes;
    const cp = text.codePointAt(i)!;
    const units = cp > 0xffff ? 2 : 1;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    i += units;
  }
  table[text.length] = bytes;
  return table;
}

/**
 * README "Source spans": "The span of an element is its HTML5 tree-construction element range in
 * the source document, from the `<` of its start tag to the end of its end tag (where tree
 * construction closes an element whose end tag is omitted, it ends there), counted in UTF-8
 * bytes." parse5's element location is exactly that range in string code units; it is converted
 * to bytes here. An element the parser created without a start tag has no span and cannot be a
 * target.
 */
export function indexSource(bytes: Buffer): SourceIndex {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    fail("source starts with a byte-order mark; the gate's byte coordinates are not defined for it");
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("source is not valid UTF-8");
  }
  const table = utf8OffsetTable(text);
  if (table[text.length] !== bytes.length) fail("UTF-8 offset table does not cover the source bytes");
  const toBytes = (index: number | undefined): number => {
    if (index === undefined || index < 0 || index > text.length || table[index] === -1) return -1;
    return table[index]!;
  };
  const document = parse(text, { sourceCodeLocationInfo: true });
  const elements: SourceElement[] = [];
  const byId = new Map<string, SourceElement[]>();
  const byNode = new Map<Element, SourceElement>();
  const walk = (node: ParentNode, parent: SourceElement | null): void => {
    for (const child of node.childNodes) {
      if (!("tagName" in child)) continue;
      const element = child as Element;
      const location = element.sourceCodeLocation;
      const id = element.attrs.find((attr) => attr.name === "id" && !attr.prefix)?.value ?? null;
      let record: SourceElement | null = null;
      if (location && location.startTag) {
        const start = toBytes(location.startOffset);
        const end = toBytes(location.endOffset);
        record = { node: element, tag: element.tagName, namespace: element.namespaceURI, id, parent, start, end };
      } else {
        record = { node: element, tag: element.tagName, namespace: element.namespaceURI, id, parent, start: -1, end: -1 };
      }
      elements.push(record);
      byNode.set(element, record);
      if (id !== null) byId.set(id, [...(byId.get(id) ?? []), record]);
      walk(element, record);
      const content = (element as { content?: ParentNode }).content;
      if (content) walk(content, record);
    }
  };
  walk(document, null);
  return { elements, byId, byNode };
}

function spanOf(element: SourceElement, label: string): { start: number; end: number } {
  if (element.start < 0 || element.end < 0 || element.end < element.start) fail(`${label}: the element has no complete source span`);
  return { start: element.start, end: element.end };
}

function elementById(index: SourceIndex, id: unknown, label: string): SourceElement {
  if (typeof id !== "string" || id.length === 0) fail(`${label}: id must be a non-empty string`);
  const found = index.byId.get(id);
  if (!found || found.length === 0) fail(`${label}: no element with id "${id}" in the source document`);
  if (found.length > 1) fail(`${label}: id "${id}" occurs ${found.length} times in the source document`);
  return found[0]!;
}

function nearestSvg(element: SourceElement): SourceElement | null {
  for (let current = element.parent; current; current = current.parent) {
    if (current.tag === "svg" && current.namespace === SVG_NS) return current;
  }
  return null;
}

function isDescendant(element: SourceElement, ancestor: SourceElement): boolean {
  for (let current = element.parent; current; current = current.parent) if (current === ancestor) return true;
  return false;
}

// A deliberately small CSS selector matcher: type, `*`, `#id`, `.class`, `:not(<compound>)`,
// the descendant combinator and selector lists. Anything else is refused rather than guessed.

interface Compound {
  tag: string | null;
  ids: string[];
  classes: string[];
  not: Compound[];
}

function parseCompound(source: string, selector: string): Compound {
  const compound: Compound = { tag: null, ids: [], classes: [], not: [] };
  let rest = source;
  const tag = /^(\*|[a-zA-Z][a-zA-Z0-9-]*)/u.exec(rest);
  if (tag) {
    compound.tag = tag[1] === "*" ? null : tag[1]!;
    rest = rest.slice(tag[0].length);
  }
  while (rest.length > 0) {
    let match = /^#([A-Za-z0-9_-]+)/u.exec(rest);
    if (match) { compound.ids.push(match[1]!); rest = rest.slice(match[0].length); continue; }
    match = /^\.([A-Za-z0-9_-]+)/u.exec(rest);
    if (match) { compound.classes.push(match[1]!); rest = rest.slice(match[0].length); continue; }
    match = /^:not\(([^()]*)\)/u.exec(rest);
    if (match) {
      const inner = match[1]!.trim();
      if (!inner || /\s|,/u.test(inner)) fail(`selector "${selector}": :not() takes one compound selector here`);
      compound.not.push(parseCompound(inner, selector));
      rest = rest.slice(match[0].length);
      continue;
    }
    fail(`selector "${selector}": unsupported syntax at "${rest}"`);
  }
  if (!tag && compound.ids.length === 0 && compound.classes.length === 0 && compound.not.length === 0) fail(`selector "${selector}": empty compound`);
  return compound;
}

function parseSelectorList(selector: string): Compound[][] {
  if (typeof selector !== "string" || selector.trim() === "") fail("selector must be a non-empty string");
  if (/[>+~[\]]|::/u.test(selector)) fail(`selector "${selector}": only descendant combinators and simple selectors are supported`);
  return selector.split(",").map((part) => {
    const compounds = part.trim().split(/\s+/u);
    if (compounds.length === 0 || compounds[0] === "") fail(`selector "${selector}": empty selector in list`);
    return compounds.map((compound) => parseCompound(compound, selector));
  });
}

function compoundMatches(element: SourceElement, compound: Compound): boolean {
  if (compound.tag !== null) {
    const same = element.namespace === HTML_NS ? element.tag.toLowerCase() === compound.tag.toLowerCase() : element.tag === compound.tag;
    if (!same) return false;
  }
  for (const id of compound.ids) if (element.id !== id) return false;
  if (compound.classes.length) {
    const classes = new Set((element.node.attrs.find((attr) => attr.name === "class" && !attr.prefix)?.value ?? "").split(/\s+/u).filter(Boolean));
    for (const name of compound.classes) if (!classes.has(name)) return false;
  }
  for (const negated of compound.not) if (compoundMatches(element, negated)) return false;
  return true;
}

function complexMatches(element: SourceElement, compounds: Compound[]): boolean {
  if (!compoundMatches(element, compounds[compounds.length - 1]!)) return false;
  let position = compounds.length - 2;
  for (let current = element.parent; current && position >= 0; current = current.parent) {
    if (compoundMatches(current, compounds[position]!)) position -= 1;
  }
  return position < 0;
}

export function selectElements(index: SourceIndex, selector: string): SourceElement[] {
  const list = parseSelectorList(selector);
  return index.elements.filter((element) => list.some((complex) => complexMatches(element, complex)));
}

// ---------------------------------------------------------------------------------------------
// Expected files: the README's closed field list, then compiled targets.

/**
 * README "Field list" (E38), encoded level by level. N is a key the gate interprets; I is a key
 * it checks for presence and type only; `opaque` values are never looked into. The list is
 * closed: a key it does not name fails the file at every level it describes.
 *
 * It is encoded rather than parsed from the README because the README states types in prose.
 * tests/unit/corpus-gate.test.ts parses the README section and fails when its key names, roles,
 * optional and opaque markers, entry lists, `perText`, target shapes, `uri`, `pageOf` and `except`
 * diverge from this encoding.
 */
export type FieldType =
  | { kind: "string" }
  | { kind: "stringOrNull" }
  | { kind: "boolean" }
  | { kind: "integer" }
  | { kind: "number" }
  | { kind: "literal"; value: string | boolean }
  | { kind: "opaque" }
  | { kind: "array"; of: FieldType }
  | { kind: "map"; of: FieldType; keys?: RegExp }
  | { kind: "object"; fields: Record<string, Field> }
  /** A list of rule entries; each item is checked against `ENTRY_FIELDS[list]`. */
  | { kind: "entries"; list: ListName }
  /** A target; its shape is checked by `compileTarget` against `TARGET_SHAPES`. */
  | { kind: "target" };

export interface Field {
  role: "N" | "I";
  required: boolean;
  type: FieldType;
}

type ListName = "mustFire" | "mustNotFire" | "allowed" | "expectedDeclines";
const LISTS: ListName[] = ["mustFire", "mustNotFire", "allowed", "expectedDeclines"];

const T = {
  string: { kind: "string" } as FieldType,
  stringOrNull: { kind: "stringOrNull" } as FieldType,
  boolean: { kind: "boolean" } as FieldType,
  integer: { kind: "integer" } as FieldType,
  number: { kind: "number" } as FieldType,
  opaque: { kind: "opaque" } as FieldType,
  target: { kind: "target" } as FieldType,
  literal: (value: string | boolean): FieldType => ({ kind: "literal", value }),
  array: (of: FieldType): FieldType => ({ kind: "array", of }),
  map: (of: FieldType, keys?: RegExp): FieldType => (keys ? { kind: "map", of, keys } : { kind: "map", of }),
  object: (fields: Record<string, Field>): FieldType => ({ kind: "object", fields }),
  entries: (list: ListName): FieldType => ({ kind: "entries", list }),
};
const N = (type: FieldType, required = true): Field => ({ role: "N", required, type });
const I = (type: FieldType, required = true): Field => ({ role: "I", required, type });

export const RULE_FIELDS: Record<string, Field> = {
  mustFire: N(T.entries("mustFire")),
  mustNotFire: N(T.entries("mustNotFire")),
  allowed: N(T.entries("allowed")),
  expectedDeclines: N(T.entries("expectedDeclines")),
  notes: I(T.array(T.string), false),
};

export const FIELD_LIST: Record<string, Field> = {
  schemaVersion: N(T.literal("selfauthored-expected-v1")),
  documentId: N(T.string),
  artifact: N(T.string),
  sha256: N(T.string),
  byteLength: N(T.integer),
  authoredOn: I(T.string),
  provenanceClass: I(T.literal("synthetic_first_party")),
  calibrationEvidenceEligible: I(T.literal(false)),
  title: I(T.string),
  genre: I(T.string),
  fontDependence: I(T.string),
  language: I(T.object({ htmlLang: I(T.stringOrNull), typeRulesUnderDefaultLocale: I(T.string) })),
  paper: I(T.array(T.object({
    pageRule: I(T.string),
    size: I(T.string),
    orientation: I(T.string),
    pageBoxCssPx: I(T.array(T.number)),
    margins: I(T.string),
    contentBoxCssPx: I(T.array(T.number)),
    selector: I(T.string, false),
    observed: I(T.string, false),
    note: I(T.string, false),
  }))),
  profile: N(T.literal("default")),
  pages: N(T.object({ range: N(T.array(T.integer)), measured: I(T.integer), basis: I(T.string) })),
  expectedExit: N(T.object({
    set: N(T.array(T.integer)),
    derivation: I(T.string),
    byCode: I(T.map(T.string, /^[0-4]$/u)),
    environmentNote: I(T.string),
  })),
  features: I(T.array(T.string)),
  notes: I(T.array(T.string)),
  runningElements: I(T.array(T.object({
    id: I(T.string),
    marginBox: I(T.string),
    marginBoxCopies: I(T.integer),
    pages: I(T.array(T.integer)),
    zeroSizeCopyPages: I(T.array(T.integer), false),
    zeroSizeCopyNote: I(T.string, false),
  }))),
  constructionFacts: I(T.array(T.object({ fact: I(T.string), arithmetic: I(T.string, false), measured: I(T.opaque, false) }))),
  rules: N(T.map(T.object(RULE_FIELDS))),
  permittedDeclineReasons: N(T.array(T.string)),
  notActiveInDefaultProfile: N(T.array(T.string)),
  verification: I(T.object({
    method: I(T.string),
    browser: I(T.string),
    pagedjs: I(T.string),
    measuredOn: I(T.string),
    pageCount: I(T.integer),
    pageCountByFontStack: I(T.map(T.integer)),
    pdfPageCount: I(T.integer),
    contentBoxHeightsPx: I(T.array(T.number)),
    platformFonts: I(T.opaque),
    overflowColumnResidue: I(T.array(T.object({
      page: I(T.integer),
      kind: I(T.string),
      tag: I(T.string),
      id: I(T.stringOrNull),
      cls: I(T.stringOrNull),
      text: I(T.string),
      left: I(T.number),
      width: I(T.number),
      height: I(T.number),
    }))),
    fontStacks: I(T.object({ reference: I(T.string), dejavu: I(T.string), free: I(T.string) })),
  })),
};

export const PER_TEXT_FIELDS: Record<string, Field> = {
  id: N(T.string),
  ifMeasured: N(T.string),
  why: I(T.string),
  strokeWidthPx: I(T.number),
  cellInsetsPx: I(T.opaque),
  fillInkInsetsPx: I(T.opaque),
  paintedInkInsetsPx: I(T.opaque),
};
/** Entries: `target` and `why` required in the three finding lists, `class` in `allowed`; see
 * the README for `count`, which is required only when `required` is true (checked below). */
export const ENTRY_FIELDS: Record<ListName, Record<string, Field>> = {
  mustFire: {
    target: N(T.target),
    why: I(T.string),
    occurrences: I(T.integer, false),
    text: I(T.string, false),
    construction: I(T.string, false),
    measured: I(T.opaque, false),
    docsBasis: I(T.string, false),
    observed: I(T.string, false),
    underContentExtentLowerBound: I(T.string, false),
  },
  mustNotFire: {
    target: N(T.target),
    why: I(T.string),
    docsBasis: I(T.string, false),
    measured: I(T.opaque, false),
    construction: I(T.string, false),
  },
  allowed: {
    target: N(T.target),
    class: N(T.string),
    why: I(T.string),
    constructionTruth: I(T.literal("defect"), false),
    text: I(T.string, false),
    construction: I(T.string, false),
    measured: I(T.opaque, false),
    docsBasis: I(T.string, false),
  },
  expectedDeclines: {
    target: N(T.target),
    reason: N(T.string),
    required: N(T.boolean),
    count: N(T.integer, false),
    measuredAlternative: N(T.boolean, false),
    ifMeasured: N(T.string, false),
    perText: N(T.array(T.object(PER_TEXT_FIELDS)), false),
    countsTowardCoverage: I(T.boolean, false),
    why: I(T.string, false),
    docsBasis: I(T.string, false),
    future: I(T.string, false),
    measured: I(T.opaque, false),
  },
};


/** README "Field list": "Targets use only the keys of the Targets table, in one of these shapes". */
export const TARGET_SHAPES: string[][] = [
  ["id"], ["ids"], ["selector"], ["selectors"], ["within"], ["document"], ["document", "except"],
  ["svg", "id"], ["svg", "texts"], ["svg", "use"], ["uri", "id"], ["pageOf"], ["pages"],
];
export const EXCEPT_ITEM_SHAPE = ["id"];
export const URI_FIELDS: Record<string, Field> = { attribute: N(T.string), value: N(T.string) };
export const PAGE_OF_FIELDS: Record<string, Field> = {
  id: N(T.string),
  fragment: N(T.string),
  resolvedPages: N(T.array(T.integer)),
  resolvedPagesByFontStack: I(T.map(T.array(T.integer))),
};

const ALLOWED_CLASSES = new Set(["font-dependent", "documented-gap", "heuristic-boundary", "docs-silent"]);
const PAGES_ALLOWANCE = "any page not named in mustNotFire";
export const LOCAL_URI_RULE = "artifact/local-uri";
/** README step 5: "`layout/half-empty-page` is not active in the default profile, so any finding of it fails." */
export const INACTIVE_RULE = "layout/half-empty-page";
/**
 * README "Evidence-level declines" (E37): the only rows with `ruleId: null` a gate leaves out of
 * the per-rule checks, each with its scope. Any other row without a rule fails.
 */
export const EVIDENCE_LEVEL_DECLINES: readonly { reason: string; scope: string }[] = [
  { reason: "env/evidence-fragment-outside-page", scope: "page" },
  { reason: "env/evidence-overlay-removed", scope: "document" },
];
/**
 * README "`artifact/local-uri`" (E39): the URI-bearing attributes an `id` target reads. `srcset`
 * is out of scope, so a `uri` target naming it is rejected rather than guessed.
 */
const URI_ATTRIBUTES = new Set(["href", "src", "poster", "data"]);
const URI_TARGET_ATTRIBUTES = new Set(["href", "src", "poster", "data", "xlink:href"]);

function typeName(type: FieldType): string {
  switch (type.kind) {
    case "literal": return JSON.stringify(type.value);
    case "array": return `array of ${typeName(type.of)}`;
    case "map": return `map of ${typeName(type.of)}`;
    default: return type.kind;
  }
}

/** Presence and type, and the closed key set, of one object level (README "Field list"). */
export function checkFields(value: unknown, fields: Record<string, Field>, label: string): Record<string, unknown> {
  if (!isObject(value)) fail(`${label}: expected an object`);
  for (const key of Object.keys(value)) if (!(key in fields)) fail(`${label}: unknown field "${key}"`);
  for (const [key, field] of Object.entries(fields)) {
    if (!(key in value)) {
      if (field.required) fail(`${label}: required field "${key}" is missing`);
      continue;
    }
    checkType(value[key], field.type, `${label}.${key}`);
  }
  return value;
}

function checkType(value: unknown, type: FieldType, label: string): void {
  const wrong = (): never => fail(`${label}: expected ${typeName(type)}`);
  switch (type.kind) {
    case "string": if (typeof value !== "string") wrong(); return;
    case "stringOrNull": if (value !== null && typeof value !== "string") wrong(); return;
    case "boolean": if (typeof value !== "boolean") wrong(); return;
    case "integer": if (!Number.isInteger(value)) wrong(); return;
    case "number": if (typeof value !== "number" || !Number.isFinite(value)) wrong(); return;
    case "literal": if (value !== type.value) wrong(); return;
    case "opaque": return;
    case "target": if (!isObject(value)) wrong(); return;
    case "array":
      if (!Array.isArray(value)) wrong();
      (value as unknown[]).forEach((item, i) => checkType(item, type.of, `${label}[${i}]`));
      return;
    case "map":
      if (!isObject(value)) wrong();
      for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (type.keys && !type.keys.test(key)) fail(`${label}: key "${key}" is not allowed here`);
        checkType(item, type.of, `${label}.${key}`);
      }
      return;
    case "object":
      checkFields(value, type.fields, label);
      return;
    case "entries":
      if (!Array.isArray(value)) wrong();
      (value as unknown[]).forEach((item, i) => checkFields(item, ENTRY_FIELDS[type.list], `${label}[${i}]`));
      return;
  }
}

/** Canonical JSON (sorted keys), for "targets compared as canonical JSON" (E40). */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function stringArray(value: unknown, label: string, nonEmpty = true): string[] {
  if (!Array.isArray(value) || (nonEmpty && value.length === 0) || !value.every((item) => typeof item === "string" && item.length > 0)) {
    fail(`${label}: expected a ${nonEmpty ? "non-empty " : ""}list of strings`);
  }
  if (new Set(value).size !== value.length) fail(`${label}: repeats an item`);
  return value as string[];
}

function intArray(value: unknown, label: string): number[] {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => Number.isInteger(item))) fail(`${label}: expected a non-empty list of integers`);
  return value as number[];
}

export interface MatchContext {
  /** Absolute path of the source document the findings must point into. */
  documentPath: string;
  /** Directory the CLI ran in; relative `source.file` values resolve against it. */
  cwd: string;
}

export type Predicate = (finding: Finding, context: MatchContext) => boolean;

export interface CompiledTarget {
  label: string;
  matches: Predicate;
  /** Pages of a `pageOf` target, for the `pages` allowance. */
  pageOfPages: number[] | null;
}

export interface CompiledEntry {
  list: ListName;
  index: number;
  target: CompiledTarget;
  occurrences: number | null;
}

export interface MeasuredAlternativeTarget {
  label: string;
  ifMeasured: "mustFire" | "mustNotFire";
  matches: Predicate;
}

export interface DeclineGroup {
  reason: string;
  required: boolean;
  measuredAlternative: boolean;
  /** Sum of `count` over the entries; null when a non-required entry carries no count. */
  total: number | null;
  entries: number;
  alternatives: MeasuredAlternativeTarget[];
}

export interface CompiledRule {
  ruleId: string;
  mustFire: CompiledEntry[];
  mustNotFire: CompiledEntry[];
  allowed: CompiledEntry[];
  declines: DeclineGroup[];
}

export interface CompiledExpected {
  documentId: string;
  pagesRange: [number, number];
  exitSet: number[];
  permittedDeclineReasons: string[];
  notActiveInDefaultProfile: string[];
  rules: Map<string, CompiledRule>;
}

function sourceWithin(span: { start: number; end: number }): Predicate {
  // README "Source spans": "A finding's source lies within a span when the span starts at or
  // before `source.offset` and `source.endOffset` is at or before the span's end."
  return (finding, context) => {
    const source = finding.source;
    if (!source) return false;
    if (source.coordinateSystem !== "utf8-bytes-unicode-codepoints-v1") return false;
    if (resolve(context.cwd, source.file) !== context.documentPath) return false;
    if (!Number.isInteger(source.offset) || !Number.isInteger(source.endOffset)) return false;
    return span.start <= source.offset && source.endOffset <= span.end;
  };
}

function anyOf(predicates: Predicate[]): Predicate {
  return (finding, context) => predicates.some((predicate) => predicate(finding, context));
}

/**
 * The `L="V"` strings of URI-bearing attributes of an element and its descendants. V is the value
 * as the HTML parser returns it: character references decoded, nothing else changed (E39).
 */
function uriNeedles(index: SourceIndex, element: SourceElement): string[] {
  const needles: string[] = [];
  const scope = index.elements.filter((candidate) => candidate === element || isDescendant(candidate, element));
  for (const candidate of scope) {
    for (const attr of candidate.node.attrs) {
      // parse5 reports `xlink:href` as local name `href` with prefix `xlink` (README: "the
      // attribute's local name as the HTML parser reports it, so `xlink:href` appears as `href`").
      if (attr.prefix && !(attr.prefix === "xlink" && attr.name === "href")) continue;
      if (!URI_ATTRIBUTES.has(attr.name)) continue;
      needles.push(`${attr.name}="${attr.value}"`);
    }
  }
  return needles;
}

function messageContainsAny(needles: string[]): Predicate {
  return (finding) => needles.some((needle) => typeof finding.message === "string" && finding.message.includes(needle));
}

function localName(attribute: string): string {
  const colon = attribute.indexOf(":");
  return colon >= 0 ? attribute.slice(colon + 1) : attribute;
}

interface TargetScope {
  ruleId: string;
  index: SourceIndex;
  /** Resolved pages of the rule's `mustNotFire` `pageOf` targets, for the `pages` allowance. */
  mustNotFirePages: () => number[];
  label: string;
}

function svgText(scope: TargetScope, svg: SourceElement, id: unknown, label: string): SourceElement {
  const text = elementById(scope.index, id, label);
  if (text.tag !== "text" || text.namespace !== SVG_NS) fail(`${label}: "${String(id)}" is not an SVG <text> element`);
  // README Targets table (E36): X is T's nearest `<svg>` ancestor, for `{svg, id}` and every id
  // in `texts`; "a gate that finds otherwise fails the entry".
  if (nearestSvg(text) !== svg) fail(`${label}: "${String(id)}" does not have "${svg.id ?? "?"}" as its nearest <svg>`);
  return text;
}

/**
 * README "Targets" table, "Identity" and "Combination": a target has one of the Field list's
 * shapes; every id it names occurs exactly once; all keys combine with AND, and a list-valued key
 * (`ids`, `selectors`, `texts`, `except`) matches when any item matches.
 */
export function compileTarget(raw: unknown, scope: TargetScope, shapes: string[][] = TARGET_SHAPES): CompiledTarget {
  if (!isObject(raw)) fail(`${scope.label}: target must be an object`);
  const target = raw;
  const shape = Object.keys(target).sort().join(",");
  if (!shapes.some((allowed) => [...allowed].sort().join(",") === shape)) {
    fail(`${scope.label}: target shape {${Object.keys(target).join(", ")}} is not one of the Field list's target shapes`);
  }
  const shown = Object.fromEntries(Object.entries(target).map(([key, value]) => [key, key === "pageOf" && isObject(value) ? { id: value.id, fragment: value.fragment, resolvedPages: value.resolvedPages } : value]));
  const label = `${scope.label} ${JSON.stringify(shown)}`;
  const conditions: Predicate[] = [];
  const localUri = scope.ruleId === LOCAL_URI_RULE;
  let pageOfPages: number[] | null = null;

  const idCondition = (id: unknown, idLabel: string): Predicate => {
    const element = elementById(scope.index, id, idLabel);
    if (localUri) return messageContainsAny(uriNeedles(scope.index, element));
    return sourceWithin(spanOf(element, idLabel));
  };

  if ("document" in target) {
    if (target.document !== true) fail(`${scope.label}: document must be true`);
    conditions.push(() => true);
  }
  if ("except" in target) {
    if (!Array.isArray(target.except) || target.except.length === 0) fail(`${scope.label}: except must be a non-empty list of targets`);
    // Field list: "every `except` item is `{id}`".
    const excepted = target.except.map((item, i) => compileTarget(item, { ...scope, label: `${scope.label} except[${i}]` }, [EXCEPT_ITEM_SHAPE]));
    conditions.push((finding, context) => !excepted.some((item) => item.matches(finding, context)));
  }
  if ("svg" in target) {
    const svg = elementById(scope.index, target.svg, `${scope.label} svg`);
    if (svg.tag !== "svg" || svg.namespace !== SVG_NS) fail(`${scope.label}: "${String(target.svg)}" is not an <svg> element`);
    if ("texts" in target) {
      const texts = stringArray(target.texts, `${scope.label} texts`);
      conditions.push(anyOf(texts.map((id) => sourceWithin(spanOf(svgText(scope, svg, id, `${scope.label} texts`), `${scope.label} texts`)))));
    }
    if ("use" in target) {
      conditions.push(sourceWithin(spanOf(useReferencedText(scope, svg, target.use), `${scope.label} use`)));
    }
    if ("id" in target) {
      conditions.push(sourceWithin(spanOf(svgText(scope, svg, target.id, `${scope.label} id`), `${scope.label} id`)));
    }
  } else if ("id" in target) {
    conditions.push(idCondition(target.id, `${scope.label} id`));
  }
  if ("ids" in target) {
    const ids = stringArray(target.ids, `${scope.label} ids`);
    conditions.push(anyOf(ids.map((id) => idCondition(id, `${scope.label} ids`))));
  }
  for (const key of ["selector", "selectors"] as const) {
    if (!(key in target)) continue;
    if (localUri) fail(`${scope.label}: ${key} targets are not defined for ${LOCAL_URI_RULE}`);
    const selectors = key === "selector" ? [target.selector] : stringArray(target.selectors, `${scope.label} selectors`);
    const elements = selectors.flatMap((selector) => selectElements(scope.index, selector as string));
    if (elements.length === 0) fail(`${scope.label}: ${key} matches no element in the source document`);
    conditions.push(anyOf(elements.map((element) => sourceWithin(spanOf(element, `${scope.label} ${key}`)))));
  }
  if ("within" in target) {
    if (localUri) fail(`${scope.label}: within targets are not defined for ${LOCAL_URI_RULE}`);
    const element = elementById(scope.index, target.within, `${scope.label} within`);
    conditions.push(sourceWithin(spanOf(element, `${scope.label} within`)));
  }
  if ("uri" in target) {
    if (!localUri) fail(`${scope.label}: uri targets are defined only for ${LOCAL_URI_RULE}`);
    const uri = checkFields(target.uri, URI_FIELDS, `${scope.label} uri`);
    const attribute = uri.attribute as string;
    const value = uri.value as string;
    if (!URI_TARGET_ATTRIBUTES.has(attribute)) fail(`${scope.label}: uri attribute "${attribute}" is not one of ${[...URI_TARGET_ATTRIBUTES].join(", ")} (srcset is out of scope)`);
    // README: "Where a target has both `uri` and `id`, the pair is an attribute of X."
    const element = elementById(scope.index, target.id, `${scope.label} id`);
    const own = element.node.attrs.some((attr) => (attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name) === attribute && attr.value === value);
    if (!own) fail(`${scope.label}: ${attribute}="${value}" is not an attribute of "${String(target.id)}"`);
    conditions.push(messageContainsAny([`${localName(attribute)}="${value}"`]));
  }
  if ("pageOf" in target) {
    const pageOf = checkFields(target.pageOf, PAGE_OF_FIELDS, `${scope.label} pageOf`);
    elementById(scope.index, pageOf.id, `${scope.label} pageOf`);
    if (!["first", "last", "middle"].includes(pageOf.fragment as string)) fail(`${scope.label}: pageOf.fragment must be first, last or middle`);
    const pages = intArray(pageOf.resolvedPages, `${scope.label} pageOf.resolvedPages`);
    pageOfPages = pages;
    conditions.push((finding) => pages.includes(finding.page));
  }
  if ("pages" in target) {
    if (target.pages !== PAGES_ALLOWANCE) fail(`${scope.label}: pages must read "${PAGES_ALLOWANCE}"`);
    conditions.push((finding) => !scope.mustNotFirePages().includes(finding.page));
  }
  if (conditions.length === 0) fail(`${scope.label}: target matches nothing`);
  return { label, matches: (finding, context) => conditions.every((condition) => condition(finding, context)), pageOfPages };
}

function useReferencedText(scope: TargetScope, svg: SourceElement, useId: unknown): SourceElement {
  const use = elementById(scope.index, useId, `${scope.label} use`);
  if (use.tag !== "use" || use.namespace !== SVG_NS) fail(`${scope.label}: "${String(useId)}" is not an SVG <use> element`);
  if (nearestSvg(use) !== svg) fail(`${scope.label}: <use> "${String(useId)}" is not inside "${svg.id ?? "?"}"`);
  const hrefs = use.node.attrs.filter((attr) => attr.name === "href" && (!attr.prefix || attr.prefix === "xlink"));
  if (hrefs.length !== 1 || !hrefs[0]!.value.startsWith("#")) fail(`${scope.label}: <use> "${String(useId)}" needs exactly one fragment href`);
  const text = elementById(scope.index, hrefs[0]!.value.slice(1), `${scope.label} use href`);
  // README: "the span of the `<text>` element that the `<use>` element U references".
  if (text.tag !== "text" || text.namespace !== SVG_NS) fail(`${scope.label}: <use> "${String(useId)}" does not reference an SVG <text>`);
  return text;
}

/**
 * Validates one expected file against the README's field list and compiles its targets against
 * the source document. Every unknown field, malformed target and violated README invariant fails
 * the file, and with it the gate, before any document runs.
 */
export function compileExpected(raw: unknown, index: SourceIndex, binding: { id: string; artifact: string; sha256: string; byteLength: number }): CompiledExpected {
  const label = binding.id;
  const expected = checkFields(raw, FIELD_LIST, label);
  if (expected.documentId !== binding.id) fail(`${label}: documentId ${String(expected.documentId)} does not name the manifest document`);
  if (expected.artifact !== binding.artifact) fail(`${label}: artifact ${String(expected.artifact)} differs from the manifest path ${binding.artifact}`);
  if (expected.sha256 !== binding.sha256) fail(`${label}: expected file binds sha256 ${String(expected.sha256)}, the document is ${binding.sha256}`);
  if (expected.byteLength !== binding.byteLength) fail(`${label}: expected file binds byteLength ${String(expected.byteLength)}, the document has ${binding.byteLength}`);

  const pages = expected.pages as Record<string, unknown>;
  const range = intArray(pages.range, `${label} pages.range`);
  // E40: `[lo, hi]`, both ends included.
  if (range.length !== 2 || range[0]! < 1 || range[0]! > range[1]!) fail(`${label}: pages.range must be [low, high] with 1 <= low <= high`);

  const exit = expected.expectedExit as Record<string, unknown>;
  const exitSet = intArray(exit.set, `${label} expectedExit.set`);
  if (new Set(exitSet).size !== exitSet.length || !exitSet.every((code) => code >= 0 && code <= 4)) fail(`${label}: expectedExit.set must hold distinct codes 0..4`);

  const permitted = stringArray(expected.permittedDeclineReasons, `${label} permittedDeclineReasons`);
  const inactive = stringArray(expected.notActiveInDefaultProfile, `${label} notActiveInDefaultProfile`, false);
  const rulesRaw = expected.rules as Record<string, Record<string, unknown>>;
  if (Object.keys(rulesRaw).length === 0) fail(`${label}: rules is empty`);
  for (const ruleId of inactive) if (!(ruleId in rulesRaw)) fail(`${label}: notActiveInDefaultProfile names ${ruleId}, which has no rules entry`);

  const rules = new Map<string, CompiledRule>();
  for (const [ruleId, rule] of Object.entries(rulesRaw)) {
    const ruleLabel = `${label} ${ruleId}`;
    const compiled: CompiledRule = { ruleId, mustFire: [], mustNotFire: [], allowed: [], declines: [] };
    const mustNotFirePages: number[] = [];
    const scopeFor = (entryLabel: string): TargetScope => ({ ruleId, index, mustNotFirePages: () => mustNotFirePages, label: entryLabel });
    // E40, "Identity": no target repeats within one list; `mustFire`, `mustNotFire` and `allowed`
    // share no target; a `mustFire` or `allowed` target may also appear in `expectedDeclines`.
    const findingListOf = new Map<string, string>();
    // mustNotFire first, so that a `pages` allowance knows the pages it excludes.
    for (const list of ["mustNotFire", "mustFire", "allowed"] as const) {
      (rule[list] as Record<string, unknown>[]).forEach((entry, i) => {
        const entryLabel = `${ruleLabel} ${list}[${i}]`;
        const key = canonicalJson(entry.target);
        const previous = findingListOf.get(key);
        if (previous) fail(`${entryLabel}: repeats the target of ${previous}`);
        findingListOf.set(key, entryLabel);
        if (list === "allowed") {
          if (!ALLOWED_CLASSES.has(entry.class as string)) fail(`${entryLabel}: class ${String(entry.class)} is not one of ${[...ALLOWED_CLASSES].join(", ")}`);
          if ((entry.class === "documented-gap") !== ("constructionTruth" in entry)) fail(`${entryLabel}: constructionTruth "defect" goes with class documented-gap`);
        }
        if ("occurrences" in entry && (entry.occurrences as number) < 1) fail(`${entryLabel}: occurrences must be a positive integer`);
        const target = compileTarget(entry.target, scopeFor(entryLabel));
        if (list === "mustNotFire" && target.pageOfPages) mustNotFirePages.push(...target.pageOfPages);
        if ("pages" in (entry.target as Record<string, unknown>) && list !== "allowed") fail(`${entryLabel}: the pages target is a page-level allowance`);
        compiled[list].push({ list, index: i, target, occurrences: typeof entry.occurrences === "number" ? entry.occurrences : null });
      });
    }
    // README "Page targets": "In no rule do the mustFire and mustNotFire page sets overlap."
    for (const entry of compiled.mustFire) {
      const overlap = (entry.target.pageOfPages ?? []).filter((page) => mustNotFirePages.includes(page));
      if (overlap.length) fail(`${ruleLabel}: mustFire and mustNotFire page sets overlap on ${overlap.join(", ")}`);
    }

    const groups = new Map<string, { required: boolean[]; alternative: boolean[]; counts: (number | null)[]; alternatives: MeasuredAlternativeTarget[] }>();
    const declineKeys = new Map<string, string>();
    (rule.expectedDeclines as Record<string, unknown>[]).forEach((entry, i) => {
      const entryLabel = `${ruleLabel} expectedDeclines[${i}]`;
      // E40: in `expectedDeclines` the target together with `reason` does not repeat.
      const key = canonicalJson({ target: entry.target, reason: entry.reason });
      if (declineKeys.has(key)) fail(`${entryLabel}: repeats the target and reason of ${declineKeys.get(key)}`);
      declineKeys.set(key, entryLabel);
      const reason = entry.reason as string;
      if (!reason.startsWith("env/")) fail(`${entryLabel}: reason must be an env/ id`);
      if ("count" in entry && (entry.count as number) < 1) fail(`${entryLabel}: count must be a positive integer`);
      if (entry.required && !("count" in entry)) fail(`${entryLabel}: a required decline needs a count`);
      const alternative = entry.measuredAlternative === true;
      // Compiling the target checks that it resolves in the source, even where only the count is judged.
      compileTarget(entry.target, scopeFor(entryLabel));
      const group = groups.get(reason) ?? { required: [], alternative: [], counts: [], alternatives: [] };
      group.required.push(entry.required as boolean);
      group.alternative.push(alternative);
      group.counts.push(typeof entry.count === "number" ? entry.count : null);
      if (alternative) {
        if (!entry.required) fail(`${entryLabel}: a measuredAlternative decline is required`);
        const targetRaw = entry.target as Record<string, unknown>;
        const svgScope = scopeFor(entryLabel);
        const svg = elementById(index, targetRaw.svg, `${entryLabel} svg`);
        let targets: MeasuredAlternativeTarget[];
        if ("texts" in targetRaw) {
          if ("ifMeasured" in entry) fail(`${entryLabel}: a texts entry carries ifMeasured per text, in perText`);
          if (!Array.isArray(entry.perText)) fail(`${entryLabel}: perText is missing`);
          const texts = stringArray(targetRaw.texts, `${entryLabel} texts`);
          const perText = entry.perText as Record<string, unknown>[];
          const perIds = perText.map((item) => item.id as string);
          if ([...perIds].sort().join(",") !== [...texts].sort().join(",") || new Set(perIds).size !== perIds.length) fail(`${entryLabel}: perText ids differ from the target's texts`);
          targets = perText.map((item) => {
            if (item.ifMeasured !== "mustFire" && item.ifMeasured !== "mustNotFire") fail(`${entryLabel}: perText ${String(item.id)} ifMeasured must be mustFire or mustNotFire`);
            const text = svgText(svgScope, svg, item.id, `${entryLabel} perText`);
            return { label: `${ruleLabel} measured ${String(item.id)}`, ifMeasured: item.ifMeasured, matches: sourceWithin(spanOf(text, `${entryLabel} perText`)) };
          });
        } else if ("use" in targetRaw) {
          if ("perText" in entry) fail(`${entryLabel}: a use entry carries ifMeasured on the entry`);
          if (entry.ifMeasured !== "mustFire" && entry.ifMeasured !== "mustNotFire") fail(`${entryLabel}: ifMeasured must be mustFire or mustNotFire`);
          const text = useReferencedText(svgScope, svg, targetRaw.use);
          targets = [{ label: `${ruleLabel} measured use ${String(targetRaw.use)}`, ifMeasured: entry.ifMeasured, matches: sourceWithin(spanOf(text, `${entryLabel} use`)) }];
        } else {
          fail(`${entryLabel}: a measuredAlternative entry targets svg texts or a use`);
        }
        // README invariant: "every measuredAlternative entry's count equals the number of its targets".
        if (entry.count !== targets.length) fail(`${entryLabel}: count ${String(entry.count)} differs from its ${targets.length} target(s)`);
        group.alternatives.push(...targets);
      } else if ("ifMeasured" in entry || "perText" in entry) {
        fail(`${entryLabel}: ifMeasured and perText belong to measuredAlternative entries`);
      }
      groups.set(reason, group);
    });
    for (const [reason, group] of groups) {
      // README invariant: "for one rule and reason the entries are either all `required: true` or
      // all `required: false`, and either all `measuredAlternative` or none".
      if (new Set(group.required).size !== 1) fail(`${ruleLabel} ${reason}: required and non-required entries are mixed`);
      if (new Set(group.alternative).size !== 1) fail(`${ruleLabel} ${reason}: measuredAlternative and plain entries are mixed`);
      const counts = group.counts;
      compiled.declines.push({
        reason,
        required: group.required[0]!,
        measuredAlternative: group.alternative[0]!,
        total: counts.every((count) => count !== null) ? counts.reduce<number>((sum, count) => sum + (count ?? 0), 0) : null,
        entries: counts.length,
        alternatives: group.alternatives,
      });
    }
    rules.set(ruleId, compiled);
  }
  return { documentId: binding.id, pagesRange: [range[0]!, range[1]!], exitSet, permittedDeclineReasons: permitted, notActiveInDefaultProfile: inactive, rules };
}

// ---------------------------------------------------------------------------------------------
// Steps 2 to 5 for one document.

export interface RunOutcome {
  exitCode: number | null;
  signal: string | null;
  report: Report | null;
  reportProblem: string | null;
  stderr: string;
}

export interface DeclineSummary {
  ruleId: string;
  reason: string;
  kind: "required" | "measured-alternative";
  expected: number;
  actual: number;
  state: "ok" | "declined" | "measured" | "mismatch";
}

export interface DocumentVerdict {
  id: string;
  pass: boolean;
  exitCode: number | null;
  exitSet: number[];
  exitReason: string | null;
  pages: number | null;
  pagesRange: [number, number];
  ruleChecksSkipped: boolean;
  mustFireHit: number;
  mustFireTotal: number;
  mustNotFireViolations: number;
  unaccounted: number;
  findings: number;
  declines: DeclineSummary[];
  /** Sum of the counts of evidence-level rows (`ruleId: null`), left out of the per-rule checks. */
  evidenceLevelDeclines: number;
  failures: string[];
  notes: string[];
}

function describeFinding(finding: Finding): string {
  const source = finding.source ? `${finding.source.offset}..${finding.source.endOffset}` : "source null";
  return `${finding.ruleId} p${finding.page} [${source}] ${String(finding.message).slice(0, 90)}`;
}

export interface EvaluateOptions {
  documentPath: string;
  cwd: string;
  sha256: string;
}

/**
 * README "How a gate consumes this", steps 2 to 5, for one invocation's outcome.
 */
export function evaluateDocument(expected: CompiledExpected, outcome: RunOutcome, options: EvaluateOptions): DocumentVerdict {
  const verdict: DocumentVerdict = {
    id: expected.documentId,
    pass: false,
    exitCode: outcome.exitCode,
    exitSet: expected.exitSet,
    exitReason: null,
    pages: null,
    pagesRange: expected.pagesRange,
    ruleChecksSkipped: false,
    mustFireHit: 0,
    mustFireTotal: 0,
    mustNotFireViolations: 0,
    unaccounted: 0,
    findings: 0,
    declines: [],
    evidenceLevelDeclines: 0,
    failures: [],
    notes: [],
  };
  const failures = verdict.failures;
  const done = (): DocumentVerdict => {
    verdict.pass = failures.length === 0;
    return verdict;
  };

  // Step 2, harness integrity: the report must be the canonical JSON report of THIS invocation.
  if (outcome.signal) failures.push(`the CLI was terminated by ${outcome.signal}`);
  if (outcome.exitCode === null) failures.push("the CLI produced no exit code");
  if (outcome.reportProblem || !outcome.report) {
    failures.push(`no canonical JSON report: ${outcome.reportProblem ?? "missing"}`);
    return done();
  }
  const report = outcome.report;
  if (report.schemaVersion !== ACCEPTED_REPORT_SCHEMA_VERSION) failures.push(`report schemaVersion ${String(report.schemaVersion)}, this gate reads ${ACCEPTED_REPORT_SCHEMA_VERSION}`);
  if (report.exitCode !== outcome.exitCode) failures.push(`report exitCode ${String(report.exitCode)} differs from the process exit ${String(outcome.exitCode)}`);
  if (report.config?.profile !== "default") failures.push(`report profile ${String(report.config?.profile)}, the gate is defined for the default profile`);
  if (!Array.isArray(report.documents) || report.documents.length !== 1) {
    failures.push(`report holds ${Array.isArray(report.documents) ? report.documents.length : "no"} documents; one document per invocation`);
    return done();
  }
  const document: DocumentReport = report.documents[0]!;
  verdict.exitReason = document.exitReason;
  if (document.inputIdentity && document.inputIdentity.html !== options.sha256) failures.push(`report inputIdentity.html ${document.inputIdentity.html} is not the verified document`);
  if (failures.length) return done();
  const exitCode = outcome.exitCode!;

  // Step 3.
  if (exitCode === 3) {
    if (!expected.exitSet.includes(3)) {
      failures.push(`exit 3 (${String(document.exitReason)}) is not in the expected set {${expected.exitSet.join(", ")}}`);
    } else if (document.exitReason !== "render-unstable") {
      failures.push(`exit 3 with reason ${String(document.exitReason)}; only render-unstable passes`);
    } else {
      verdict.ruleChecksSkipped = true;
      verdict.notes.push("render-unstable: findings withheld by design, page and rule checks skipped (README step 3)");
    }
    return done();
  }

  // Step 4.
  if (!expected.exitSet.includes(exitCode)) failures.push(`exit ${exitCode} (${String(document.exitReason)}) is not in the expected set {${expected.exitSet.join(", ")}}`);
  verdict.pages = document.pages;
  if (!Number.isInteger(document.pages) || document.pages < expected.pagesRange[0] || document.pages > expected.pagesRange[1]) {
    failures.push(`pages ${String(document.pages)} outside [${expected.pagesRange.join(", ")}]`);
  }

  // Step 5.
  const context: MatchContext = { documentPath: options.documentPath, cwd: options.cwd };
  const findings = Array.isArray(document.findings) ? document.findings : (failures.push("report has no findings list"), []);
  const rows: NotMeasured[] = Array.isArray(document.notMeasured) ? document.notMeasured : (failures.push("report has no notMeasured list"), []);
  verdict.findings = findings.length;
  const active = new Set(report.config?.activeRules ?? []);
  // Field list: `rules` holds "exactly the thirteen registered rule ids". The registered set is
  // what the run reports as active plus disabled; no second rule table is kept here.
  const registered = [...new Set([...active, ...(report.config?.disabledRules ?? [])])].sort();
  if (registered.join(",") !== [...expected.rules.keys()].sort().join(",")) {
    failures.push(`the report's registered rules [${registered.join(", ")}] are not the expected file's rules [${[...expected.rules.keys()].sort().join(", ")}]`);
  }
  for (const ruleId of expected.notActiveInDefaultProfile) if (active.has(ruleId)) failures.push(`${ruleId} is active; it is not active in the default profile`);

  const covered = new Set<Finding>();
  for (const finding of findings) {
    if (finding.ruleId === INACTIVE_RULE) failures.push(`${INACTIVE_RULE} is not active in the default profile, any finding fails: ${describeFinding(finding)}`);
    if (!expected.rules.has(finding.ruleId)) failures.push(`finding of a rule the expected file does not name: ${describeFinding(finding)}`);
  }

  for (const [ruleId, rule] of expected.rules) {
    const ruleFindings = findings.filter((finding) => finding.ruleId === ruleId);
    for (const entry of rule.mustFire) {
      verdict.mustFireTotal += 1;
      const hits = ruleFindings.filter((finding) => entry.target.matches(finding, context));
      if (hits.length === 0) failures.push(`mustFire missed: ${entry.target.label}`);
      else {
        verdict.mustFireHit += 1;
        if (entry.occurrences !== null && entry.occurrences !== hits.length) verdict.notes.push(`${entry.target.label}: ${hits.length} finding(s), ${entry.occurrences} planted occurrence(s) (informational)`);
      }
      hits.forEach((finding) => covered.add(finding));
    }
    for (const entry of rule.mustNotFire) {
      for (const finding of ruleFindings.filter((candidate) => entry.target.matches(candidate, context))) {
        verdict.mustNotFireViolations += 1;
        failures.push(`mustNotFire violated: ${entry.target.label} <- ${describeFinding(finding)}`);
      }
    }
    for (const entry of rule.allowed) for (const finding of ruleFindings) if (entry.target.matches(finding, context)) covered.add(finding);

    // README "Declines": checked by count, per rule and reason, never per target.
    const ruleRows = rows.filter((row) => row.ruleId === ruleId);
    for (const group of rule.declines) {
      const actual = ruleRows.filter((row) => row.reason === group.reason).reduce((sum, row) => sum + row.count, 0);
      if (!group.required) continue; // checked only against permittedDeclineReasons below
      const expectedTotal = group.total!;
      if (!group.measuredAlternative) {
        const ok = actual === expectedTotal;
        verdict.declines.push({ ruleId, reason: group.reason, kind: "required", expected: expectedTotal, actual, state: ok ? "ok" : "mismatch" });
        if (!ok) failures.push(`${ruleId} ${group.reason}: report declines ${actual}, the required entries sum to ${expectedTotal}`);
        continue;
      }
      if (actual === expectedTotal) {
        verdict.declines.push({ ruleId, reason: group.reason, kind: "measured-alternative", expected: expectedTotal, actual, state: "declined" });
      } else if (actual === 0) {
        verdict.declines.push({ ruleId, reason: group.reason, kind: "measured-alternative", expected: expectedTotal, actual, state: "measured" });
        for (const alternative of group.alternatives) {
          const hits = ruleFindings.filter((finding) => alternative.matches(finding, context));
          if (alternative.ifMeasured === "mustFire") {
            if (hits.length === 0) failures.push(`measured target without a finding (ifMeasured mustFire): ${alternative.label}`);
            hits.forEach((finding) => covered.add(finding));
          } else {
            for (const finding of hits) failures.push(`measured target with a finding (ifMeasured mustNotFire): ${alternative.label} <- ${describeFinding(finding)}`);
          }
        }
      } else {
        verdict.declines.push({ ruleId, reason: group.reason, kind: "measured-alternative", expected: expectedTotal, actual, state: "mismatch" });
        failures.push(`${ruleId} ${group.reason}: report declines ${actual}; measuredAlternative entries are all (${expectedTotal}) or nothing (0)`);
      }
    }

    // Closed world.
    for (const finding of ruleFindings) {
      if (!covered.has(finding)) {
        verdict.unaccounted += 1;
        failures.push(`unaccounted finding (closed world): ${describeFinding(finding)}`);
      }
    }
  }

  // Step 5 (E37): "no decline row of that rule carries a reason outside `permittedDeclineReasons`
  // (rows with `ruleId: null` follow the paragraph 'Evidence-level declines')".
  for (const row of rows) {
    if (!Number.isInteger(row.count) || row.count < 1) failures.push(`malformed decline row count: ${row.ruleId ?? "(no rule)"} ${row.reason} ${String(row.count)}`);
    if (row.ruleId === null) {
      const exempt = EVIDENCE_LEVEL_DECLINES.some((allowed) => allowed.reason === row.reason && allowed.scope === row.scope);
      if (exempt) {
        verdict.evidenceLevelDeclines += row.count;
        verdict.notes.push(`evidence-level decline left out of the per-rule checks: ${row.scope} ${row.reason} x${row.count}`);
      } else {
        failures.push(`decline row with ruleId null that is not an evidence-level decline: ${row.scope} ${row.reason} x${row.count}`);
      }
      continue;
    }
    if (!expected.rules.has(row.ruleId)) failures.push(`decline of a rule the expected file does not name: ${row.ruleId} ${row.reason} x${row.count}`);
    if (!expected.permittedDeclineReasons.includes(row.reason)) failures.push(`decline reason outside permittedDeclineReasons: ${row.ruleId} ${row.reason} x${row.count}`);
  }
  return done();
}

// ---------------------------------------------------------------------------------------------
// Running the CLI and printing the table.

export interface GateOptions {
  corpus: string;
  cli: string;
  cwd: string;
  /** Local diagnosis only: passed through to the CLI, and the run is labelled as not the gate. */
  noEvidenceBinding: boolean;
  keepReports: string | null;
  timeoutMs: number;
  log: (line: string) => void;
}

export interface GateResult {
  pass: boolean;
  verdicts: DocumentVerdict[];
  documentsRead: number;
}

function runOne(document: ManifestDocument, options: GateOptions, temporary: string): RunOutcome {
  const reportPath = join(temporary, `${document.id}.json`);
  const args = [options.cli, "--format", "json", "--out", reportPath];
  if (options.noEvidenceBinding) args.push("--no-evidence-binding");
  // Relative to the CLI's cwd, as a consumer types it. The report echoes this path in
  // `source.file`; an absolute path under the home directory is redacted there (`~/...`) and
  // could then no longer be resolved to the document, so every source match would fail.
  args.push(relative(options.cwd, document.htmlPath));
  const run = spawnSync(process.execPath, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: 64 * 1024 * 1024,
  });
  let report: Report | null = null;
  let reportProblem: string | null = null;
  if (run.error && !run.signal) reportProblem = `the CLI could not be started: ${run.error.message}`;
  else if (!existsSync(reportPath)) reportProblem = `the invocation wrote no report (exit ${String(run.status)}; stderr: ${(run.stderr ?? "").trim().slice(0, 400)})`;
  else {
    try {
      report = JSON.parse(readFileSync(reportPath, "utf8")) as Report;
      if (options.keepReports) {
        mkdirSync(options.keepReports, { recursive: true });
        copyFileSync(reportPath, join(options.keepReports, `${document.id}.json`));
      }
    } catch (error) {
      reportProblem = `the report is not JSON: ${(error as Error).message}`;
    }
  }
  return { exitCode: run.status, signal: run.signal, report, reportProblem, stderr: run.stderr ?? "" };
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

export function formatTable(verdicts: DocumentVerdict[]): string[] {
  const header = ["document", "exit (expected)", "reason", "pages (range)", "mustFire", "mustNotFire", "unaccounted", "declines", "verdict"];
  const rows = verdicts.map((v) => [
    v.id,
    `${v.exitCode ?? "-"} {${v.exitSet.join(",")}}`,
    v.exitReason ?? "-",
    `${v.pages ?? "-"} [${v.pagesRange.join("-")}]`,
    v.ruleChecksSkipped ? "skipped" : `${v.mustFireHit}/${v.mustFireTotal}`,
    v.ruleChecksSkipped ? "skipped" : String(v.mustNotFireViolations),
    v.ruleChecksSkipped ? "skipped" : `${v.unaccounted}/${v.findings}`,
    [
      ...v.declines.map((d) => `${d.ruleId.split("/")[1]} ${d.reason.slice(4)} ${d.actual}/${d.expected}${d.kind === "measured-alternative" ? ` ${d.state}` : d.state === "ok" ? "" : " MISMATCH"}`),
      ...(v.evidenceLevelDeclines ? [`evidence-level ${v.evidenceLevelDeclines}`] : []),
    ].join("; ") || "-",
    v.pass ? "PASS" : "FAIL",
  ]);
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column]!.length)));
  const line = (cells: string[]): string => `| ${cells.map((cell, column) => pad(cell, widths[column]!)).join(" | ")} |`;
  return [line(header), `|${widths.map((width) => "-".repeat(width + 2)).join("|")}|`, ...rows.map(line)];
}

export function runGate(options: GateOptions): GateResult {
  const manifest = verifyManifest(options.corpus);
  options.log(`corpus gate: ${manifest.manifestId}: ${manifest.filesVerified} files verified by SHA-256 and byte length, ${manifest.documents.length} documents`);
  if (options.noEvidenceBinding) options.log("corpus gate: LOCAL DIAGNOSTIC RUN with --no-evidence-binding; this is not the CI gate");
  if (existsSync(join(options.cwd, "breaklint.config.json"))) fail(`${options.cwd} holds a breaklint.config.json; the gate runs the default profile with no configuration`);
  if (!existsSync(options.cli)) fail(`CLI not found: ${options.cli} (run npm run build first)`);

  // Every expected file is validated and compiled before the first invocation.
  const compiled = manifest.documents.map((document) => {
    const bytes = readFileSync(document.htmlPath);
    const index = indexSource(bytes);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(document.expectedPath, "utf8"));
    } catch (error) {
      fail(`${document.id}: expected file is not JSON: ${(error as Error).message}`);
    }
    const expected = compileExpected(raw, index, { id: document.id, artifact: relative(manifest.root, document.htmlPath).split(sep).join("/"), sha256: document.sha256, byteLength: document.byteLength });
    if (expected.exitSet.join(",") !== document.expectedExit.join(",")) fail(`${document.id}: manifest expectedExit [${document.expectedExit.join(", ")}] differs from the expected file [${expected.exitSet.join(", ")}]`);
    if (expected.pagesRange.join(",") !== document.pagesRange.join(",")) fail(`${document.id}: manifest pagesRange differs from the expected file`);
    return { document, expected };
  });
  const ruleSets = new Set(compiled.map(({ expected }) => [...expected.rules.keys()].sort().join(",")));
  if (ruleSets.size !== 1) fail("the expected files do not name the same rule set");

  const temporary = mkdtempSync(join(tmpdir(), "breaklint-corpus-gate-"));
  const verdicts: DocumentVerdict[] = [];
  try {
    for (const { document, expected } of compiled) {
      const started = Date.now();
      const outcome = runOne(document, options, temporary);
      const verdict = evaluateDocument(expected, outcome, { documentPath: document.htmlPath, cwd: options.cwd, sha256: document.sha256 });
      verdicts.push(verdict);
      options.log(`corpus gate: ${document.id}: ${verdict.pass ? "PASS" : "FAIL"} (exit ${String(outcome.exitCode)}, ${((Date.now() - started) / 1000).toFixed(1)} s)`);
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  if (verdicts.length === 0) fail("zero documents were run");
  return { pass: verdicts.length === manifest.documents.length && verdicts.every((verdict) => verdict.pass), verdicts, documentsRead: verdicts.length };
}

function argument(argv: string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) fail(`${name} requires a value`);
  return value;
}

const KNOWN_FLAGS = new Set(["--corpus", "--cli", "--cwd", "--no-evidence-binding", "--keep-reports", "--timeout-ms"]);

export function main(argv: string[]): number {
  const log = (line: string): void => void process.stdout.write(`${line}\n`);
  try {
    for (let i = 0; i < argv.length; i += 1) {
      const flag = argv[i]!;
      if (!KNOWN_FLAGS.has(flag)) fail(`unknown argument ${flag}`);
      if (flag !== "--no-evidence-binding") i += 1;
    }
    const cwdArgument = argument(argv, "--cwd");
    if (!cwdArgument) fail("--cwd is required; the CLI must not inherit an implicit working directory");
    const cwd = resolve(cwdArgument);
    if (!existsSync(cwd) || !statSync(cwd).isDirectory()) fail(`--cwd is not a directory: ${cwd}`);
    const timeout = Number(argument(argv, "--timeout-ms") ?? 600_000);
    if (!Number.isInteger(timeout) || timeout <= 0) fail("--timeout-ms must be a positive integer");
    const keep = argument(argv, "--keep-reports");
    const result = runGate({
      corpus: resolve(argument(argv, "--corpus") ?? DEFAULT_CORPUS),
      cli: resolve(argument(argv, "--cli") ?? join(ROOT, "dist/cli/index.js")),
      cwd,
      noEvidenceBinding: argv.includes("--no-evidence-binding"),
      keepReports: keep ? resolve(keep) : null,
      timeoutMs: timeout,
      log,
    });
    log("");
    for (const line of formatTable(result.verdicts)) log(line);
    log("");
    for (const verdict of result.verdicts) {
      for (const failure of verdict.failures) log(`FAIL ${verdict.id}: ${failure}`);
      for (const note of verdict.notes) log(`note ${verdict.id}: ${note}`);
    }
    const passed = result.verdicts.filter((verdict) => verdict.pass).length;
    const label = argv.includes("--no-evidence-binding") ? " [LOCAL, --no-evidence-binding: not the CI gate]" : "";
    log(`corpus gate: ${result.pass ? "PASS" : "FAIL"}: ${passed}/${result.documentsRead} documents passed${label}`);
    return result.pass ? 0 : 1;
  } catch (error) {
    if (error instanceof GateError) {
      process.stderr.write(`corpus gate: FAIL: ${error.message}\n`);
      return 1;
    }
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
