/**
 * The live path: one browser, one measured paginator, one snapshot seam and one evidence path.
 *
 * Every document is navigated to a loopback origin. `setContent()` is not an equivalent shortcut:
 * it does not run the on-new-document primitive capture, and `file://` withholds the CSSOM that the
 * non-normative cascade hint needs. Unexpected failures at the browser/driver boundary become a
 * real `checker-crashed` event; that replaces the old hard-coded "not built" event and preserves
 * the exit-3 matrix branch for an actual process failure.
 */

import { createServer, type Server } from "node:http";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, posix, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse, type DefaultTreeAdapterMap } from "parse5";

import {
  launchBrowser,
  captureProcessTreeOwnership,
  ownServerLifecycle,
  resolvePackageRoot,
  terminateProcessTree,
  type BrowserLike,
  type BrowserContextLike,
  type CdpSessionLike,
  type PageLike,
  type RequestLike,
  type ResponseLike,
} from "./browser.ts";
import { IS, SUPPORTED_PAGEDJS_VERSION } from "../core/enums.ts";
import { measureCapturedFontIdentity, prepareCapturedFontIdentity, releaseCapturedFontIdentity } from "../source/font-identity.ts";
import { sha256Short } from "../core/fingerprint.ts";
import type { DocumentInput } from "../core/engine.ts";
import type { BreakCauseCascadeHint } from "../core/enums.ts";
import type { InfraEvent, ReportEnvironment, ResourceRecord, SourceRef } from "../core/types.ts";
import {
  compareGeometry, crossCheckEvent, crossCheckPassedEvent, CROSS_CHECK_SAMPLE_SIZE,
  CROSS_CHECK_TOLERANCE_PX, geometrySampleSource, quadEnvelope,
  type GeometrySample, type GeometrySampleBatch,
} from "../measure/cross-check.ts";
import {
  fragmentainerResidue,
  residueDetail,
  type FragmentainerReport,
} from "../measure/fragmentainer.ts";
import {
  awaitStableLayout,
  componentDeltas,
  composeSignature,
  driftedComponents,
  DOCUMENT_TIMEOUT_MS,
  freezeSource,
  MAX_DOM_NODES,
  MAX_MUTATIONS_AFTER_RENDERED,
  MAX_PAGES,
  MAX_RESOURCE_BYTES,
  PAGINATION_TIMEOUT_MS,
  sampleParts,
} from "../measure/freeze.ts";
import {
  PRIMITIVES_CHECK,
  TEST_PRIMITIVES_CAPABILITY,
  primitivesSource,
  type PrimitivesStatus,
} from "../measure/primitives.ts";
import {
  assembleSnapshot,
  buildSourceModel,
  compareControlSignatures,
  CONTROL_SIGNATURE_SOURCE,
  inputIdentity,
  SNAPSHOT_SOURCE,
  validateInjectedProvenance,
  validateSnapshotInvariants,
  type ControlSignature,
  type RawSnapshot,
} from "../measure/snapshot.ts";
import { boundaryFactsFrom, collectorSource, silentHooks, type CollectorResult } from "../paginate/collector.ts";
import { assignPageCauses } from "../paginate/breaks.ts";
import { produceEvidence, type EvidenceOutcome } from "../render/evidence.ts";
import { openRasterizer, type OpenRasterizerResult } from "../render/rasterizer.ts";
import { collisionDetail, detectCollision, type CollisionSource } from "../source/collision.ts";
import { injectSourceIds } from "../source/inject.ts";
import { captureBoundedSourceFile, decodeUtf8Strict, StrictUtf8Error } from "../source/bytes.ts";
import { closeRendererOwnedResourcesBounded } from "./renderer-cleanup.ts";

export interface RenderOptions {
  outDir: string;
  evidenceBinding: boolean;
  sourceMapInjection: boolean;
  network: { mode: "offline" | "allowlist"; allowed: string[] };
  locale: string;
}

export interface RenderEnvironment extends ReportEnvironment {
  networkBlocked: number;
}

export interface RenderResult {
  documents: DocumentInput[];
  fatal: { message: string; exitCode: 2 | 3 } | null;
  environment: RenderEnvironment | null;
}

/** Internal virtual input: every byte was captured by the producer before this renderer starts. */
export interface CapturedRenderInput {
  path: string;
  html: Buffer;
  assets: ReadonlyMap<string, { bytes: Buffer; logicalPath: string }>;
  sourceRefForOutput?: (start: number, end: number) => SourceRef | null;
  sourceFiles?: readonly { file: string; sha256: string; byteLength: number; role: "authoring" | "dependency" | "asset" }[];
  producer?: { id: string; receiptHash: string; codeSha256: string; optionsSha256: string };
}

export interface CapturedResourceInput {
  /** Producer-record logical input path, never a host filesystem path. */
  logicalPath: string;
  bytes: Buffer;
  role: "dependency" | "asset";
}

/** A produced document named a local resource that the current producer did not capture. */
export class CapturedResourceClosureError extends Error {}

export interface RenderDependencies {
  launchBrowser: typeof launchBrowser;
  openRasterizer: typeof openRasterizer;
  /** Test seam for the provenance corruption red condition; production always uses the parser injector. */
  injectSourceIds?: typeof injectSourceIds;
  /** Unit-only timing seam. Production dependencies omit it and remain fixed at §13.3's 120000 ms. */
  documentTimeoutMs?: number;
  /** Test seam for an unreadable process table; production uses the POSIX verifier above. */
  terminateBrowserProcessTree?: typeof terminateProcessTree;
}

const DEFAULT_DEPENDENCIES: RenderDependencies = { launchBrowser, openRasterizer };
const BROWSER_CLOSE_TIMEOUT_MS = 5_000;

class BoundaryTimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new BoundaryTimeoutError(`${label} timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function closeBrowserBounded(
  browser: BrowserLike,
  terminate: typeof terminateProcessTree = terminateProcessTree,
  captureOwnership: typeof captureProcessTreeOwnership = captureProcessTreeOwnership,
): Promise<string | null> {
  let pid: number | undefined;
  let processHandleError: string | null = null;
  let ownership = null;
  try {
    pid = browser.process?.()?.pid;
    if (pid) ownership = captureOwnership(pid);
  } catch (error) {
    processHandleError = error instanceof Error ? error.message : String(error);
  }
  let closeError: string | null = null;
  try {
    await withTimeout(browser.close(), BROWSER_CLOSE_TIMEOUT_MS, "browser.close");
  } catch (error) {
    closeError = error instanceof Error ? error.message : String(error);
  }
  if (processHandleError) return `${closeError ? `${closeError}; ` : ""}browser.process failed: ${processHandleError}`;
  if (!pid) return `${closeError ? `${closeError}; ` : ""}PID verification unavailable`;
  // A resolved CDP close is a request acknowledgement, not process-tree evidence. Always perform
  // the fresh §13.3 process-table verification; terminateProcessTree is a no-op signal-wise when
  // the root and descendants are already gone.
  const termination = await terminate(pid, undefined, undefined, ownership);
  // A post-close table cannot prove ownership of a child reparented after the browser root left.
  // Signal/verify whatever is still observable, but never turn a missing pre-close snapshot into
  // a clean cleanup result.
  if (!ownership) {
    return `${closeError ? `${closeError}; ` : ""}process termination FAILED (pre-close process ownership unavailable)`;
  }
  if (termination.verified) return null;
  return (
    `${closeError ? `${closeError}; ` : ""}process termination FAILED ` +
    `(pgid=${termination.pgid ?? "unknown"}, groupSafe=${termination.groupSafe}, ` +
    `initial=${termination.initialPids.join(",")}, survivors=${termination.survivingPids.join(",") || "none"})`
  );
}

export async function closeRasterizerBounded(rasterizer: OpenRasterizerResult["rasterizer"]): Promise<string | null> {
  if (!rasterizer) return null;
  try {
    await withTimeout(rasterizer.close(), BROWSER_CLOSE_TIMEOUT_MS, "rasterizer.close");
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function cleanupBrowserProfile(path: string | null | undefined): string | null {
  if (!path) return null;
  if (!existsSync(path)) return null;
  let tempRoot: string;
  let realProfile: string;
  try {
    tempRoot = realpathSync(tmpdir());
    realProfile = realpathSync(path);
  } catch (error) {
    return `profile realpath failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  const rel = relative(tempRoot, realProfile);
  if (dirname(realProfile) !== tempRoot || !basename(realProfile).startsWith("breaklint-chrome-profile-") || rel.includes(sep)) {
    return `refused to remove an unowned profile path: ${path}`;
  }
  try {
    rmSync(realProfile, { recursive: true, force: true });
  } catch (error) {
    return `profile removal threw: ${error instanceof Error ? error.message : String(error)}`;
  }
  return existsSync(realProfile) ? `profile still exists after removal: ${realProfile}` : null;
}

/** The exact Paged.js artefact that will be loaded, with an unoverrideable version gate. */
export function resolvePagedjs(fromDir: string): {
  ok: boolean;
  version: string | null;
  path: string | null;
  detail: string;
} {
  const packageRoot = resolvePackageRoot("pagedjs", fromDir);
  if (packageRoot === null) {
    return {
      ok: false,
      version: null,
      path: null,
      detail:
        "breaklint: paged.js is not installed.\n" +
        `  install: npm i -D pagedjs@${SUPPORTED_PAGEDJS_VERSION}`,
    };
  }
  const pkgFile = join(packageRoot, "package.json");
  if (!existsSync(pkgFile)) {
    return { ok: false, version: null, path: packageRoot, detail: `breaklint: ${pkgFile} not readable.` };
  }
  const pkg = JSON.parse(readFileSync(pkgFile, "utf8")) as { version?: string; browser?: string; main?: string };
  const version = pkg.version ?? null;
  const bundle = pkg.browser ?? pkg.main ?? null;
  const bundlePath = bundle ? join(packageRoot, bundle) : null;
  if (version !== SUPPORTED_PAGEDJS_VERSION) {
    return {
      ok: false,
      version,
      path: bundlePath,
      detail:
        `breaklint: paged.js ${version ?? "unknown"} resolved, but this release is measured ` +
        `against exactly ${SUPPORTED_PAGEDJS_VERSION}.\n` +
        "  The break cause is read from attributes the paginator writes and does not guarantee " +
        "as an interface. A report from an unmeasured version would state things nobody measured.\n" +
        `  install: npm i -D pagedjs@${SUPPORTED_PAGEDJS_VERSION}\n` +
        "  There is no flag that overrides this.",
    };
  }
  return { ok: true, version, path: bundlePath, detail: "" };
}

interface ServedDocument {
  server: Server;
  origin: string;
  documentRoute: string;
  resources: ResourceRecord[];
  /** Actual loopback route, kept separately from the public file/artifact identity. */
  resourceRoutes: ReadonlyMap<ResourceRecord, string>;
  select(variant: "injected" | "control"): void;
  close(): Promise<void>;
}

const MIME: Readonly<Record<string, string>> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export function withPagination(html: string, pagedjs: string, collector: boolean): string {
  const harness =
    `<script>if ("Paged" in window) throw new Error("Paged was defined before the measured bundle");</script>\n` +
    `<script>${pagedjs}</script>\n` +
    `<script>window.__blPrimitives.capturePaged(Paged);</script>\n`;
  void collector; // Collector and Previewer guards are installed over CDP, never in author-readable HTML.
  const document = parse(html, { sourceCodeLocationInfo: true });
  let insertion = -1;
  const walk = (node: ParsedNode): void => {
    if (parsedElement(node) && node.tagName.toLowerCase() === "body") {
      const location = node.sourceCodeLocation as { endTag?: { startOffset: number } } | undefined;
      if (location?.endTag) insertion = location.endTag.startOffset;
    }
    for (const child of (node as { childNodes?: ParsedNode[] }).childNodes ?? []) walk(child);
  };
  walk(document);
  return insertion < 0 ? `${html}${harness}` : `${html.slice(0, insertion)}${harness}${html.slice(insertion)}`;
}

/**
 * Installs the measured paginator after the authored document has loaded.
 *
 * The old production path appended inline script tags to the authored HTML. A document-level CSP
 * correctly blocks those tags, which made breaklint unable to check its own script-free report.
 * Disabling CSP would also execute author scripts the document intentionally blocked and therefore
 * change the thing being measured. CDP evaluation is the narrower boundary: author loading keeps
 * its original CSP semantics; only the tool-owned, already-read bundle crosses the driver bridge.
 */
export function paginationBundleSource(pagedjs: string): string {
  return `if ("Paged" in window) throw new Error("Paged was defined before the measured bundle");\n` +
    `${pagedjs}\n` +
    `window.__blPrimitives.capturePaged(Paged);`;
}

