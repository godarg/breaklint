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
 * WHAT IS FOUND. Six shapes, each a use that needs the name to exist in the realm the file runs in:
 *
 *   `Name.member(` / `Name.member`         a capitalised global and its static or prototype member
 *   `new Name`, `instanceof Name`,          a capitalised global used as a constructor
 *   `extends Name`
 *   `root.member(` / `root.member`          a member of one of the lower-case global objects below
 *   `name(`                                 a bare call of a name the file never binds
 *
 * A capitalised name the file itself declares (`class`, `function`, `const`, `let`, `var`,
 * `import`) is the file's own and is skipped; for bare calls the net of local names is wider
 * (parameters, destructuring, methods), because otherwise every parameter call would be noise.
 * Declarations are matched narrowly on purpose: a net that is too wide hides a real global behind
 * a local of the same name, and a hidden global is the failure this scanner exists to prevent.
 * Noise in the other direction — a name inside a string, shader source, an emscripten local — is
 * cheap: the test classifies it, with a reason, and it can never go unnoticed.
 *
 * WHAT IS NOT FOUND, stated so nobody reads the inventory as more than it is: instance members
 * reached through a value whose type the text does not show (`response.bytes()`, `map.at(1)`,
 * `for await (… of stream)`). Those are the test's watch-list, by pattern.
 */

const KEYWORDS = new Set(
  ("if for while switch catch return typeof function new await yield super import export delete void in of do else " +
    "case throw try finally with class const let var instanceof async get set static").split(" "),
);
const IDENT = /[A-Za-z_$][\w$]*/gu;
/** Lower-case names that are global objects in a window or a worker. */
export const LOWER_CASE_GLOBAL_ROOTS = [
  "globalThis", "self", "window", "document", "navigator", "crypto", "performance", "location", "scheduler",
] as const;

export function platformInventory(source: string): string[] {
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

  const names = new Set<string>();
  for (const m of source.matchAll(/(?<![\w$.#])([A-Z][\w$]*)\.((?:prototype\.)?[A-Za-z_$][\w$]*)(\s*\()?/gu)) {
    if (!bindings.has(m[1]!)) names.add(`${m[1]}.${m[2]}${m[3] ? "()" : ""}`);
  }
  for (const m of source.matchAll(/\b(?:new|instanceof|extends)\s+([A-Z][\w$]*)\b(?!\s*\.)/gu)) {
    if (!bindings.has(m[1]!)) names.add(`new ${m[1]}`);
  }
  const roots = new RegExp(`(?<![\\w$.#])(${LOWER_CASE_GLOBAL_ROOTS.join("|")})\\.([A-Za-z_$][\\w$]*)(\\s*\\()?`, "gu");
  for (const m of source.matchAll(roots)) names.add(`${m[1]}.${m[2]}${m[3] ? "()" : ""}`);
  for (const m of source.matchAll(/(?<![\w$.#])([a-z_$][\w$]*)\s*\(/gu)) {
    const name = m[1]!;
    if (!KEYWORDS.has(name) && !locals.has(name) && !(LOWER_CASE_GLOBAL_ROOTS as readonly string[]).includes(name)) {
      names.add(`${name}()`);
    }
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
    { pattern: /^self\./u, reason: "self is an arrow-function parameter (self => …) in this file" },
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
];

/** What the classification says the run-time check must cover for one file, sorted. */
export function requiredFor(file: PdfjsFile, source: string): { required: string[]; staleRules: string[] } {
  const inventory = platformInventory(source);
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
