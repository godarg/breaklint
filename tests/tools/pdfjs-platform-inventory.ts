/**
 * Which platform names a JavaScript build reaches from the global scope, found by scanning it.
 *
 * This is the scanner behind `tests/unit/rasterizer-capabilities.test.ts`. It exists because a
 * hand-kept list of "recent built-ins" missed a whole class once: it covered the ECMAScript
 * additions the pinned pdfjs build calls and none of the web APIs (`URL.parse`,
 * `Response.prototype.bytes`, `AbortSignal.any`, async iteration of a `ReadableStream`). A list
 * someone remembers to extend is the thing that failed; an inventory that changes whenever the
 * build does is the replacement, because every new name in it has to be classified before the
 * suite passes again.
 *
 * WHAT IS FOUND. These shapes, each a use that needs the name to exist in the realm the file
 * runs in, and nothing else:
 *
 *   `Name.member(` / `Name.member`         a capitalised global and its static or prototype member
 *   `new Name`, `instanceof Name`,          a capitalised global used as a constructor
 *   `extends Name`
 *   `root.member(` / `root.member`          a member of a lower-case global object: the fixed
 *                                           roots below, plus every object the realm's platform
 *                                           declares that the file does not bind itself
 *   `name(`                                 a bare call of a function the realm's platform
 *                                           declares (see `platformGlobals`), even where the file
 *                                           also binds that name - or of a name it never binds
 *   instance members, by pattern            `INSTANCE_MEMBER_WATCH` below
 *
 * A capitalised name the file itself declares (`class`, `function`, `const`, `let`, `var`,
 * `import`) is the file's own and is skipped; for bare calls of undeclared names the net of local
 * names is wider (parameters, destructuring, methods), because otherwise every parameter call
 * would be noise, and a method definition is never a call. Declarations are matched narrowly on
 * purpose: a net that is too wide hides a real global behind a local of the same name, and a hidden
 * global is the failure this scanner exists to prevent - it happened to the global `fetch()`,
 * which pdfjs's own `fetch(…)` methods hid until bare calls were resolved against the realm's
 * declared globals. Noise in the other direction - a name inside a string, shader source, an
 * emscripten local - is cheap: the test classifies it, with a reason, and it can never go
 * unnoticed.
 *
 * WHAT IS NOT FOUND, stated so nobody reads the inventory as more than it is: an instance member
 * reached through a value whose type the text does not show and that is not on the pattern list
 * (older ones such as `replaceAll` or `flatMap` are deliberately not on it), and a bare global that
 * TypeScript's library files do not declare and that the file also binds locally.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const KEYWORDS = new Set(
  ("if for while switch catch return typeof function new await yield super import export delete void in of do else " +
    "case throw try finally with class const let var instanceof async get set static").split(" "),
);
const IDENT = /[A-Za-z_$][\w$]*/gu;
/** Lower-case names that are global objects in a window or a worker, counted even when shadowed. */
export const LOWER_CASE_GLOBAL_ROOTS = [
  "globalThis", "self", "window", "document", "navigator", "crypto", "performance", "location", "scheduler", "console",
] as const;

export type Realm = "page" | "worker";

/**
 * The global names a realm's platform declares, as TypeScript's own library declarations name
 * them (`declare var|let|const|function|namespace` in `lib.es*.d.ts` and `lib.esnext*.d.ts`, plus
 * `lib.dom*.d.ts` for the page or `lib.webworker*.d.ts` for the worker). TypeScript is pinned
 * exactly in package.json, so this set is reproducible without a browser. It resolves the bare
 * calls a file-wide local-name filter would hide: pdfjs defines methods called `fetch(…)`, and
 * the filter, which cannot see scopes, then dropped the global `fetch()` the same files call.
 */
export function platformGlobals(realm: Realm, typescriptLib: string): Map<string, "function" | "value"> {
  const files = readdirSync(typescriptLib).filter((name) =>
    /^lib\.(?:es\d{4}|es5|es6|esnext|decorators)(?:\.[\w.]+)?\.d\.ts$/u.test(name) ||
    (realm === "page" ? /^lib\.dom(?:\.[\w]+)?\.d\.ts$/u : /^lib\.webworker(?:\.[\w]+)?\.d\.ts$/u).test(name));
  const names = new Map<string, "function" | "value">();
  for (const file of files) {
    for (const m of readFileSync(join(typescriptLib, file), "utf8").matchAll(/^declare (var|let|const|function|namespace) ([A-Za-z_$][\w$]*)/gmu)) {
      if (m[1] === "function") names.set(m[2]!, "function");
      else if (!names.has(m[2]!)) names.set(m[2]!, "value");
    }
  }
  return names;
}