async function serveDocument(input: {
  injectedHtml: string;
  controlHtml: string;
  assets: ReadonlyMap<string, CapturedAsset>;
  documentRoot: string;
  blocked: { count: number };
  /** Captured producer inputs have logical artifact identities, never fictional host file URIs. */
  resourceScheme?: "artifact";
  /** The public virtual route for the selected HTML. It preserves relative URL resolution. */
  documentRoute?: string;
}): Promise<ServedDocument> {
  const resources: ResourceRecord[] = [];
  const resourceRoutes = new Map<ResourceRecord, string>();
  const record = (pathname: string, resource: ResourceRecord): void => {
    resources.push(resource);
    resourceRoutes.set(resource, pathname);
  };
  let selected: "injected" | "control" | null = null;
  const recordLocal = (pathname: string, candidate: string | null, status: number, body: Buffer | null): void => {
    if (input.resourceScheme === "artifact") {
      const requestedUri = `artifact:${pathname}`;
      const resolvedUri = candidate ? `artifact:${candidate.startsWith("/") ? candidate : `/${candidate}`}` : requestedUri;
      record(pathname, {
        requestedUri,
        resolvedUri,
        scheme: "artifact",
        origin: "artifact://",
        status,
        bytes: body?.length ?? 0,
        sha256: body ? createHash("sha256").update(body).digest("hex") : null,
        outcome: status >= 200 && status < 400 ? "loaded" : status === 403 ? "blocked" : "failed",
      });
      return;
    }
    const lexical = resolve(input.documentRoot, `.${pathname}`);
    record(pathname, {
      requestedUri: pathToFileURL(lexical).href,
      resolvedUri: candidate ? pathToFileURL(candidate).href : pathToFileURL(lexical).href,
      scheme: "file",
      origin: "file://",
      status,
      bytes: body?.length ?? 0,
      sha256: body ? createHash("sha256").update(body).digest("hex") : null,
      outcome: status >= 200 && status < 400 ? "loaded" : status === 403 ? "blocked" : "failed",
    });
  };
  const server = createServer((req, res) => {
    const raw = req.url?.split("?", 1)[0] ?? "/";
    if (raw === (input.documentRoute ?? "/document.html")) {
      if (selected === null) { res.writeHead(503).end(); return; }
      const body = selected === "injected" ? input.injectedHtml : input.controlHtml;
      res.writeHead(200, { "content-type": MIME[".html"], "content-length": Buffer.byteLength(body) }).end(body);
      return;
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(raw);
    } catch {
      res.writeHead(400).end();
      return;
    }
    const asset = input.assets.get(pathname);
    if (!asset) {
      input.blocked.count += 1;
      recordLocal(pathname, null, 403, null);
      res.writeHead(403).end();
      return;
    }
    try {
      const body = asset.bytes;
      recordLocal(pathname, asset.real, 200, body);
      res.writeHead(200, {
        "content-type": MIME[extname(asset.real).toLowerCase()] ?? "application/octet-stream",
        "content-length": body.length,
      }).end(body);
    } catch {
      recordLocal(pathname, asset?.real ?? null, 404, null);
      res.writeHead(404).end();
    }
  });
  const lifecycle = ownServerLifecycle(server);
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address() as AddressInfo;
  return {
    server,
    origin: `http://127.0.0.1:${address.port}`,
    documentRoute: input.documentRoute ?? "/document.html",
    resources,
    resourceRoutes,
    select(variant) { selected = variant; },
    close: async () => {
      const error = await lifecycle.close();
      if (error) throw new Error(`document loopback cleanup failed: ${error}`);
    },
  };
}

function localReference(raw: string): boolean {
  return raw.length > 0 && !raw.startsWith("#") && !raw.startsWith("//") &&
    !/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(raw);
}

/** Bytes captured during discovery. The loopback server never opens a path after this point. */
interface CapturedAsset {
  real: string;
  bytes: Buffer;
  text: string | null;
}

function captureRegularFile(root: string, relativePath: string, maxBytes: number): Buffer {
  try {
    return captureBoundedSourceFile(root, relativePath, maxBytes, "document resource");
  } catch (error) {
    if (error instanceof Error && /exceeds byte limit|bounded regular file/u.test(error.message)) {
      throw new ResourceLimitError({ maxResourceBytes: maxBytes, resourceBytes: maxBytes + 1, resource: relativePath });
    }
    throw error;
  }
}

class ResourceLimitError extends Error {
  readonly measured: Record<string, unknown>;
  constructor(measured: Record<string, unknown>) {
    super("resource byte limit exceeded");
    this.measured = measured;
  }
}

function resolveLocalReference(realRoot: string, raw: string, from: string): { real: string; route: string } | null {
  const ref = raw.trim().split(/[?#]/u, 1)[0] ?? "";
  if (!localReference(ref)) return null;
  // Keep the lexical components until the bounded reader has lstat'ed every one. Calling
  // realpath here would collapse an in-root symlink before that check and turn it into an
  // apparently ordinary file.
  const candidate = ref.startsWith("/")
    ? resolve(realRoot, `.${ref}`)
    : resolve(dirname(from), ref);
  const lexicalRel = relative(realRoot, candidate);
  if (!lexicalRel || lexicalRel.startsWith("..") || lexicalRel.includes(`..${sep}`)) return null;
  return { real: candidate, route: `/${lexicalRel.split(sep).join("/")}` };
}

type ParsedNode = DefaultTreeAdapterMap["node"];
type ParsedElement = DefaultTreeAdapterMap["element"];

function parsedElement(node: ParsedNode): node is ParsedElement {
  return typeof (node as ParsedElement).tagName === "string";
}

function parsedText(node: ParsedNode): string {
  if ((node as { nodeName?: string }).nodeName === "#text") {
    return (node as unknown as { value: string }).value;
  }
  return ((node as { childNodes?: ParsedNode[] }).childNodes ?? []).map(parsedText).join("");
}

function cssReferences(text: string): string[] {
  const refs: string[] = [];
  // @import "x.css" / 'x.css'. @import url(...) is collected by the url loop exactly once.
  // CSS comments are whitespace, including between `@import` and the quoted URL.
  for (const match of text.matchAll(/@import(?:\s|\/\*[\s\S]*?\*\/)+["']([^"']+)["']/giu)) if (match[1]) refs.push(match[1]);
  for (const match of text.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)'";]+))\s*\)/giu)) {
    const value = match[1] ?? match[2] ?? match[3];
    if (value) refs.push(value);
  }
  return refs;
}

/** References which cause a browser resource fetch, deliberately excluding navigation anchors. */
type HtmlResourceReference = {
  raw: string;
  requiredStylesheet: boolean;
  /** Static root-relative script/style URLs belong to the deployment origin, not necessarily this file tree. */
  deploymentRequiredRole: "stylesheet" | "script" | null;
};

function htmlResourceReferences(html: string): HtmlResourceReference[] {
  const references: HtmlResourceReference[] = [];
  const add = (raw: string, requiredStylesheet = false, deploymentRequiredRole: "stylesheet" | "script" | null = null): void => {
    references.push({ raw, requiredStylesheet, deploymentRequiredRole });
  };
  const document = parse(html);
  const walk = (node: ParsedNode): void => {
    if (parsedElement(node)) {
      const tag = node.tagName.toLowerCase();
      const attrs = Object.fromEntries(node.attrs.map((attr) => [attr.name.toLowerCase(), attr.value]));
      const linkRel = new Set((attrs.rel ?? "").toLowerCase().split(/\s+/u));
      const hrefIsResource = tag === "link" && ["stylesheet", "preload", "modulepreload", "icon", "manifest"].some((rel) => linkRel.has(rel));
      if (attrs.href && (hrefIsResource || tag === "image" || tag === "use")) {
        add(
          attrs.href,
          tag === "link" && linkRel.has("stylesheet"),
          tag === "link" && linkRel.has("stylesheet") ? "stylesheet" :
            (tag === "link" && linkRel.has("modulepreload") ? "script" : null),
        );
      }
      for (const attribute of ["src", "poster", "data"]) if (attrs[attribute]) {
        add(attrs[attribute]!, false, tag === "script" && attribute === "src" ? "script" : null);
      }
      if (attrs.srcset) {
        for (const candidate of attrs.srcset.split(",")) {
          const reference = candidate.trim().split(/\s+/u)[0];
          if (reference) add(reference);
        }
      }
      if (attrs.style) for (const raw of cssReferences(attrs.style)) add(raw);
      if (tag === "style") for (const raw of cssReferences(parsedText(node))) add(raw);
    }
    for (const child of (node as { childNodes?: ParsedNode[] }).childNodes ?? []) walk(child);
  };
  walk(document);
  return references;
}

interface LocalAssetDiscovery {
  assets: Map<string, CapturedAsset>;
  /**
   * Root-relative static script/style URLs can name a web deployment root which is deliberately
   * outside a standalone source artifact. These routes remain blocked and recorded by loopback;
   * they are not represented as missing document-local filesystem inputs.
   */
  externalDeploymentRequiredRoutes: Set<string>;
}

function virtualLogicalReference(fromLogicalPath: string, raw: string): string | null {
  const ref = raw.trim().split(/[?#]/u, 1)[0] ?? "";
  if (!localReference(ref)) return null;
  const absolute = ref.startsWith("/")
    ? posix.normalize(ref)
    : posix.resolve("/", posix.dirname(fromLogicalPath), ref);
  const logical = absolute.slice(1);
  return isSafeVirtualLogicalPath(logical) ? logical : null;
}

function isSafeVirtualLogicalPath(value: string): boolean {
  return value.length > 0 && !value.includes("\\") && !value.includes("\0") &&
    value.split("/").every((part) => part.length > 0 && part !== "." && part !== "..");
}

function virtualHttpRoute(fromRoute: string, raw: string): string | null {
  const ref = raw.trim().split(/[?#]/u, 1)[0] ?? "";
  if (!localReference(ref)) return null;
  try {
    const pathname = new URL(ref, `http://breaklint.invalid${fromRoute}`).pathname;
    return pathname.startsWith("/") ? pathname : null;
  } catch {
    return null;
  }
}

/**
 * Build the exact loopback allowlist for a captured producer output. It shares the document/CSS
 * reference grammar with normal acquisition but never reads a filesystem path: every served byte
 * came from the validated producer record. Authoring leaves cannot become HTTP resources.
 */
export function capturedResourceClosure(
  html: string,
  outputPath: string,
  resources: readonly CapturedResourceInput[],
): Map<string, { bytes: Buffer; logicalPath: string }> {
  if (!isSafeVirtualLogicalPath(outputPath)) throw new CapturedResourceClosureError(`unsafe produced output path: ${outputPath}`);
  const candidates = new Map<string, CapturedResourceInput>();
  for (const resource of resources) {
    if (!isSafeVirtualLogicalPath(resource.logicalPath) || candidates.has(resource.logicalPath)) {
      throw new CapturedResourceClosureError(`invalid duplicate captured resource path: ${resource.logicalPath}`);
    }
    candidates.set(resource.logicalPath, resource);
  }
  const assets = new Map<string, { bytes: Buffer; logicalPath: string }>();
  const visitedCss = new Set<string>();
  const add = (raw: string, fromLogicalPath: string, fromRoute: string): void => {
    const local = raw.trim().split(/[?#]/u, 1)[0] ?? "";
    if (!localReference(local)) return;
    const logicalPath = virtualLogicalReference(fromLogicalPath, raw);
    const route = virtualHttpRoute(fromRoute, raw);
    if (logicalPath === null || route === null) {
      throw new CapturedResourceClosureError(`unsafe local resource reference ${raw} from ${fromLogicalPath}`);
    }
    const resource = candidates.get(logicalPath);
    if (!resource) {
      throw new CapturedResourceClosureError(
        `produced resource ${logicalPath} referenced from ${fromLogicalPath} was not captured as a dependency or asset`,
      );
    }
    const prior = assets.get(route);
    if (prior && prior.logicalPath !== logicalPath) {
      throw new CapturedResourceClosureError(`two captured resources resolve to the same browser route: ${route}`);
    }
    assets.set(route, { bytes: Buffer.from(resource.bytes), logicalPath });
    if (extname(logicalPath).toLowerCase() !== ".css" || visitedCss.has(logicalPath)) return;
    visitedCss.add(logicalPath);
    const css = decodeUtf8Strict(resource.bytes, logicalPath);
    for (const reference of cssReferences(css)) add(reference, logicalPath, route);
  };
  for (const reference of htmlResourceReferences(html)) add(reference.raw, outputPath, `/${outputPath}`);
  return assets;
}

/**
 * The loopback server is an allowlist, not a view of the input directory. Only resources named by
 * the document or by a reachable stylesheet are served; symlinks are resolved before the root
 * check, so a sibling link cannot turn an arbitrary outside file into an allowed resource.
 */
function discoverLocalAssetClosure(html: string, file: string, maxBytes = MAX_RESOURCE_BYTES): LocalAssetDiscovery {
  const root = realpathSync(dirname(resolve(file)));
  const assets = new Map<string, CapturedAsset>();
  const externalDeploymentRequiredRoutes = new Set<string>();
  const visitedCss = new Set<string>();
  const sized = new Set<string>();
  let totalBytes = 0;
  const add = (reference: HtmlResourceReference, from: string): void => {
    const { raw, requiredStylesheet } = reference;
    const resolved = resolveLocalReference(root, raw, from);
    if (!resolved) {
      if (requiredStylesheet && localReference(raw.trim().split(/[?#]/u, 1)[0] ?? "")) {
        throw new Error(`required local resource is absent or outside the document root: ${raw}`);
      }
      return;
    }
    let captured = [...assets.values()].find((asset) => asset.real === resolved.real);
    if (!sized.has(resolved.real)) {
      let bytes: Buffer;
      try { bytes = captureRegularFile(root, resolved.route.slice(1), maxBytes); }
      catch (error) {
        // An absolute path in a static script/style tag is an origin-relative deployment route,
        // not proof that the standalone document tree owns a same-named leaf. This matters for
        // reviewed source artifacts that intentionally omit the deployment's asset bundle. Keep
        // its HTTP 403 in input identity, but do not invent a missing local filesystem input.
        // Relative stylesheets and any dynamic stylesheet request retain the fail-closed path.
        if (
          reference.deploymentRequiredRole !== null && raw.trim().startsWith("/") &&
          (error as NodeJS.ErrnoException).code === "ENOENT"
        ) {
          externalDeploymentRequiredRoutes.add(resolved.route);
          return;
        }
        // A local symlink is an explicit denial, not a fallback to its target. It is omitted
        // from the loopback allowlist and the browser will receive the usual blocked resource.
        if (error instanceof Error && /symlink/u.test(error.message)) {
          if (requiredStylesheet) throw new Error(`required local resource is unsafe: ${raw}`);
          return;
        }
        // Missing non-stylesheet leaves must reach the browser as a typed 403: the font and image
        // barriers decide whether their concrete rendered geometry still permits measurement.
        // A required stylesheet has no equivalent geometry oracle and remains acquisition-fatal.
        if (!requiredStylesheet && (error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      totalBytes += bytes.length;
      sized.add(resolved.real);
      if (totalBytes > maxBytes) {
        throw new ResourceLimitError({ maxResourceBytes: maxBytes, resourceBytes: totalBytes, resource: resolved.real });
      }
      const extension = extname(resolved.real).toLowerCase();
      captured = { real: resolved.real, bytes, text: extension === ".css" ? decodeUtf8Strict(bytes, resolved.real) : null };
    }
    if (!captured) throw new Error(`captured asset was lost: ${resolved.real}`);
    assets.set(resolved.route, captured);
    if (extname(resolved.real).toLowerCase() !== ".css" || visitedCss.has(resolved.real)) return;
    visitedCss.add(resolved.real);
    const css = captured.text;
    if (css === null) return;
    for (const ref of cssReferences(css)) add({ raw: ref, requiredStylesheet: false, deploymentRequiredRole: null }, resolved.real);
  };
  // `root` is canonical (macOS commonly exposes both /var and /private/var). Resolve the
  // document base beneath that same root so an alias does not look like an escape, while asset
  // components themselves remain lexical until the bounded reader validates them.
  const documentBase = join(root, basename(resolve(file)));
  for (const reference of htmlResourceReferences(html)) add(reference, documentBase);
  return { assets, externalDeploymentRequiredRoutes };
}

export function discoverLocalAssets(html: string, file: string, maxBytes = MAX_RESOURCE_BYTES): Map<string, CapturedAsset> {
  return discoverLocalAssetClosure(html, file, maxBytes).assets;
}

function measuredResources(
  requestedUrls: readonly string[],
  localOrigin: string,
  serverResources: readonly ResourceRecord[],
  networkResources: readonly ResourceRecord[],
): ResourceRecord[] {
  const out = new Map<string, ResourceRecord>();
  for (const record of serverResources) {
    out.set(`${record.requestedUri}\0${record.resolvedUri}\0${record.status}`, record);
  }
  for (const record of networkResources) {
    out.set(`${record.requestedUri}\0${record.resolvedUri}\0${record.status}`, record);
  }
  for (const requestedUri of requestedUrls) {
    let url: URL;
    try {
      url = new URL(requestedUri);
    } catch {
      continue;
    }
    if (url.origin === localOrigin) continue; // server-side records carry authoritative 200/403/404.
    if ([...out.values()].some((record) => record.requestedUri === requestedUri || record.resolvedUri === url.href)) continue;
    const record: ResourceRecord = {
        requestedUri,
        resolvedUri: url.href,
        scheme: url.protocol.replace(/:$/u, ""),
        origin: url.origin === "null" ? `${url.protocol}//` : url.origin,
        status: null,
        bytes: null,
        sha256: null,
        outcome: "failed",
      };
    out.set(`${record.requestedUri}\0${record.resolvedUri}`, record);
  }
  return [...out.values()].sort((a, b) =>
    a.resolvedUri.localeCompare(b.resolvedUri) || a.requestedUri.localeCompare(b.requestedUri),
  );
}

export function documentArtifactKey(path: string, ordinal: number, runId: string): string {
  return `${runId}-${String(ordinal + 1).padStart(4, "0")}-${basename(path, extname(path)).replace(/[^A-Za-z0-9._-]/gu, "-")}-${sha256Short(resolve(path))}`;
}

/** Local stylesheets are part of the collision gate, including an @import chain. */
export function collisionSources(
  html: string,
  assetsOrFile: ReadonlyMap<string, CapturedAsset> | string,
  maxBytes = MAX_RESOURCE_BYTES,
): CollisionSource[] {
  // Compatibility for focused unit callers. Production passes its already-captured map, and is
  // therefore never permitted to reopen the resource tree between collision and serving.
  const assets = typeof assetsOrFile === "string" ? discoverLocalAssets(html, assetsOrFile, maxBytes) : assetsOrFile;
  const out: CollisionSource[] = [{ origin: "document", text: html }];
  const seen = new Set<string>();
  for (const asset of assets.values()) {
    if (extname(asset.real).toLowerCase() !== ".css" || seen.has(asset.real) || asset.text === null) continue;
    seen.add(asset.real);
    out.push({ origin: asset.real, text: asset.text });
  }
  return out;
}

function normalisedAllowedOrigins(options: RenderOptions): Set<string> {
  const result = new Set<string>();
  for (const value of options.network.allowed) {
    try {
      result.add(new URL(value).origin);
    } catch {
      // parseArgs accepts strings; a malformed origin is denied here rather than broadening access.
    }
  }
  return result;
}

interface NetworkTracker {
  resources: ResourceRecord[];
  /** Browser-observed fetch roles, including local server requests and dynamic stylesheet loads. */
  localRequestRoles: Map<string, Set<string>>;
  redirects: { from: string; to: string; status: number }[];
  inFlight: Set<RequestLike>;
  pendingBodies: Set<Promise<void>>;
  afterRendered: boolean;
  activityAfterRendered: number;
  loadedBytes: number;
  limitExceeded: { maxResourceBytes: number; resourceBytes: number; resource: string } | null;
  errors: string[];
}

async function configureNetwork(
  page: PageLike,
  localOrigin: string,
  options: RenderOptions,
  blocked: { count: number },
): Promise<NetworkTracker> {
  const allowed = normalisedAllowedOrigins(options);
  const tracker: NetworkTracker = {
    resources: [], localRequestRoles: new Map(), redirects: [], inFlight: new Set(), pendingBodies: new Set(), afterRendered: false,
    activityAfterRendered: 0, loadedBytes: 0, limitExceeded: null, errors: [],
  };
  const records = new Map<RequestLike, ResourceRecord>();
  if (!page.setRequestInterception) throw new Error("the browser driver exposes no request-interception boundary");
  await page.setRequestInterception(true);
  page.on("request", (payload: unknown) => {
    const request = payload as RequestLike;
    tracker.inFlight.add(request);
    if (tracker.afterRendered) tracker.activityAfterRendered += 1;
    let permit = false;
    try {
      const url = new URL(request.url());
      if (url.origin === localOrigin) {
        const roles = tracker.localRequestRoles.get(url.pathname) ?? new Set<string>();
        // Puppeteer's resource type records the request role independently of its filename.
        // Unknown drivers decline the ambient exemption instead of silently accepting a failure.
        roles.add((request as RequestLike & { resourceType?: () => string }).resourceType?.() ?? "unknown");
        tracker.localRequestRoles.set(url.pathname, roles);
      }
      permit =
        url.origin === localOrigin ||
        ["data:", "blob:", "about:"].includes(url.protocol) ||
        (options.network.mode === "allowlist" && allowed.has(url.origin));
      if (url.origin !== localOrigin && !["data:", "blob:", "about:"].includes(url.protocol)) {
        const record: ResourceRecord = {
          requestedUri: url.href,
          resolvedUri: url.href,
          scheme: url.protocol.replace(/:$/u, ""),
          origin: url.origin === "null" ? `${url.protocol}//` : url.origin,
          status: null,
          bytes: null,
          sha256: null,
          outcome: permit ? "failed" : "blocked",
        };
        tracker.resources.push(record);
        records.set(request, record);
      }
    } catch {
      permit = false;
    }
    if (permit) void request.continue();
    else {
      blocked.count += 1;
      const record = records.get(request);
      if (record) { record.bytes = 0; record.outcome = "blocked"; }
      void request.abort("blockedbyclient");
    }
  });
  page.on("requestfinished", (payload: unknown) => {
    const request = payload as RequestLike;
    tracker.inFlight.delete(request);
    if (tracker.afterRendered) tracker.activityAfterRendered += 1;
    const record = records.get(request);
    if (!record) return;
    const response = request.response?.();
    if (!response) { record.outcome = "failed"; tracker.errors.push(`no response for ${record.requestedUri}`); return; }
    const bodyTask = (async () => {
      try {
        const status = response.status();
        if (status >= 300 && status < 400) {
          record.status = status; record.bytes = 0; record.resolvedUri = response.url();
          record.sha256 = createHash("sha256").update(new Uint8Array()).digest("hex");
          record.outcome = "loaded";
          return;
        }
        const declared = Number(response.headers?.()["content-length"] ?? "NaN");
        if (Number.isFinite(declared) && declared > MAX_RESOURCE_BYTES) {
          tracker.limitExceeded = {
            maxResourceBytes: MAX_RESOURCE_BYTES, resourceBytes: declared, resource: response.url(),
          };
          record.status = status; record.bytes = declared; record.resolvedUri = response.url(); record.outcome = "failed";
          return;
        }
        const body = await response.buffer();
        record.status = status;
        record.bytes = body.length;
        record.resolvedUri = response.url();
        record.sha256 = createHash("sha256").update(body).digest("hex");
        record.outcome = "loaded";
        tracker.loadedBytes += body.length;
        if (body.length > MAX_RESOURCE_BYTES || tracker.loadedBytes > MAX_RESOURCE_BYTES) {
          tracker.limitExceeded = {
            maxResourceBytes: MAX_RESOURCE_BYTES, resourceBytes: tracker.loadedBytes, resource: response.url(),
          };
        }
        const chain = request.redirectChain?.() ?? [];
        const hops = [...chain, request];
        for (let index = 0; index + 1 < hops.length; index += 1) {
          const fromRequest = hops[index]!;
          const fromResponse = fromRequest.response?.();
          if (!fromResponse) continue;
          tracker.redirects.push({ from: fromRequest.url(), to: hops[index + 1]!.url(), status: fromResponse.status() });
        }
      } catch (error) {
        record.outcome = "failed";
        tracker.errors.push(`response body unreadable for ${record.requestedUri}: ${error instanceof Error ? error.message : String(error)}`);
      }
    })();
    tracker.pendingBodies.add(bodyTask);
    void bodyTask.finally(() => tracker.pendingBodies.delete(bodyTask));
  });
  page.on("requestfailed", (payload: unknown) => {
    const request = payload as RequestLike;
    tracker.inFlight.delete(request);
    if (tracker.afterRendered) tracker.activityAfterRendered += 1;
    const record = records.get(request);
    if (record && record.outcome !== "blocked") record.outcome = "failed";
  });
  return tracker;
}

async function crossCheckPage(page: PageLike): Promise<ReturnType<typeof compareGeometry>> {
  const batch = await page.evaluate<GeometrySampleBatch>(geometrySampleSource(CROSS_CHECK_SAMPLE_SIZE));
  const inPage = batch.samples;
  if (!page.createCDPSession) throw new Error("the browser driver exposes no CDP session for the geometry oracle");
  const session = await page.createCDPSession();
  try {
    await session.send("DOM.enable");
    const { root } = await session.send<{ root: { nodeId: number } }>("DOM.getDocument", { depth: -1, pierce: false });
    const out: GeometrySample[] = [];
    for (const sample of inPage) {
      if (!sample.selector || sample.occurrence === undefined) continue;
      const { nodeIds } = await session.send<{ nodeIds: number[] }>("DOM.querySelectorAll", { nodeId: root.nodeId, selector: sample.selector });
      const nodeId = nodeIds[sample.occurrence];
      if (!nodeId) continue;
      let model: { border: number[] };
      try {
        ({ model } = await session.send<{ model: { border: number[] } }>("DOM.getBoxModel", { nodeId }));
      } catch {
        // An inaccessible box is a missing oracle answer. Leaving this sample absent lets
        // compareGeometry produce the fatal, attributable cross-check event instead of a generic
        // checker crash or a quiet skip.
        continue;
      }
      const q = model.border;
      out.push({ key: sample.key, ...quadEnvelope(q) });
    }
    // Small documents can expose fewer than eight addressable eligible CSS boxes; in that case
    // every one is checked. Returning the full pre-limit eligible population makes that reduction
    // visible and turns accidental sample-array truncation into a fatal cardinality mismatch.
    const required = Math.min(CROSS_CHECK_SAMPLE_SIZE, batch.eligible);
    return compareGeometry(inPage, out, CROSS_CHECK_TOLERANCE_PX, required, batch);
  } finally {
    await session.detach().catch(() => undefined);
  }
}

function fatalInfrastructure(events: readonly InfraEvent[]): boolean {
  return events.some((event) => !IS.nonFatalInfraEventKind.has(event.kind));
}

/**
 * Evidence is part of acquisition, not a reporting adornment.  If it adds a fatal event, the
 * already assembled snapshot is withdrawn before the rule engine can observe it.
 */
export function finalizeEvidenceAcquisition(
  path: string,
  snapshot: NonNullable<DocumentInput["snapshot"]>,
  infrastructure: readonly InfraEvent[],
  evidence: EvidenceOutcome,
  evidenceRequired?: boolean,
): DocumentInput {
  const allInfrastructure = [...infrastructure, ...evidence.infrastructure];
  const renderArtifact = evidence.pdfArtifact ? {
    ...evidence.pdfArtifact, kind: "diagnostic-pdf" as const,
    inputHtmlSha256: snapshot.meta.inputIdentity?.html ?? null,
    withEvidenceOverlay: evidence.deliveredWithOverlay,
    relation: "same-acquisition" as const, delivery: "not-asserted" as const,
  } : undefined;
  if (fatalInfrastructure(allInfrastructure)) {
    return {
      path,
      ...(renderArtifact ? { renderArtifact } : {}),
      ...(evidenceRequired !== undefined ? { evidenceRequirement: { required: evidenceRequired, expectedPages: snapshot.pages.length } } : {}),
      snapshot: null,
      infrastructure: allInfrastructure,
      evidence: [],
      boundSids: [],
      notMeasured: evidence.notMeasured,
    };
  }
  return {
    path,
    ...(renderArtifact ? { renderArtifact } : {}),
    ...(evidenceRequired !== undefined ? { evidenceRequirement: { required: evidenceRequired, expectedPages: snapshot.pages.length } } : {}),
    snapshot,
    infrastructure: allInfrastructure,
    evidence: evidence.evidence,
    boundSids: [...evidence.boundSids],
    notMeasured: evidence.notMeasured,
  };
}

/** A fatal event discovered during final resource cleanup invalidates every earlier document. */
export function withdrawFatalCleanupDocuments(documents: readonly DocumentInput[]): void {
  for (const document of documents) {
    if (!fatalInfrastructure(document.infrastructure)) continue;
    document.snapshot = null;
    document.evidence = [];
    document.boundSids = [];
  }
}

interface AcquireContext {
  browser: BrowserLike;
  browserVersion: string;
  rendererPath: string;
  pagedjsVersion: string;
  pagedjsSource: string;
  rasterizer: OpenRasterizerResult["rasterizer"];
  options: RenderOptions;
  blocked: { count: number };
  contentPages: Set<PageLike>;
  injectSourceIds: typeof injectSourceIds;
  ownershipFailed: boolean;
  lateOwnershipCleanupFailed: boolean;
  lateOwnershipCleanupDetail: string | null;
  runId: string;
}

interface OpenedContentPage {
  page: PageLike;
  browserContext: BrowserContextLike;
  apparatusCapability: string;
  collectorNonce: string | null;
  pageErrors: string[];
  cascadeHints: Record<string, BreakCauseCascadeHint | null>;
  imageFailures: ImageDecodeFailure[];
  network: NetworkTracker;
  close(): Promise<void>;
}

class FontLoadFailure extends Error {}
class OperationalBoundaryFailure extends Error {
  readonly events: InfraEvent[];
  constructor(events: InfraEvent[]) {
    super(events.map((event) => event.detail).join("; "));
    this.events = events;
  }
}

class AcquisitionAborted extends Error {}

function abortable<T>(operation: Promise<T>, signal: AbortSignal, stage: string): Promise<T> {
  if (signal.aborted) return Promise.reject(new AcquisitionAborted(`acquisition aborted at ${stage}`));
  return new Promise<T>((resolveOperation, rejectOperation) => {
    const abort = (): void => rejectOperation(new AcquisitionAborted(`acquisition aborted at ${stage}`));
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => { signal.removeEventListener("abort", abort); resolveOperation(value); },
      (error) => { signal.removeEventListener("abort", abort); rejectOperation(error); },
    );
  });
}

function abortablePage(page: PageLike, signal: AbortSignal): PageLike {
  return new Proxy(page, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== "function") return value;
      // Puppeteer's EventEmitter methods access private fields. Returning the bare method makes
      // the Proxy the receiver and throws `Cannot read private member #handlers`; listener setup
      // is synchronous, so bind it to the owned target without wrapping it in an abort Promise.
      if (property === "on") {
        return (...args: unknown[]) => (value as (...inner: unknown[]) => unknown).apply(target, args);
      }
      return (...args: unknown[]) => abortable(
        Promise.resolve((value as (...inner: unknown[]) => unknown).apply(target, args)),
        signal,
        `page.${String(property)}`,
      );
    },
  }) as PageLike;
}

interface ResourceBarrierResult {
  failedFonts: string[];
  failedImages: RawImageDecodeFailure[];
}

interface RawImageDecodeFailure {
  uri: string;
  resourceIndex: number;
  width: number;
  height: number;
  widthAttribute: string | null;
  heightAttribute: string | null;
}

interface ImageDecodeFailure {
  uri: string;
  resourceIndex: number;
  width: number;
  height: number;
  declaredWidth: number;
  declaredHeight: number;
}

function positiveHtmlDimension(raw: string | null): number | null {
  if (raw === null || !/^\s*\d+\s*$/u.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export interface RuntimeIntegrityStatus {
  sidMutations: number;
  mutationRecordsAfterRendered: number;
  paginationPreviewCalls: number;
  sids: string[];
}

export function validateRuntimeSidState(
  expectedSids: readonly string[],
  status: RuntimeIntegrityStatus,
): string[] {
  const issues: string[] = [];
  if (status.sidMutations > 0) issues.push(`${status.sidMutations} reserved source-id attribute mutation(s)`);
  const expectedIndex = new Map(expectedSids.map((sid, index) => [sid, index]));
  const distinctObserved: string[] = [];
  const seen = new Set<string>();
  for (const [position, sid] of status.sids.entries()) {
    const owner = expectedIndex.get(sid);
    if (owner === undefined) {
      issues.push(`unknown source id at ${position}: ${sid}`);
      continue;
    }
    // Paged.js may clone a containing source block on several pages. Its later fragments can
    // therefore appear after descendants. Identity order is the order of FIRST occurrences;
    // repetitions are ownership fragments, not new source blocks.
    if (seen.has(sid)) continue;
    seen.add(sid);
    distinctObserved.push(sid);
  }
  if (distinctObserved.length !== expectedSids.length) {
    issues.push(`expected ${expectedSids.length} distinct source ids, found ${distinctObserved.length}`);
  }
  for (let index = 0; index < Math.max(distinctObserved.length, expectedSids.length); index += 1) {
    if (distinctObserved[index] !== expectedSids[index]) {
      issues.push(`source-id order mismatch at ${index}: ${distinctObserved[index] ?? "missing"} != ${expectedSids[index] ?? "missing"}`);
      break;
    }
  }
  return issues;
}

/** Source IDs are ordered by parser offsets, never by their variable-width numeric suffix. */
export function orderedSourceSids(sourceMap: Readonly<Record<string, SourceRef>>): string[] {
  return Object.entries(sourceMap).sort(([, a], [, b]) => a.offset - b.offset).map(([sid]) => sid);
}

export function operationalLimitEvents(input: {
  pages: number;
  domNodes: number;
  mutationsAfterRendered: number;
  resourceLimit: NetworkTracker["limitExceeded"];
}): InfraEvent[] {
  const events: InfraEvent[] = [];
  if (input.pages > MAX_PAGES || input.domNodes > MAX_DOM_NODES) {
    events.push({
      kind: "limit-exceeded",
      detail: "the paginated document exceeds a §13.3 structural limit",
      measured: { pages: input.pages, domNodes: input.domNodes, maxPages: MAX_PAGES, maxDomNodes: MAX_DOM_NODES },
    });
  }
  if (input.mutationsAfterRendered > MAX_MUTATIONS_AFTER_RENDERED) {
    events.push({
      kind: "document-not-quiescent",
      detail: "post-afterRendered mutation limit exceeded",
      measured: {
        mutationRecordsAfterRendered: input.mutationsAfterRendered,
        maxMutationsAfterRendered: MAX_MUTATIONS_AFTER_RENDERED,
      },
    });
  }
  if (input.resourceLimit) {
    events.push({ kind: "limit-exceeded", detail: "network resource byte limit exceeded", measured: input.resourceLimit });
  }
  return events;
}

export function integritySource(expectedSids: readonly string[]): string {
  return integritySourceWithCapability(expectedSids, TEST_PRIMITIVES_CAPABILITY);
}

function integritySourceWithCapability(expectedSids: readonly string[], capability: string): string {
  return `(() => {
    const P = window.__blPrimitives;
    const expected = ${JSON.stringify(expectedSids)};
    let sidMutations = 0, late = false, mutationRecordsAfterRendered = 0, paginationPreviewCalls = 0;
    const Observer = MutationObserver;
    const observer = new Observer((records) => {
      for (const record of records) {
        if (late) mutationRecordsAfterRendered += 1;
        if (P.mutationType(record) === "attributes" && P.startsWith(P.mutationAttributeName(record) || "", "data-bl-")) sidMutations += 1;
      }
    });
    observer.observe(document, { subtree: true, childList: true, attributes: true });
    const armLate = () => { if (late) return false; late = true; return true; };
    const status = () => {
      const sids = [], elements = P.all(document, "[data-bl-sid]");
      for (let index = 0; index < elements.length; index += 1) sids[index] = P.attr(elements[index], "data-bl-sid") || "";
      return { sidMutations, mutationRecordsAfterRendered, paginationPreviewCalls, sids, expected };
    };
    const recordPaginationPreview = () => { paginationPreviewCalls += 1; return paginationPreviewCalls; };
    P.installIntegrity(${JSON.stringify(capability)}, { armLate, recordPreview: recordPaginationPreview, status });
  })()`;
}

export function integrityStatusSource(capability: string): string {
  return `window.__blPrimitives.integrityStatus(${JSON.stringify(capability)})`;
}

export function paginationApparatusSource(capability: string): string {
  return `(() => {
    const P = window.__blPrimitives;
    if (P.all(document, ".pagedjs_page").length > 0) {
      throw new Error("pagination began before the Node-controlled apparatus was installed");
    }
    const apparatus = P.pagedApparatus(${JSON.stringify(capability)});
    const Paged = apparatus.value;
    const Previewer = apparatus.Previewer;
    const originalPreview = Previewer.prototype.preview;
    let previewCalls = 0;
    class BreaklintReady extends apparatus.Handler {
      afterRendered() { P.integrityArmLate(${JSON.stringify(capability)}); }
    }
    P.registerPagedHandler(${JSON.stringify(capability)}, BreaklintReady);
    const guardedPreview = function() {
      previewCalls += 1;
      P.integrityRecordPreview(${JSON.stringify(capability)});
      if (previewCalls !== 1) throw new Error("pagination preview was invoked more than once");
      return P.invoke0(originalPreview, this);
    };
    P.lockPagination(${JSON.stringify(capability)}, Previewer.prototype, "preview", guardedPreview);
    P.lockPreviewer(${JSON.stringify(capability)}, Paged, "Previewer", Previewer);
  })()`;
}

const ANIMATION_FREEZE_SOURCE = `(() => {
  const P = window.__blPrimitives;
  if (P.all(document, 'style[data-breaklint-intervention="animations-disabled"]').length > 0) return;
  const style = P.create("style");
  P.setAttr(style, "data-breaklint-intervention", "animations-disabled");
  P.setText(style, "*,*::before,*::after{animation:none!important;transition:none!important}");
  P.append(document.head || document.documentElement, style);
})()`;

const ANIMATION_STATUS_SOURCE = `(() => {
  const P = window.__blPrimitives;
  const styles = P.all(document, 'style[data-breaklint-intervention="animations-disabled"]');
  const expected = "*,*::before,*::after{animation:none!important;transition:none!important}";
  let effectViolations = 0;
  for (const el of P.all(document, "*")) {
    for (const pseudo of [null, "::before", "::after"]) {
      const style = P.style(el, pseudo);
      const durations = String(style.transitionDuration || "0s").split(",");
      if (style.animationName !== "none" || durations.some((value) => parseFloat(value) !== 0)) effectViolations += 1;
    }
  }
  return {
    count: styles.length,
    connected: styles.length === 1 && P.parent(styles[0]) !== null,
    ruleIntact: styles.length === 1 && P.text(styles[0]) === expected,
    effectViolations,
  };
})()`;

interface AnimationStatus {
  count: number;
  connected: boolean;
  ruleIntact: boolean;
  effectViolations: number;
}

/**
 * The `render-unstable` sentence for a PDF that did not reproduce the state it was bound to.
 *
 * Exported and built here for the reason `divergenceDetail` gives: the test that pins the wording
 * has to read the producer. The order of the clauses is the order a reader needs them in — WHAT
 * moved, then WHY it moved, then what that costs. `report/infra.ts` truncates `detail` at 220
 * characters for five of the six formats, so the cause must not be last.
 *
 * When there is no residue the sentence stops after the components. A drift with no residue is a
 * case this build has not measured, and inventing an explanation for it would be worse than
 * naming the components and saying nothing else.
 */
export function pdfReconciliationDetail(
  stage: string,
  drifted: readonly string[],
  residue: FragmentainerReport,
): string {
  const what = drifted.length > 0
    ? `freeze component(s) ${drifted.join(", ")} changed across ${stage} PDF production`
    : `the runtime integrity counters changed across ${stage} PDF production`;
  const why = residue.count > 0
    ? ` ${residueDetail(residue)} The PDF is rendered in print media, where Paged.js re-sizes the ` +
      "fragmentainer, so that content is laid out somewhere else than where it was measured."
    : "";
  return `the PDF does not reproduce the state the rules measured: ${what}.${why}`;
}

async function verifyAnimationIntervention(page: PageLike, stage: string): Promise<void> {
  const status = await page.evaluate<AnimationStatus>(ANIMATION_STATUS_SOURCE);
  if (status.count !== 1 || !status.connected || !status.ruleIntact || status.effectViolations > 0) {
    throw new Error(`animation intervention failed at ${stage}: ${JSON.stringify(status)}`);
  }
}

const LIMIT_STATUS_SOURCE = `(() => ({
  pages: window.__blPrimitives.all(document, ".pagedjs_page").length,
  domNodes: window.__blPrimitives.all(document, "*").length,
}))()`;

async function enforceOperationalLimits(
  page: PageLike,
  network: NetworkTracker,
  mutationsAfterRendered: number,
  stage: string,
): Promise<void> {
  const status = await page.evaluate<{ pages: number; domNodes: number }>(LIMIT_STATUS_SOURCE);
  const events = operationalLimitEvents({
    pages: status.pages,
    domNodes: status.domNodes,
    mutationsAfterRendered,
    resourceLimit: network.limitExceeded,
  });
  if (events.length > 0) {
    for (const event of events) event.measured = { ...(event.measured ?? {}), stage };
    throw new OperationalBoundaryFailure(events);
  }
}

export const PAGINATION_PREVIEW_SOURCE = `(async () => {
  try {
    await new Paged.Previewer().preview();
    return { paginationError: null };
  } catch (error) {
    return { paginationError: String(error) };
  }
})()`;

async function awaitNetworkQuiet(
  tracker: NetworkTracker,
  timeoutMs = PAGINATION_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let lastActivity = tracker.activityAfterRendered;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw new AcquisitionAborted("acquisition aborted during network quiet");
    if (tracker.inFlight.size === 0 && tracker.pendingBodies.size === 0) {
      const pause = new Promise<void>((resolveWait) => setTimeout(resolveWait, 250));
      await (signal ? abortable(pause, signal, "network quiet stable window") : pause);
      if (tracker.inFlight.size === 0 && tracker.pendingBodies.size === 0 && tracker.activityAfterRendered === lastActivity) {
        return true;
      }
      lastActivity = tracker.activityAfterRendered;
    } else {
      const pause = new Promise<void>((resolveWait) => setTimeout(resolveWait, 25));
      await (signal ? abortable(pause, signal, "network quiet poll") : pause);
      lastActivity = tracker.activityAfterRendered;
    }
  }
  return false;
}

const RESOURCE_BARRIER_SOURCE = `(async () => {
  const P = window.__blPrimitives;
  const fonts = P.fonts();
  await P.fontsReady(fonts);
  const failedFonts = P.fontFaces(fonts).filter((face) => P.fontStatus(face) === "error")
    .map((face) => P.fontFamily(face) + ":" + P.fontStatus(face));
  const images = P.all(document, "img").filter((image) => P.imageUri(image));
  const settled = await Promise.allSettled(images.map((image) => P.decodeImage(image)));
  const failedImages = settled.flatMap((result, index) => {
    if (result.status !== "rejected") return [];
    const image = images[index];
    const box = P.rect(image);
    return [{
      uri: P.imageUri(image),
      resourceIndex: index + 1,
      width: box.width,
      height: box.height,
      widthAttribute: P.attr(image, "width"),
      heightAttribute: P.attr(image, "height"),
    }];
  });
  return { failedFonts, failedImages };
})()`;

const CASCADE_HINT_SOURCE = `(() => {
  const P = window.__blPrimitives;
  const out = {};
  for (const el of P.all(document, "[data-bl-sid]")) {
    const sid = P.attr(el, "data-bl-sid");
    if (!sid) continue;
    const s = P.style(el, null);
    const values = [s.breakBefore, s.breakAfter, s.page].filter((v) => v && v !== "auto" && v !== "none");
    if (values.length === 0) { out[sid] = "none"; continue; }
    const inline = /(?:break-(?:before|after)|page)\\s*:/iu.test(P.attr(el, "style") || "");
    out[sid] = inline ? "inline" : "stylesheet";
  }
  return out;
})()`;

async function openContentPage(
  context: AcquireContext,
  origin: string,
  documentRoute: string,
  expectedSids: readonly string[],
  installCollector: boolean,
  signal: AbortSignal,
  observeNetwork?: (network: NetworkTracker) => void,
): Promise<OpenedContentPage> {
  if (!context.browser.createBrowserContext) {
    throw new Error("the browser driver exposes no isolated browser-context boundary");
  }
  let browserContext: BrowserContextLike | null = null;
  let page: PageLike | null = null;
  let ownedPage: PageLike | null = null;
  let closed = false;
  const pendingOwnership: Promise<void>[] = [];
  const closeLatePage = async (latePage: PageLike): Promise<void> => {
    try { await withTimeout(latePage.close(), BROWSER_CLOSE_TIMEOUT_MS, "late content page.close"); }
    catch (error) {
      context.ownershipFailed = true;
      context.lateOwnershipCleanupFailed = true;
      context.lateOwnershipCleanupDetail = error instanceof Error ? error.message : String(error);
      throw new Error(`late owned content page cleanup failed: ${context.lateOwnershipCleanupDetail}`);
    }
  };
  const closeLateContext = async (lateContext: BrowserContextLike): Promise<void> => {
    try { await withTimeout(lateContext.close(), BROWSER_CLOSE_TIMEOUT_MS, "late browser context.close"); }
    catch (error) {
      context.ownershipFailed = true;
      context.lateOwnershipCleanupFailed = true;
      context.lateOwnershipCleanupDetail = error instanceof Error ? error.message : String(error);
      throw new Error(`late owned browser context cleanup failed: ${context.lateOwnershipCleanupDetail}`);
    }
  };
  const trackOwnership = <T>(operation: Promise<T>, closeLate: (value: T) => Promise<void>): Promise<T> => {
    pendingOwnership.push(operation.then(async (value) => {
      // `abortable` deliberately stops the caller promptly. This continuation keeps ownership of
      // a driver result that arrives afterwards, and the catch path below joins it before this
      // acquisition can settle. A late context/page is never merely forgotten.
      if (signal.aborted || closed) await closeLate(value);
    }, () => undefined));
    return operation;
  };
  const joinPendingOwnership = async (): Promise<void> => {
    const settled = await Promise.allSettled(pendingOwnership);
    const failures = settled.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length > 0) {
      throw new Error(`late owned resource cleanup failed: ${failures.map((result) => String(result.reason)).join("; ")}`);
    }
  };
  const close = async (): Promise<void> => {
    if (closed) return;
    const errors: string[] = [];
    if (page) {
      try { await withTimeout(releaseCapturedFontIdentity(page), BROWSER_CLOSE_TIMEOUT_MS, "font session.detach"); }
      catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    }
    if (ownedPage) {
      try { await withTimeout(ownedPage.close(), BROWSER_CLOSE_TIMEOUT_MS, "content page.close"); }
      catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    }
    if (browserContext) {
      try { await withTimeout(browserContext.close(), BROWSER_CLOSE_TIMEOUT_MS, "browser context.close"); }
      catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
    }
    if (errors.length > 0) {
      context.ownershipFailed = true;
      throw new Error(`owned content page cleanup failed: ${errors.join("; ")}`);
    }
    closed = true;
    if (ownedPage) context.contentPages.delete(ownedPage);
  };
  try {
    browserContext = await abortable(
      trackOwnership(context.browser.createBrowserContext(), closeLateContext),
      signal,
      "createBrowserContext",
    );
    try {
      ownedPage = await abortable(
        trackOwnership(browserContext.newPage(), closeLatePage),
        signal,
        "browserContext.newPage",
      );
      page = abortablePage(ownedPage, signal);
    } catch (error) {
      context.ownershipFailed = true;
      throw error;
    }
    context.contentPages.add(ownedPage);
    const apparatusCapability = randomBytes(24).toString("hex");
    const collectorNonce = installCollector ? randomBytes(16).toString("hex") : null;
    const pageErrors: string[] = [];
    page.on("pageerror", (error: unknown) => pageErrors.push(String(error).slice(0, 500)));
    if (!page.evaluateOnNewDocument) throw new Error("the browser driver exposes no on-new-document primitive boundary");
    await page.evaluateOnNewDocument(primitivesSource(apparatusCapability));
    await page.evaluateOnNewDocument(integritySourceWithCapability(expectedSids, apparatusCapability));
    const network = await configureNetwork(page, origin, context.options, context.blocked);
    observeNetwork?.(network);
    await prepareCapturedFontIdentity(page);
    await page.setViewport({ width: 1000, height: 800, deviceScaleFactor: 1 });
    await page.goto(`${origin}${documentRoute}`, { waitUntil: "networkidle0", timeout: PAGINATION_TIMEOUT_MS });
    if (pageErrors.length > 0) throw new Error(`content page error before apparatus install: ${pageErrors.join(" | ")}`);
    await enforceOperationalLimits(page, network, 0, "pre-pagination");
    await page.evaluate<void>(paginationBundleSource(context.pagedjsSource));
    if (collectorNonce) await page.evaluate<void>(collectorSource(apparatusCapability, collectorNonce));
  await page.evaluate<void>(paginationApparatusSource(apparatusCapability));
    await page.evaluate<void>(ANIMATION_FREEZE_SOURCE);
    await verifyAnimationIntervention(page, "pre-pagination");
    const prePagination = await page.evaluate<RuntimeIntegrityStatus>(integrityStatusSource(apparatusCapability));
    const sidIssues = validateRuntimeSidState(expectedSids, prePagination);
    if (sidIssues.length > 0) throw new Error(`runtime source-id integrity failed: ${sidIssues.join("; ")}`);
    // Print-only font faces do not enter the FontFaceSet until the print media query applies.
    // The readiness/error barrier and cascade-hint read therefore share the print phase.
    await page.emulateMediaType("print");
    const ready = await withTimeout(
      page.evaluate<ResourceBarrierResult>(RESOURCE_BARRIER_SOURCE),
      DOCUMENT_TIMEOUT_MS,
      "font/image readiness barrier",
    );
    if (ready.failedFonts.length > 0) {
      throw new FontLoadFailure(`font resources failed: ${ready.failedFonts.join(", ")}`);
    }
    const checkedImages = ready.failedImages.map((image) => ({
      uri: image.uri,
      resourceIndex: image.resourceIndex,
      width: image.width,
      height: image.height,
      declaredWidth: positiveHtmlDimension(image.widthAttribute),
      declaredHeight: positiveHtmlDimension(image.heightAttribute),
    }));
    const unstableImages = checkedImages.filter((image) =>
      image.width <= 0 || image.height <= 0 || image.declaredWidth === null || image.declaredHeight === null ||
      image.width !== image.declaredWidth || image.height !== image.declaredHeight);
    if (unstableImages.length > 0) {
      throw new Error(
        `image decode failed without a rendered box equal to explicit authored width and height ` +
        `for ${unstableImages.length} image(s)`,
      );
    }
    const imageFailures: ImageDecodeFailure[] = checkedImages.map((image) => ({
      uri: image.uri,
      resourceIndex: image.resourceIndex,
      width: image.width,
      height: image.height,
      // The fatal branch above excludes both nulls before this trusted projection.
      declaredWidth: image.declaredWidth!,
      declaredHeight: image.declaredHeight!,
    }));
    // §11.6a ordering: read the non-normative cascade hint in print media BEFORE Paged.js consumes
    // the declarations, then reset the medium and only then start pagination.
    const cascadeHints = await page.evaluate<Record<string, BreakCauseCascadeHint | null>>(CASCADE_HINT_SOURCE);
    await page.emulateMediaType(null);
    const paginationError = await page.evaluate<{ paginationError: string | null }>(PAGINATION_PREVIEW_SOURCE);
    if (paginationError.paginationError) throw new Error(`pagination aborted: ${paginationError.paginationError}`);
    // Paged.js rebuilds stylesheet ownership while it constructs the page tree and may consume
    // the source intervention node. Re-establish the same idempotent rule on the final tree, then
    // verify both its connection and computed effect rather than reporting a consumed node.
    await page.evaluate<void>(ANIMATION_FREEZE_SOURCE);
    await verifyAnimationIntervention(page, "post-pagination");
    const postPagination = await page.evaluate<RuntimeIntegrityStatus>(integrityStatusSource(apparatusCapability));
    const postPaginationSidIssues = validateRuntimeSidState(expectedSids, postPagination);
    if (postPaginationSidIssues.length > 0) {
      throw new Error(`post-pagination source-id integrity failed: ${postPaginationSidIssues.join("; ")}`);
    }
    if (postPagination.paginationPreviewCalls !== 1) {
      throw new Error(`pagination apparatus epoch violated: ${postPagination.paginationPreviewCalls} preview call(s)`);
    }
    network.afterRendered = true;
    const quiet = await awaitNetworkQuiet(network, PAGINATION_TIMEOUT_MS, signal);
    if (!quiet) {
      throw new OperationalBoundaryFailure([{
        kind: "document-not-quiescent",
        detail: "network activity did not settle after afterRendered",
        measured: { stage: "post-pagination", inFlight: network.inFlight.size, pendingBodies: network.pendingBodies.size,
          inFlightKinds: [...network.inFlight].map(request => {
            const kind = (request as RequestLike & { resourceType?: () => string }).resourceType?.() ?? "unknown";
            return ["font", "document", "stylesheet", "image", "script", "other"].includes(kind) ? kind : "unknown";
          }),
          inFlightSchemes: [...network.inFlight].map(request => {
            try { const scheme = new URL(request.url()).protocol; return ["http:", "https:", "blob:", "data:", "about:"].includes(scheme) ? scheme : "unknown"; }
            catch { return "unknown"; }
          }),
        },
      }]);
    }
    await enforceOperationalLimits(page, network, postPagination.mutationRecordsAfterRendered, "post-pagination");
    network.activityAfterRendered = 0;
    if (pageErrors.length > 0) throw new Error(`content page error during pagination: ${pageErrors.join(" | ")}`);
    return {
      page, browserContext, apparatusCapability, collectorNonce, pageErrors, cascadeHints,
      imageFailures, network, close,
    };
  } catch (error) {
    const cleanupErrors: string[] = [];
    try { await close(); } catch (closeError) { cleanupErrors.push(closeError instanceof Error ? closeError.message : String(closeError)); }
    try {
      // A driver that ignores both abort and browser shutdown is not a condition we may certify
      // as clean. Bound the wait so the CLI reports that broken boundary rather than hanging
      // forever, while ordinary late resolutions remain genuinely joined and closed above.
      await withTimeout(joinPendingOwnership(), BROWSER_CLOSE_TIMEOUT_MS, "late owned resource join");
    } catch (joinError) { cleanupErrors.push(joinError instanceof Error ? joinError.message : String(joinError)); }
    if (cleanupErrors.length > 0) throw new Error(`${error instanceof Error ? error.message : String(error)}; ${cleanupErrors.join("; ")}`);
    throw error;
  }
}

async function acquireOne(path: string, ordinal: number, context: AcquireContext, signal: AbortSignal, captured?: CapturedRenderInput): Promise<DocumentInput> {
  const infrastructure: InfraEvent[] = [];
  let original: string;
  let originalBytes: Buffer;
  try {
    if (!captured && lstatSync(path).isSymbolicLink()) throw new Error("input symlink is not accepted");
    originalBytes = captured ? Buffer.from(captured.html) : captureRegularFile(dirname(resolve(path)), basename(resolve(path)), MAX_RESOURCE_BYTES);
    original = decodeUtf8Strict(originalBytes, path);
  } catch (error) {
    return { path, snapshot: null, infrastructure: [{
      kind: error instanceof StrictUtf8Error ? "source-input-invalid" : "source-acquisition-failed",
      detail: `input capture failed: ${error instanceof Error ? error.message : String(error)}`,
      measured: { stage: "input-capture" },
    }] };
  }
  let assets: Map<string, CapturedAsset>;
  let externalDeploymentRequiredRoutes = new Set<string>();
  try {
    if (captured) {
      assets = new Map([...captured.assets.entries()].map(([route, asset]) => [route, {
        real: `/${asset.logicalPath}`,
        bytes: Buffer.from(asset.bytes),
        text: extname(asset.logicalPath).toLowerCase() === ".css" ? decodeUtf8Strict(asset.bytes, asset.logicalPath) : null,
      }]));
    } else {
      const discovery = discoverLocalAssetClosure(original, path);
      assets = discovery.assets;
      externalDeploymentRequiredRoutes = discovery.externalDeploymentRequiredRoutes;
    }
  } catch (error) {
    if (error instanceof ResourceLimitError) {
      return { path, snapshot: null, infrastructure: [{
        kind: "limit-exceeded", detail: error.message, measured: error.measured,
      }] };
    }
    return { path, snapshot: null, infrastructure: [{
      kind: error instanceof StrictUtf8Error ? "source-input-invalid" : "source-acquisition-failed",
      detail: `resource snapshot failed: ${error instanceof Error ? error.message : String(error)}`,
      measured: { stage: "resource-capture" },
    }] };
  }
  const sources = collisionSources(original, assets);
  const collision = detectCollision(sources);
  if (context.options.sourceMapInjection && collision.collided) {
    return {
      path,
      snapshot: null,
      infrastructure: [{ kind: "source-id-namespace-collision", detail: collisionDetail(collision), measured: {
        occurrences: collision.occurrences.length,
        scanned: collision.scanned,
        unreachable: collision.unreachable,
      } }],
    };
  }

  const injected = context.options.sourceMapInjection
    ? context.injectSourceIds(original, path)
    : { html: original, map: {}, blocks: 0, svgTargets: 0, synthesised: 0 };
  if (context.options.sourceMapInjection) {
    const provenance = validateInjectedProvenance(original, injected);
    if (!provenance.ok) {
      return {
        path,
        snapshot: null,
        infrastructure: [{
          kind: "checker-crashed",
          detail: `source provenance validation failed: ${provenance.issues.slice(0, 5).join("; ")}`,
          measured: { stage: "provenance", issues: provenance.issues.length },
        }],
      };
    }
  }
  const originalMap: Record<string, SourceRef> = {};
  if (captured?.sourceRefForOutput && context.options.sourceMapInjection) {
    for (const [key, ref] of Object.entries(injected.map)) {
      const resolved = captured.sourceRefForOutput(ref.offset, ref.endOffset);
      if (resolved) originalMap[key] = resolved;
    }
  }
  const additionalCss = sources.slice(1).map((source) => ({ origin: source.origin, text: source.text }));
  const sourceModel = buildSourceModel(injected.html, path, additionalCss);
  const served = await serveDocument({
    // The paginator is installed over the browser-driver boundary after navigation. Keep these
    // bytes identical to the authored/injected documents so their CSP remains authoritative.
    injectedHtml: injected.html,
    controlHtml: original,
    assets,
    documentRoot: captured ? "/" : dirname(resolve(path)),
    ...(captured ? { resourceScheme: "artifact" as const } : {}),
    ...(captured ? { documentRoute: `/${path}` } : {}),
    blocked: context.blocked,
  });

  let openedMain: OpenedContentPage | null = null;
  const observedNetworks: NetworkTracker[] = [];
  const observeNetwork = (network: NetworkTracker): void => { observedNetworks.push(network); };
  let acquisition: DocumentInput["acquisition"];
  const currentAcquisition = (): NonNullable<DocumentInput["acquisition"]> => {
    const resources = measuredResources([], served.origin, served.resources, observedNetworks.flatMap(network => network.resources));
    return { resources, inputIdentity: inputIdentity({
      html: original, browserVersion: context.browserVersion, platform: process.platform,
      fontFamilies: [], resources, redirects: observedNetworks.flatMap(network => network.redirects),
    }) };
  };
  const closePage = async (): Promise<void> => {
    if (!openedMain) return;
    await openedMain.close();
  };
  try {
    let controlSignature: ControlSignature | null = null;
    if (context.options.sourceMapInjection) {
      served.select("control");
      const controlOpened = await openContentPage(context, served.origin, served.documentRoute, [], false, signal, observeNetwork);
      try {
        await controlOpened.page.evaluate<void>(freezeSource(controlOpened.apparatusCapability));
        const controlStable = await awaitStableLayout({
          sample: () => sampleParts(controlOpened.page),
          wait: (ms) => new Promise((r) => setTimeout(r, ms)),
        });
        if (!controlStable.stable) {
          infrastructure.push({
            kind: "document-not-quiescent",
            detail: "the un-injected §10.5 control run did not settle",
            measured: controlStable.drift ? { ...controlStable.drift, run: "control" } : { run: "control" },
          });
        }
        controlSignature = await controlOpened.page.evaluate<ControlSignature>(CONTROL_SIGNATURE_SOURCE);
      } finally {
        await controlOpened.close();
      }
    }

    served.select("injected");
    const expectedSids = context.options.sourceMapInjection
      ? orderedSourceSids(injected.map).filter((key) => key.startsWith("s"))
      : [];
    const opened = await openContentPage(
      context,
      served.origin,
      served.documentRoute,
      expectedSids,
      true,
      signal,
      observeNetwork,
    );
    openedMain = opened;
    const page = opened.page;
    if (opened.imageFailures.length > 0) {
      infrastructure.push({
        kind: "image-content-unavailable",
        detail:
          `${opened.imageFailures.length} image resource(s) could not be decoded; layout measurement ` +
          "continued because every failed image retained a non-zero rendered box and explicit authored dimensions.",
        measured: {
          images: opened.imageFailures.map((image) => ({
            // Do not persist an absolute file URL or a remote query string in a report. The
            // resource order plus measured box is sufficient evidence for this non-fatal event;
            // the input document remains the source of the authored URL.
            resourceIndex: image.resourceIndex,
            widthPx: Number(image.width.toFixed(4)),
            heightPx: Number(image.height.toFixed(4)),
            declaredWidthPx: image.declaredWidth,
            declaredHeightPx: image.declaredHeight,
          })),
        },
      });
    }
    const primitiveStatus = await page.evaluate<PrimitivesStatus>(PRIMITIVES_CHECK);
    if (!primitiveStatus.ok) {
      infrastructure.push({ kind: "checker-crashed", detail: primitiveStatus.reason, measured: { stage: "primitives" } });
    }
    const initiallyQuiet = await awaitNetworkQuiet(opened.network, PAGINATION_TIMEOUT_MS, signal);
    if (!initiallyQuiet) {
      infrastructure.push({
        kind: "document-not-quiescent",
        detail: "network activity did not settle after afterRendered",
        measured: { inFlight: opened.network.inFlight.size, pendingBodies: opened.network.pendingBodies.size },
      });
    }
    opened.network.activityAfterRendered = 0;
    await page.evaluate<void>(freezeSource(opened.apparatusCapability));
    const stable = await awaitStableLayout({ sample: () => sampleParts(page!), wait: (ms) => new Promise((r) => setTimeout(r, ms)) });
    await verifyAnimationIntervention(page, "snapshot");
    if (!stable.stable) {
      infrastructure.push({
        kind: "document-not-quiescent",
        detail: `layout did not settle after ${stable.retries} retries; moved: ${stable.drift?.components.join(", ") ?? "unknown"}`,
        measured: stable.drift ? { ...stable.drift, retries: stable.retries } : { retries: stable.retries },
      });
    }
    const limitStatus = await page.evaluate<{ pages: number; domNodes: number }>(LIMIT_STATUS_SOURCE);
    const integrityAtSnapshot = await page.evaluate<RuntimeIntegrityStatus>(integrityStatusSource(opened.apparatusCapability));
    infrastructure.push(...operationalLimitEvents({
      pages: limitStatus.pages,
      domNodes: limitStatus.domNodes,
      mutationsAfterRendered: integrityAtSnapshot.mutationRecordsAfterRendered,
      resourceLimit: opened.network.limitExceeded,
    }));
    if (fatalInfrastructure(infrastructure)) {
      await closePage();
      return { path, snapshot: null, infrastructure };
    }
    if (integrityAtSnapshot.sidMutations > 0) {
      infrastructure.push({
        kind: "checker-crashed",
        detail: "reserved source-id attributes changed after the pristine parser state",
        measured: { stage: "source-id-integrity", sidMutations: integrityAtSnapshot.sidMutations },
      });
    }
    const snapshotSidIssues = validateRuntimeSidState(expectedSids, integrityAtSnapshot);
    if (snapshotSidIssues.length > 0) {
      infrastructure.push({
        kind: "checker-crashed",
        detail: `source-id integrity changed before snapshot: ${snapshotSidIssues.join("; ")}`,
        measured: { stage: "source-id-integrity", issues: snapshotSidIssues.length },
      });
    }
    if (integrityAtSnapshot.paginationPreviewCalls !== 1) {
      infrastructure.push({
        kind: "checker-crashed",
        detail: "pagination apparatus was invoked outside its single Node-controlled epoch",
        measured: { stage: "pagination-apparatus", previewCalls: integrityAtSnapshot.paginationPreviewCalls },
      });
    }
    if (opened.network.errors.length > 0) {
      infrastructure.push({
        kind: "checker-crashed",
        detail: captured
          ? "captured document network provenance could not be completed; private driver errors withheld"
          : `network provenance could not be completed: ${opened.network.errors.slice(0, 3).join("; ")}`,
        measured: { stage: "network-provenance", errors: opened.network.errors.length },
      });
    }
    if (!opened.collectorNonce) throw new Error("collector identity was not allocated");
    const collector = await page.evaluate<CollectorResult>(
      `window.__blPrimitives.collectorResult(${JSON.stringify(opened.apparatusCapability)}, ${JSON.stringify(opened.collectorNonce)})`,
    );
    const silent = silentHooks(collector.hooks);
    if (silent.length > 0) {
      infrastructure.push({
        kind: silent.includes("afterRendered") ? "after-rendered-missing" : "pagination-aborted",
        detail: `Paged.js hooks that never fired: ${silent.join(", ")}`,
        measured: { hooks: collector.hooks },
      });
    }
    if (collector.discardedRecords > 0 || collector.unreconciledPages > 0 || collector.attributeDrift.length > 0) {
      infrastructure.push({
        kind: "document-not-quiescent",
        detail:
          `collector reconciliation failed: ${collector.discardedRecords} discarded, ` +
          `${collector.unreconciledPages} unreconciled, ${collector.attributeDrift.length} changed edge fields`,
        measured: {
          discardedRecords: collector.discardedRecords,
          unreconciledPages: collector.unreconciledPages,
          attributeDrift: collector.attributeDrift.slice(0, 10),
        },
      });
    }
    const raw = await page.evaluate<RawSnapshot>(SNAPSHOT_SOURCE);
    const geometry = await crossCheckPage(page);
    // The residue probe runs only on the failing branch. It is a full DOM walk per page, and on a
    // sound document the answer is always empty — paying for it on every run to say nothing is the
    // wrong trade. On the failing branch it is the difference between naming a cause and accusing
    // this tool's own probe.
    infrastructure.push(
      geometry.ok
        ? crossCheckPassedEvent(geometry)
        : crossCheckEvent(geometry, await fragmentainerResidue(page)),
    );

    if (controlSignature) {
      const comparison = compareControlSignatures(raw.control, controlSignature);
      if (!comparison.equal) {
        infrastructure.push({
          kind: "injection-interference",
          detail: `source-id injection changed the §10.5 control quantities: ${comparison.changed.join(", ")}`,
          measured: { changed: comparison.changed },
        });
      }
    }

    const facts = boundaryFactsFrom(collector.pages);
    const causes = assignPageCauses(collector.pages.length, facts, collector.pages.map((p) => p.blank));
    const unknown = causes.flatMap((cause, index) => [
      ...(cause.incoming.kind === "unknown" ? [{ page: index + 1, side: "incoming" }] : []),
      ...(cause.outgoing.kind === "unknown" ? [{ page: index + 1, side: "outgoing" }] : []),
    ]);
    if (unknown.length > 0) {
      infrastructure.push({
        kind: "break-cause-undetermined",
        detail: `${unknown.length} page edge(s) could not be reconciled to a Paged.js decision`,
        measured: { edges: unknown.slice(0, 20) },
      });
    }

    const resources = measuredResources(
      raw.requestedUrls,
      served.origin,
      served.resources,
      opened.network.resources,
    );
    const identity = inputIdentity({
      html: original,
      browserVersion: context.browserVersion,
      platform: process.platform,
      fontFamilies: raw.fontFamilies,
      resources,
      redirects: opened.network.redirects,
    });
    acquisition = { inputIdentity: identity, resources };
    const fontIdentity = captured?.producer && captured.sourceFiles
      ? await measureCapturedFontIdentity(page, original, resources, captured.sourceFiles)
      : undefined;
    // Failed resource-bearing requests veto measurement. A loopback 403 for an authored XHR or
    // `preload as=fetch` is still observed and recorded in input identity, but it is not a layout
    // resource and cannot make a completed rendered page unmeasurable. The fixture exercises this
    // distinction with denied XHR/preload probes. Remote failures remain fatal because they cannot
    // be tied to a local browser request role under the captured-resource closure.
    // Fonts and images have dedicated browser barriers below: a failed font is fatal and a failed
    // image is accepted only after its actual rendered box matches explicit authored dimensions.
    const requiredLocalRoles = new Set(["stylesheet", "script", "media"]);
    const failedRequiredResources = resources.filter((resource) => {
      // Inline data/blob/about resources never cross the local-file or network allowlist. The
      // existing decode/font gates handle them; synthetic performance-only null-status records
      // must not invent a load failure when this tracker did not observe one.
      if (resource.status === null && ["data", "blob", "about"].includes(resource.scheme) &&
          !opened.network.resources.includes(resource)) return false;
      if (resource.outcome === "loaded" && (resource.status === null || resource.status < 400)) return false;
      try {
        const pathname = served.resourceRoutes.get(resource);
        if (!pathname) return true;
        if (externalDeploymentRequiredRoutes.has(pathname)) return false;
        const roles = opened.network.localRequestRoles.get(pathname);
        return !!roles && [...roles].some((role) => requiredLocalRoles.has(role));
      }
      catch { return true; }
    });
    if (failedRequiredResources.length > 0) {
      await closePage();
      return {
        path,
        snapshot: null,
        acquisition: { inputIdentity: identity, resources },
        infrastructure: [{
          kind: "source-acquisition-failed",
          detail: `required document resource request failed: ${failedRequiredResources.slice(0, 4).map((resource) => `${resource.resolvedUri} (${resource.status})`).join(", ")}`,
          measured: { stage: "resource-request", failures: failedRequiredResources.length },
        }],
      };
    }
    const snapshot = assembleSnapshot({
      raw,
      collector,
      sourceModel,
      sourceMap: injected.map,
      originalSourceMap: originalMap,
      sourceMapInjection: context.options.sourceMapInjection,
      renderer: context.rendererPath,
      browserVersion: context.browserVersion,
      pagedjsVersion: context.pagedjsVersion,
      platform: process.platform,
      locale: context.options.locale,
      freezeSignature: stable.signature,
      freezeRetries: stable.retries,
      inputIdentity: identity,
      evidenceOverlayApplied: false,
      cascadeHints: opened.cascadeHints,
      resources,
      sourceInput: {
        identityStatus: "verified",
        rawBytesSha256: createHash("sha256").update(originalBytes).digest("hex"),
        byteLength: originalBytes.length,
        encoding: "utf-8",
        complete: true,
      },
      ...(captured?.sourceFiles === undefined ? {} : { sourceFiles: captured.sourceFiles }),
      sourceProvenance: captured?.producer
        ? {
          // Exact editability is per SID in originalSourceMap, never a document-wide claim.
          binding: "producer-bound", copyIntegrity: "verified",
          producerId: captured.producer.id, receiptHash: captured.producer.receiptHash,
          codeSha256: captured.producer.codeSha256, optionsSha256: captured.producer.optionsSha256,
          diagnostics: [],
        }
        : { binding: "unavailable", copyIntegrity: "unavailable", diagnostics: [] },
    });
    const invariantValidation = validateSnapshotInvariants(snapshot, {
      sourceMapInjection: context.options.sourceMapInjection,
    });
    if (!invariantValidation.ok) {
      infrastructure.push({
        kind: "checker-crashed",
        detail: `snapshot invariant validation failed: ${invariantValidation.issues.slice(0, 8).join("; ")}`,
        measured: { stage: "snapshot-invariants", issues: invariantValidation.issues.length },
      });
    }

    // Bind the PDF to the state that was actually judged. A stable-but-different second state is
    // still a mismatch: settling after the snapshot cannot retroactively change its findings.
    const prePdf = await awaitStableLayout({
      sample: () => sampleParts(page),
      wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    });
    await verifyAnimationIntervention(page, "pre-pdf");
    const integrityBeforePdf = await page.evaluate<RuntimeIntegrityStatus>(integrityStatusSource(opened.apparatusCapability));
    const prePdfSidIssues = validateRuntimeSidState(expectedSids, integrityBeforePdf);
    if (!prePdf.stable || prePdf.signature !== stable.signature ||
        integrityBeforePdf.mutationRecordsAfterRendered !== integrityAtSnapshot.mutationRecordsAfterRendered ||
        prePdfSidIssues.length > 0 || opened.pageErrors.length > 0 ||
        opened.network.activityAfterRendered > 0 || opened.network.inFlight.size > 0 || opened.network.pendingBodies.size > 0) {
      infrastructure.push({
        kind: "document-not-quiescent",
        detail: "the measured state changed before PDF production",
        measured: {
          freezeChanged: prePdf.signature !== stable.signature,
          mutationDelta: integrityBeforePdf.mutationRecordsAfterRendered - integrityAtSnapshot.mutationRecordsAfterRendered,
          networkActivity: opened.network.activityAfterRendered,
          inFlight: opened.network.inFlight.size,
          pendingBodies: opened.network.pendingBodies.size,
          sidIssues: prePdfSidIssues,
          pageErrors: opened.pageErrors,
        },
      });
    }

    if (fatalInfrastructure(infrastructure)) {
      await closePage();
      // A fatal post-assembly gate means the measured state cannot be used as a basis for rule
      // findings.  Returning it would let callers write a report that mixes an Exit-3 integrity
      // failure with ordinary findings from a state we have explicitly withdrawn.
      return { path, snapshot: null, infrastructure, acquisition };
    }
    mkdirSync(context.options.outDir, { recursive: true });
    const documentKey = documentArtifactKey(path, ordinal, context.runId);
    const reconciledPdf = async (stage: "baseline" | "marked"): Promise<Uint8Array> => {
      await verifyAnimationIntervention(page, `${stage}-pdf-before`);
      const beforeParts = await sampleParts(page);
      const beforeIntegrity = await page.evaluate<RuntimeIntegrityStatus>(integrityStatusSource(opened.apparatusCapability));
      const beforeSidIssues = validateRuntimeSidState(expectedSids, beforeIntegrity);
      if (beforeSidIssues.length > 0 || opened.pageErrors.length > 0 || opened.network.activityAfterRendered > 0 ||
          opened.network.inFlight.size > 0 || opened.network.pendingBodies.size > 0) {
        throw new Error(`${stage} PDF precondition failed: ${JSON.stringify({
          sidIssues: beforeSidIssues, pageErrors: opened.pageErrors,
          networkActivity: opened.network.activityAfterRendered,
          inFlight: opened.network.inFlight.size, pendingBodies: opened.network.pendingBodies.size,
        })}`);
      }
      // Read BEFORE the PDF, because this describes the state the rules were run against. After
      // the PDF the print-media reflow has already happened and the residue is gone -- measured:
      // the same probe run either side of one `page.pdf()` reported 3 elements and then 0.
      const residueBefore = await fragmentainerResidue(page);
      const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
      const afterParts = await sampleParts(page);
      const afterIntegrity = await page.evaluate<RuntimeIntegrityStatus>(integrityStatusSource(opened.apparatusCapability));
      const afterSidIssues = validateRuntimeSidState(expectedSids, afterIntegrity);
      const drifted = driftedComponents(beforeParts, afterParts);
      const changed = drifted.length > 0 ||
        afterIntegrity.mutationRecordsAfterRendered !== beforeIntegrity.mutationRecordsAfterRendered ||
        afterIntegrity.sidMutations !== beforeIntegrity.sidMutations || afterSidIssues.length > 0 ||
        opened.pageErrors.length > 0 || opened.network.activityAfterRendered > 0 ||
        opened.network.inFlight.size > 0 || opened.network.pendingBodies.size > 0;
      await verifyAnimationIntervention(page, `${stage}-pdf-after`);
      if (changed) {
        // `render-unstable`, not `checker-crashed`: nothing crashed. The PDF does not reproduce
        // the geometry the rules measured, which is the same statement `evidence.ts` makes about a
        // divergent mark page, and it is fatal for the same reason. Thrown as an
        // `OperationalBoundaryFailure` so the named event survives the boundary instead of being
        // re-wrapped as an anonymous crash by the catch in `renderOne`.
        throw new OperationalBoundaryFailure([{
          kind: "render-unstable",
          detail: pdfReconciliationDetail(stage, drifted, residueBefore),
          measured: {
            stage,
            driftedComponents: drifted,
            // Which ENTRIES moved, not just which component. `boxes` alone is 2 137 entries on the
            // document this was written for, of which 22 differed -- all of them one table.
            driftSample: componentDeltas(beforeParts, afterParts),
            fragmentainerResidue: residueBefore,
            mutationDelta: afterIntegrity.mutationRecordsAfterRendered - beforeIntegrity.mutationRecordsAfterRendered,
            sidMutationDelta: afterIntegrity.sidMutations - beforeIntegrity.sidMutations,
            sidIssues: afterSidIssues, pageErrors: opened.pageErrors,
            networkActivity: opened.network.activityAfterRendered,
            inFlight: opened.network.inFlight.size, pendingBodies: opened.network.pendingBodies.size,
          },
        }]);
      }
      return pdf;
    };
    const evidence = await produceEvidence({
      page,
      apparatusCapability: opened.apparatusCapability,
      pdf: reconciledPdf,
      closePage,
      rasterizer: context.rasterizer,
      options: {
        outDir: context.options.outDir,
        documentKey,
        binding: context.options.evidenceBinding && context.options.sourceMapInjection,
      },
    });
    if (evidence.overlayInstalled) {
      snapshot.meta.interventions.push("evidence-overlay");
    }
    // Evidence production is an acquisition gate too.  A raster/PDF/binding failure discovered
    // only here invalidates the state just as surely as a pre-PDF failure: do not hand callers a
    // snapshot or evidence that could still be rendered as ordinary rule findings.
    if (fatalInfrastructure(infrastructure)) await closePage();
    const finalized = finalizeEvidenceAcquisition(path, snapshot, infrastructure, evidence,
      context.options.evidenceBinding && context.options.sourceMapInjection);
    return finalized.snapshot ? { ...finalized, ...(fontIdentity ? { fontIdentity } : {}) } : { ...finalized, acquisition };
  } catch (error) {
    let cleanup = "";
    try { await closePage(); }
    catch (closeError) { cleanup = `; owned page cleanup failed: ${closeError instanceof Error ? closeError.message : String(closeError)}`; }
    const failedAcquisition = acquisition ?? currentAcquisition();
    const failedRequests = failedAcquisition.resources.filter(resource => resource.outcome !== "loaded");
    const failureEvents: InfraEvent[] = error instanceof OperationalBoundaryFailure ? error.events : [{
      kind: error instanceof FontLoadFailure ? "font-load-failed" : "checker-crashed",
      detail: captured
        ? `captured document acquisition failed at the browser/driver boundary; private error details withheld${cleanup ? "; owned page cleanup failed" : ""}`
        : `live acquisition failed at the browser/driver boundary: ${error instanceof Error ? error.message : String(error)}${cleanup}`,
      measured: { stage: "measure" },
    }];
    if (failedRequests.length > 0) failureEvents.push({
      kind: "source-acquisition-failed",
      detail: "document resource acquisition did not complete; typed request outcomes are retained",
      measured: { stage: "resource-request", failures: failedRequests.length },
    });
    return {
      path,
      snapshot: null,
      acquisition: failedAcquisition,
      infrastructure: failureEvents,
    };
  } finally {
    const cleanupResults = await Promise.allSettled([closePage(), served.close()]);
    const cleanupErrors = cleanupResults.flatMap((result) =>
      result.status === "rejected"
        ? [result.reason instanceof Error ? result.reason.message : String(result.reason)]
        : [],
    );
    if (cleanupErrors.length > 0) {
      throw new Error(`owned acquisition cleanup failed: ${cleanupErrors.join("; ")}`);
    }
  }
}

export async function renderDocuments(
  paths: readonly string[],
  options: RenderOptions,
  dependencies: RenderDependencies = DEFAULT_DEPENDENCIES,
  capturedByPath?: ReadonlyMap<string, CapturedRenderInput>,
  peerResolutionDir = process.cwd(),
): Promise<RenderResult> {
  const paged = resolvePagedjs(peerResolutionDir);
  if (!paged.ok || !paged.path) {
    return { documents: [], fatal: { exitCode: 3, message: paged.detail }, environment: null };
  }
  let pagedjsSource: string;
  try {
    // Read before launching either process. A broken bundle must not strand a browser and
    // rasteriser that were started only to discover their renderer input was unreadable.
    pagedjsSource = readFileSync(paged.path, "utf8");
  } catch (error) {
    return {
      documents: [],
      fatal: {
        exitCode: 3,
        message: `breaklint: the resolved Paged.js bundle is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      },
      environment: null,
    };
  }
  let launched: Awaited<ReturnType<typeof launchBrowser>>;
  try {
    launched = await dependencies.launchBrowser(peerResolutionDir);
  } catch (error) {
    return {
      documents: [],
      fatal: {
        exitCode: 3,
        message: `breaklint: renderer startup failed at launch: ${error instanceof Error ? error.message : String(error)}`,
      },
      environment: null,
    };
  }
  if (!launched.browser || !launched.executablePath) {
    return { documents: [], fatal: { exitCode: 3, message: launched.detail }, environment: null };
  }
  const browser = launched.browser;
  const blocked = { count: 0 };
  const contentPages = new Set<PageLike>();
  let startupStage = "browser.version";
  let browserVersion: string;
  let rasterizerResult: OpenRasterizerResult;
  try {
    browserVersion = await browser.version();
    startupStage = "openRasterizer";
    rasterizerResult = await dependencies.openRasterizer(browser, {
      fromDir: peerResolutionDir,
      contentPagesOpen: () => contentPages.size,
    });
    if (!rasterizerResult.rasterizer && rasterizerResult.fatal) {
      throw new Error(rasterizerResult.detail);
    }
  } catch (error) {
    let cleanup = "";
    const closeError = await closeBrowserBounded(browser, dependencies.terminateBrowserProcessTree);
    if (closeError) cleanup = `; browser cleanup also failed: ${closeError}`;
    const profileError = cleanupBrowserProfile(launched.userDataDir);
    if (profileError) cleanup += `; profile cleanup also failed: ${profileError}`;
    return {
      documents: [],
      fatal: {
        exitCode: 3,
        message:
          `breaklint: renderer startup failed at ${startupStage}: ` +
          `${error instanceof Error ? error.message : String(error)}${cleanup}`,
      },
      environment: null,
    };
  }
  const context: AcquireContext = {
    browser,
    browserVersion,
    rendererPath: launched.executablePath,
    pagedjsVersion: paged.version!,
    pagedjsSource,
    rasterizer: rasterizerResult.rasterizer,
    options,
    blocked,
    contentPages,
    injectSourceIds: dependencies.injectSourceIds ?? injectSourceIds,
    ownershipFailed: false,
    lateOwnershipCleanupFailed: false,
    lateOwnershipCleanupDetail: null,
    runId: randomBytes(6).toString("hex"),
  };
  const documents: DocumentInput[] = [];
  const documentTimeoutMs = dependencies.documentTimeoutMs ?? DOCUMENT_TIMEOUT_MS;
  let browserTerminationError: string | null = null;
  let rasterizerCloseError: string | null = null;
  let profileCleanupError: string | null = null;
  let timedOutAcquisition: Promise<DocumentInput> | null = null;
  try {
    for (const [ordinal, path] of paths.entries()) {
      const controller = new AbortController();
      const acquisition = acquireOne(path, ordinal, context, controller.signal, capturedByPath?.get(path));
      try {
        documents.push(await withTimeout(acquisition, documentTimeoutMs, `document ${path}`));
        if (context.ownershipFailed) break;
      } catch (error) {
        const timedOut = error instanceof BoundaryTimeoutError;
        documents.push({
          path,
          snapshot: null,
          infrastructure: [{
            kind: "checker-crashed",
            detail: timedOut
              ? `document acquisition exceeded its process boundary: ${error.message}`
              : `document acquisition failed outside its owned result boundary: ${error instanceof Error ? error.message : String(error)}`,
            measured: timedOut
              ? { stage: "document-timeout", timeoutMs: documentTimeoutMs }
              : { stage: "document-cleanup" },
          }],
        });
        if (timedOut) {
          controller.abort();
          timedOutAcquisition = acquisition;
        }
        break;
      }
    }
  } finally {
    const cleanup = await closeRendererOwnedResourcesBounded(
      () => closeRasterizerBounded(rasterizerResult.rasterizer),
      () => closeBrowserBounded(browser, dependencies.terminateBrowserProcessTree),
    );
    rasterizerCloseError = cleanup.rasterizerError;
    browserTerminationError = cleanup.browserError;
    if (timedOutAcquisition) {
      try {
        // Abort-aware driver boundaries and owned-resource cleanup make this a real join. Returning
        // while the acquisition is live would let it mutate shared state after profile cleanup.
        const joined = await withTimeout(
          timedOutAcquisition,
          BROWSER_CLOSE_TIMEOUT_MS,
          "timed-out acquisition final join",
        );
        if (context.lateOwnershipCleanupFailed) {
          for (const document of documents) document.infrastructure.push({
            kind: "checker-crashed",
            detail: `timed-out acquisition could not certify its late owned-resource cleanup: ${context.lateOwnershipCleanupDetail ?? "unspecified failure"}`,
            measured: { stage: "document-timeout-join" },
          });
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        for (const document of documents) document.infrastructure.push({
          kind: "checker-crashed",
          detail: `timed-out acquisition did not join after renderer cleanup: ${detail}`,
          measured: { stage: "document-timeout-join" },
        });
      }
    }
    profileCleanupError = cleanupBrowserProfile(launched.userDataDir);
  }
  if (browserTerminationError) {
    for (const document of documents) {
      document.infrastructure.push({
        kind: "renderer-not-terminated",
        detail: `the renderer process tree could not be verified terminated: ${browserTerminationError}`,
        measured: null,
      });
    }
  }
  if (rasterizerCloseError) {
    for (const document of documents) {
      document.infrastructure.push({
        kind: "checker-crashed",
        detail: `the rasterizer close protocol failed: ${rasterizerCloseError}`,
        measured: { stage: "rasterizer-close" },
      });
    }
  }
  if (profileCleanupError) {
    for (const document of documents) {
      document.infrastructure.push({
        kind: "checker-crashed",
        detail: `the browser profile cleanup failed: ${profileCleanupError}`,
        measured: { stage: "profile-cleanup" },
      });
    }
  }
  withdrawFatalCleanupDocuments(documents);
  return {
    documents,
    fatal: null,
    environment: {
      browserVersion,
      platform: process.platform,
      rendererPath: launched.executablePath,
      rendererPresent: true,
      pagedjsVersion: paged.version!,
      rasterizer: rasterizerResult.rasterizer?.name ?? null,
      rasterizerVersion: rasterizerResult.rasterizer?.version ?? null,
      textPositionExtractor: rasterizerResult.rasterizer
        ? { name: "pdfjs-dist textContent", version: rasterizerResult.rasterizer.version, license: "Apache-2.0" }
        : null,
      fontFamiliesResolved: [
        ...new Set(documents.flatMap((document) => document.snapshot?.meta.inputIdentity?.fontFamilies ?? [])),
      ].sort(),
      locale: options.locale,
      networkBlocked: blocked.count,
    },
  };
}

/** Internal produced-document renderer. It shares the normal browser/rule acquisition path. */
export async function renderCapturedDocuments(
  inputs: readonly CapturedRenderInput[],
  options: RenderOptions,
  dependencies: RenderDependencies = DEFAULT_DEPENDENCIES,
): Promise<RenderResult> {
  const paths = inputs.map((input) => input.path);
  if (new Set(paths).size !== paths.length) {
    return { documents: [], fatal: { exitCode: 3, message: "captured producer outputs have duplicate logical paths" }, environment: null };
  }
  // A public installed API must resolve optional peers from its own package, not from whichever
  // project happened to call it. The CLI retains its caller-CWD behavior through renderDocuments.
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  return renderDocuments(paths, options, dependencies, new Map(inputs.map((input) => [input.path, input])), packageRoot);
}