/**
 * The inventory of one file. `globals`, when given, is the realm's platform global set
 * (`platformGlobals`): a bare call of such a name is counted even where the file also binds that
 * name locally, which over-counts harmlessly (the name exists) instead of hiding a real global; a
 * lower-case global object the file does not bind is used as a member root too.
 */
export function platformInventory(source: string, globals: ReadonlyMap<string, "function" | "value"> = new Map()): string[] {
  const bindings = new Set<string>();
  for (const m of source.matchAll(/\b(?:class|function\*?|const|let|var)\s+([A-Za-z_$][\w$]*)/gu)) bindings.add(m[1]!);
  for (const m of source.matchAll(/\bimport\s*\{([^}]*)\}/gu)) {
    for (const entry of m[1]!.split(",")) {
      const name = entry.trim().split(/\s+as\s+/u).pop();
      if (name) bindings.add(name);
    }
  }
  for (const m of source.matchAll(/\bimport\s*\*\s*as\s+([A-Za-z_$][\w$]*)/gu)) bindings.add(m[1]!);

  const locals = new Set(bindings);
  const addAll = (text: string): void => {
    for (const n of text.matchAll(IDENT)) locals.add(n[0]);
  };
  for (const m of source.matchAll(/\b(?:const|let|var)\s*[{[]([^}\]]*)[}\]]/gu)) addAll(m[1]!);
  for (const m of source.matchAll(/\bfunction\s*\*?\s*[\w$]*\s*\(([^)]*)\)/gu)) addAll(m[1]!);
  for (const m of source.matchAll(/\(([^()]*)\)\s*=>/gu)) addAll(m[1]!);
  for (const m of source.matchAll(/\b([A-Za-z_$][\w$]*)\s*=>/gu)) locals.add(m[1]!);
  for (const m of source.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)\s*\)/gu)) locals.add(m[1]!);
  for (const m of source.matchAll(/^\s*(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+|\*\s*)?#?([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/gmu)) {
    if (KEYWORDS.has(m[1]!)) continue;
    locals.add(m[1]!);
    addAll(m[2]!);
  }

  // A method definition (`  fetch(ref) {` at the start of a line) is not a call.
  const methodDefinitions = new Set<number>();
  for (const m of source.matchAll(/^\s*(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+|\*\s*)?#?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gmu)) {
    methodDefinitions.add(m.index! + m[0].indexOf(m[1]!));
  }

  const names = new Set<string>();
  for (const m of source.matchAll(/(?<![\w$.#])([A-Z][\w$]*)\.((?:prototype\.)?[A-Za-z_$][\w$]*)(\s*\()?/gu)) {
    if (!bindings.has(m[1]!)) names.add(`${m[1]}.${m[2]}${m[3] ? "()" : ""}`);
  }
  for (const m of source.matchAll(/\b(?:new|instanceof|extends)\s+([A-Z][\w$]*)\b(?!\s*\.)/gu)) {
    if (!bindings.has(m[1]!)) names.add(`new ${m[1]}`);
  }
  const rootNames = new Set<string>(LOWER_CASE_GLOBAL_ROOTS);
  for (const [name, kind] of globals) if (kind === "value" && /^[a-z]/u.test(name) && !locals.has(name)) rootNames.add(name);
  const roots = new RegExp(`(?<![\\w$.#])(${[...rootNames].join("|")})\\.([A-Za-z_$][\\w$]*)(\\s*\\()?`, "gu");
  for (const m of source.matchAll(roots)) names.add(`${m[1]}.${m[2]}${m[3] ? "()" : ""}`);
  for (const m of source.matchAll(/(?<![\w$.#])([a-z_$][\w$]*)\s*\(/gu)) {
    const name = m[1]!;
    if (KEYWORDS.has(name) || (LOWER_CASE_GLOBAL_ROOTS as readonly string[]).includes(name) || methodDefinitions.has(m.index!)) continue;
    if (globals.get(name) === "function" || !locals.has(name)) names.add(`${name}()`);
  }
  return [...names].sort();
}

export type PdfjsFile = "pdf.mjs" | "pdf.worker.mjs";
/** Where each file of the pinned build runs: the rasteriser page imports one, its worker the other. */
export const REALM_OF: Record<PdfjsFile, "page" | "worker"> = { "pdf.mjs": "page", "pdf.worker.mjs": "worker" };

/**
 * Inventory names the run-time check does NOT cover, for `pdfjs-dist` 6.2.108, each with the
 * reason read at the use site. Everything the scan finds that is not here is checked. A rule with
 * `names` must match names the scan still finds; a `pattern` covers a whole family of noise.
 *
 * "Feature-tested" means every use sits behind an explicit test of the name itself (`typeof`,
 * optional chaining, an `||` fallback, pdfjs's own `FeatureTest`, a Node-only branch). A use that
 * is merely inside `try` is NOT counted as tested: absence would still change what pdfjs does, so
 * such names are checked, which is conservative because every one of them exists in every
 * browser measured here.
 */
export interface NotChecked {
  names?: readonly string[];
  pattern?: RegExp;
  reason: string;
  /**
   * For an instance member the watch-list would otherwise require: the exemption holds only while
   * the file has exactly this many matches of the pattern, so a new use elsewhere is reviewed.
   */
  whileMatches?: { pattern: RegExp; count: number };
}

export const NOT_CHECKED: Record<PdfjsFile, readonly NotChecked[]> = {
  "pdf.mjs": [
    {
      names: ["Blob.prototype.bytes()"],
      reason: "both .bytes() calls in this file are on a Response (fetch's, and new Response(cs.readable))",
      whileMatches: { pattern: /\.bytes\(\)/gu, count: 2 },
    },
    { names: ["CSS.supports()"], reason: "feature-tested: typeof CSS !== \"undefined\"" },
    { names: ["crypto.randomUUID", "crypto.randomUUID()"], reason: "feature-tested: typeof crypto.randomUUID === \"function\"" },
    { names: ["new Float16Array"], reason: "feature-tested: FeatureTest.isFloat16ArraySupported" },
    { names: ["navigator.gpu", "GPUBufferUsage.COPY_DST", "GPUBufferUsage.UNIFORM", "GPUBufferUsage.VERTEX"], reason: "WebGPU path, entered only after globalThis.navigator?.gpu" },
    { names: ["new Buffer", "Readable.toWeb()"], reason: "Node.js-only branch (isNodeJS / process.getBuiltinModule)" },
    { names: ["window.clipboardData"], reason: "fallback: event.clipboardData || window.clipboardData" },
    {
      names: ["globalThis.CSSStyleSheet", "globalThis.FontInspector", "globalThis.ImageBitmap", "globalThis.Stats", "globalThis.StepperManager", "globalThis.devicePixelRatio", "globalThis.navigator", "globalThis.pdfjsWorker"],
      reason: "optional read: ?., ||, or a typeof test on the value read",
    },
    { names: ["globalThis._pdfjsTestingUtils", "globalThis.pdfjsLib"], reason: "assignment by pdfjs, not a use" },
    { names: ["Iterator.prototype.join"], reason: "pdfjs installs join when it is absent; the test itself needs Iterator.prototype, which is checked" },
    { names: ["Node.js", "document.pdf"], reason: "text inside a string" },
    { names: ["binding()", "builtin()", "fs_main()", "vs_main()"], reason: "WGSL shader source inside a template string" },
    { names: ["calc()", "grayscale()", "mix()", "preserveAspectRatio()", "round()"], reason: "CSS or SVG fragment inside a string" },
    { names: ["http()"], reason: "a URL inside the licence comment" },
    { names: ["checker()", "rescaleFn()", "RGB.every()", "WorkerMessageHandler.setup()"], reason: "local binding the narrow declaration scan does not see (parameter, let, destructured value)" },
    { names: ["blur()"], reason: "text inside a string: the CSS value blur(1px) in a CSS.supports() probe" },
    { pattern: /^self\./u, reason: "self is a local in this file: const self = this, and arrow-function parameters (self => …)" },
  ],
  "pdf.worker.mjs": [
    { names: ["CSS.supports()"], reason: "feature-tested: typeof CSS !== \"undefined\"" },
    { names: ["crypto.randomUUID", "crypto.randomUUID()"], reason: "feature-tested: typeof crypto.randomUUID === \"function\"" },
    { names: ["new Float16Array"], reason: "feature-tested: FeatureTest.isFloat16ArraySupported" },
    { names: ["ImageDecoder.isTypeSupported()", "new ImageDecoder"], reason: "feature-tested: FeatureTest.isImageDecoderSupported" },
    { names: ["WebAssembly.instantiateStreaming", "WebAssembly.instantiateStreaming()"], reason: "feature-tested: typeof WebAssembly.instantiateStreaming === 'function'" },
    { names: ["new Request"], reason: "feature-tested: typeof Request === 'function'" },
    { names: ["globalThis.TextDecoder", "globalThis.navigator"], reason: "optional read: && or ?." },
    { names: ["globalThis.pdfjsWorker"], reason: "assignment by pdfjs, not a use" },
    { names: ["self.postMessage"], reason: "feature-tested: typeof self.postMessage === \"function\"" },
    { names: ["Iterator.prototype.join"], reason: "pdfjs installs join when it is absent; the test itself needs Iterator.prototype, which is checked" },
    { names: ["Math.Infinity", "Math.NaN"], reason: "a property no engine defines; pdfjs reads undefined there in every browser" },
    { names: ["PDF.js", "crypto.js", "document.js", "window.open"], reason: "text inside a string or a module-path comment" },
    { pattern: /^(?:Bold|BoldItalic|Italic|Regular)\.ttf$|^Foxit\w+\.pfb$/u, reason: "a font file name inside a string" },
    { names: ["$()", "_p()", "fIkqpp()", "qjswjlm()", "wbsfgfnlj()", "x7F_p()", "x84()"], reason: "text inside an encoded dictionary string" },
    { names: ["be()", "blur()", "calc()", "exit()", "gradient()", "marker()", "scaleY()"], reason: "text inside a string (message, CSS or style mapping)" },
    { names: ["__emscripten_timeout()", "getRgb()", "getTextContent()", "itemDecode()", "itemEncode()", "document.getPage()", "document.numPages"], reason: "local binding the narrow declaration scan does not see (var list, method, a PDF document parameter named document)" },
    { pattern: /^CCITTOptions\./u, reason: "a parameter object of the CCITT decoder" },
    { names: ["close()"], reason: "the Brotli decoder's own function close(s); the worker's global close() is never called" },
    { pattern: /^self\.(?!postMessage$)/u, reason: "self is a local alias (const self = this) in this file" },
  ],
};

/** Names a classified use implies instead of itself. */
export const IMPLIED: Record<string, string> = { "Iterator.prototype.join": "Iterator.prototype" };

/**
 * Instance members, found by pattern because the scan cannot see the receiver's type. The list is
 * ECMAScript 2022 and later plus the web members of the same period; older instance members
 * (`replaceAll`, `flatMap`, `padStart` …) are not checked. Each match makes every receiver checked
 * in the realm of the file it was found in; where one pattern can reach several receivers, all of
 * them are checked, which is conservative.
 */
export const INSTANCE_MEMBER_WATCH: readonly { pattern: RegExp; receivers: readonly string[] }[] = [
  { pattern: /\.getOrInsert\(/gu, receivers: ["Map.prototype.getOrInsert()"] },
  { pattern: /\.getOrInsertComputed\(/gu, receivers: ["Map.prototype.getOrInsertComputed()", "WeakMap.prototype.getOrInsertComputed()"] },
  { pattern: /\.at\(/gu, receivers: ["Array.prototype.at()", "String.prototype.at()", "Uint8Array.prototype.at()"] },
  { pattern: /\.findLast\(/gu, receivers: ["Array.prototype.findLast()"] },
  { pattern: /\.findLastIndex\(/gu, receivers: ["Array.prototype.findLastIndex()"] },
  { pattern: /\.toSorted\(/gu, receivers: ["Array.prototype.toSorted()"] },
  { pattern: /\.toReversed\(/gu, receivers: ["Array.prototype.toReversed()"] },
  { pattern: /\.toSpliced\(/gu, receivers: ["Array.prototype.toSpliced()"] },
  { pattern: /\.with\(/gu, receivers: ["Array.prototype.with()"] },
  { pattern: /\.isWellFormed\(/gu, receivers: ["String.prototype.isWellFormed()"] },
  { pattern: /\.toWellFormed\(/gu, receivers: ["String.prototype.toWellFormed()"] },
  { pattern: /\.toBase64\(/gu, receivers: ["Uint8Array.prototype.toBase64()"] },
  { pattern: /\.toHex\(\)/gu, receivers: ["Uint8Array.prototype.toHex()"] },
  { pattern: /\.setFromBase64\(/gu, receivers: ["Uint8Array.prototype.setFromBase64()"] },
  { pattern: /\.setFromHex\(/gu, receivers: ["Uint8Array.prototype.setFromHex()"] },
  { pattern: /\.transferToFixedLength\(/gu, receivers: ["ArrayBuffer.prototype.transferToFixedLength()"] },
  { pattern: /\.transfer\(/gu, receivers: ["ArrayBuffer.prototype.transfer()"] },
  { pattern: /\.intersection\(/gu, receivers: ["Set.prototype.intersection()"] },
  { pattern: /\.union\(/gu, receivers: ["Set.prototype.union()"] },
  { pattern: /\.difference\(/gu, receivers: ["Set.prototype.difference()"] },
  { pattern: /\.symmetricDifference\(/gu, receivers: ["Set.prototype.symmetricDifference()"] },
  { pattern: /\.isSubsetOf\(/gu, receivers: ["Set.prototype.isSubsetOf()"] },
  { pattern: /\.isSupersetOf\(/gu, receivers: ["Set.prototype.isSupersetOf()"] },
  { pattern: /\.isDisjointFrom\(/gu, receivers: ["Set.prototype.isDisjointFrom()"] },
  { pattern: /\.bytes\(\)/gu, receivers: ["Response.prototype.bytes()", "Blob.prototype.bytes()"] },
  { pattern: /\bfor\s+await\s*\(/gu, receivers: ["ReadableStream.prototype[Symbol.asyncIterator]()"] },
  { pattern: /\.throwIfAborted\(/gu, receivers: ["AbortSignal.prototype.throwIfAborted()"] },
  // Iterator helpers (ES2025), where the receiver is visibly an iterator: a method chained onto
  // keys()/values()/entries(), and toArray(), which arrays do not have.
  ...["map", "filter", "take", "drop", "flatMap", "reduce", "forEach", "some", "every", "find"].map((helper) => ({
    pattern: new RegExp(`\\.(?:keys|values|entries)\\(\\)\\s*\\.${helper}\\(`, "gu"),
    receivers: [`Iterator.prototype.${helper}()`],
  })),
  { pattern: /\.toArray\(\)/gu, receivers: ["Iterator.prototype.toArray()"] },
];

/** What the classification says the run-time check must cover for one file, sorted. */
export function requiredFor(
  file: PdfjsFile,
  source: string,
  globals: ReadonlyMap<string, "function" | "value">,
): { required: string[]; staleRules: string[] } {
  const inventory = platformInventory(source, globals);
  const rules = NOT_CHECKED[file];
  const used = new Set<object>();
  const required = new Set<string>();
  for (const name of inventory) {
    const rule = rules.find((candidate) => candidate.names?.includes(name) || candidate.pattern?.test(name));
    if (rule) used.add(rule);
    const implied = IMPLIED[name];
    if (implied) required.add(implied);
    else if (!rule) required.add(name);
  }
  const watched = new Set<string>();
  for (const { pattern, receivers } of INSTANCE_MEMBER_WATCH) {
    if ((source.match(pattern)?.length ?? 0) > 0) for (const receiver of receivers) watched.add(receiver);
  }
  const staleRules: string[] = [];
  for (const receiver of watched) {
    const rule = rules.find((candidate) => candidate.whileMatches && candidate.names?.includes(receiver));
    if (!rule) {
      required.add(receiver);
      continue;
    }
    used.add(rule);
    const count = source.match(rule.whileMatches!.pattern)?.length ?? 0;
    if (count !== rule.whileMatches!.count) {
      staleRules.push(`${receiver}: exempt while ${String(rule.whileMatches!.pattern)} matches ${rule.whileMatches!.count}x, now ${count}x (${rule.reason})`);
      required.add(receiver);
    }
  }
  for (const rule of rules) {
    if (rule.whileMatches) {
      if (!used.has(rule)) staleRules.push(`${(rule.names ?? []).join(", ")}: no longer watched (${rule.reason})`);
      continue;
    }
    for (const name of rule.names ?? []) if (!inventory.includes(name)) staleRules.push(`${name} (${rule.reason})`);
    if (rule.pattern && !used.has(rule)) staleRules.push(`${String(rule.pattern)} (${rule.reason})`);
  }
  return { required: [...required].sort(), staleRules };
}
