import { randomBytes } from "node:crypto";
import { closeSync, constants, lstatSync, mkdirSync, openSync, renameSync, rmSync, writeSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import type { Evidence, Finding, Report } from "../core/types.ts";
import { READABLE_SCREEN_REPORT_SCHEMA_VERSIONS, type ReadableScreenReport, type ScreenFinding } from "../web/types.ts";
import type { ReportComparison } from "./compare.ts";
import { captureBoundedSourceFile, sha256Bytes } from "../source/bytes.ts";
import { createContextPack, type ContextFinding, type CreateContextPackOptions } from "./context.ts";
import { READABLE_REPORT_SCHEMA_VERSIONS } from "../core/enums.ts";
import { bundleColor, bundleToken, bundleTokenDeclarations } from "../report/html-tokens.ts";
import { physicalPath } from "./output-path.ts";

export interface RenderReportOptions extends CreateContextPackOptions { title?: string; theme?: "light" | "dark"; comparison?: ReportComparison; }
export interface WriteReportBundleOptions extends RenderReportOptions { outDir: string; evidenceDir?: string; }
export interface ReportBundleResult { outDir: string; reportPath: string; htmlPath: string; contextPath: string; assets: readonly string[]; }

/**
 * The three sinks of this view. Every report value reaches the HTML through exactly one of them,
 * because a report handed to `renderReport()` or `writeReportBundle()` may come from anywhere and
 * its types are only a claim: a `page` that is a string was once written into the markup as is.
 *   esc   text and attribute values (every attribute here is double-quoted)
 *   num   a value the report types as a number: shown only when it is one and finite
 *         (an exit code only when it is one of the documented codes, `exitCode`)
 *   href  a link target: only the bundle's own verified asset paths and in-page anchors
 */
const esc = (value: unknown): string => String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "�").replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
const finiteNumber = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const num = (value: unknown): string => { const n = finiteNumber(value); return n === null ? "unavailable" : String(n); };
/** An exit code is shown only when it is one of the documented codes 0–4; a finite 7 is not one. */
const exitCode = (value: unknown): string => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 4 ? String(value) : "unavailable";
const href = (value: string): string => /^(?:assets\/[a-f0-9]{64}\.(?:png|pdf)|bundle\.json|#finding(?:-navigation|-[1-9][0-9]*))$/u.test(value) ? esc(value) : "#";
const MAX_ASSET_BYTES = 64 * 1024 * 1024;

/**
 * The bundle view's stylesheet. Its custom properties are generated from the shared token table
 * (src/report/html-tokens.ts) and every colour is a token, so the same stylesheet lint covers both
 * HTML renderers. `print` redefines the complete colour set for paper whatever `theme` was chosen.
 */
const BUNDLE_HTML_STYLES = `:root{${bundleTokenDeclarations("light")}color-scheme:light dark}` +
  `html[data-theme=dark]{${bundleTokenDeclarations("dark")}}` +
  `*{box-sizing:border-box}` +
  `body{margin:0;background:${bundleColor("paper")};color:${bundleColor("ink")};font:16px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}` +
  `main{max-width:74rem;margin:auto;padding:${bundleToken("space")}}` +
  `header{border-inline-start:.4rem solid ${bundleColor("accent")};padding-inline-start:1rem}` +
  `h1{font:700 clamp(2rem,6vw,4.4rem)/.98 Georgia,serif;letter-spacing:-.035em;margin:.4rem 0 1rem}` +
  `.eyebrow,.section-label{text-transform:uppercase;letter-spacing:.08em;font-size:.78rem;color:${bundleColor("muted")}}` +
  `.state,.finding,.diagnostics{border:1px solid ${bundleColor("line")};padding:1.2rem;margin-block:1.2rem}` +
  `.state.incomplete{border-inline-start:.4rem solid ${bundleColor("warn")}}` +
  `.finding.error{border-inline-start:.4rem solid ${bundleColor("bad")}}` +
  `.finding.warn{border-inline-start:.4rem solid ${bundleColor("warn")}}` +
  `.finding.info{border-inline-start:.4rem solid ${bundleColor("accent")}}` +
  `.diagnostics{overflow-wrap:anywhere}` +
  `.finding h2{font-size:1rem;overflow-wrap:anywhere}` +
  `dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem;margin:1rem 0}` +
  `dt{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:${bundleColor("muted")}}` +
  `dd{margin:0;overflow-wrap:anywhere}` +
  `a{color:${bundleColor("ink")};text-decoration-thickness:2px;text-underline-offset:.18em}` +
  `.crop{margin:1rem 0;break-inside:avoid}` +
  `.crop svg{max-height:32rem;background:${bundleColor("evidence-ground")}}` +
  `.crop .target-outline{stroke:${bundleColor("target")}}` +
  `.crop figcaption{font-size:.82rem;color:${bundleColor("muted")}}` +
  `.evidence figure{position:relative;margin:1rem 0}` +
  `.evidence figure>.target-outline{position:absolute;border:3px solid ${bundleColor("target")};box-shadow:0 0 0 1px ${bundleColor("target-halo")};pointer-events:none}` +
  `.evidence figure>img{display:block;width:100%}` +
  `@media(max-width:390px){main{padding:1rem}dl{grid-template-columns:1fr}.finding{padding:1rem}}` +
  `@media print{@page{size:A4;margin:12mm}html[data-theme]{${bundleTokenDeclarations("print")}}main{max-width:none;padding:0}` +
  `.finding,.state{break-inside:avoid}.finding:has(.crop){break-inside:auto}.crop{break-inside:avoid;max-height:none}.crop svg{max-height:90mm!important}}` +
  `@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}`;

interface Asset { href: string; kind: "png" | "pdf"; integrity: { sha256: string; byteLength: number }; }
type AssetMap = Map<string, Asset>;

function safeExtension(path: string, allowed: readonly string[]): string | null {
  const extension = extname(path).toLowerCase();
  return allowed.includes(extension) ? extension : null;
}

function pngDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  const width = bytes.readUInt32BE(16); const height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/** Captures exactly one regular, non-symlink asset and writes those captured bytes once. */
function capturedAsset(sourceRoot: string, leaf: string, maxBytes: number): Buffer | null {
  try { return captureBoundedSourceFile(resolve(sourceRoot), leaf, maxBytes, "report evidence"); }
  catch { return null; }
}

/**
 * Replaces one file of the bundle, never writing into what is already there. The API accepts a
 * used output directory (updating a bundle in place is legitimate), and a file in it may be a hard
 * link: opening it with O_TRUNC wrote through the link into the other name's file. So the bytes go
 * to a new temporary file (O_EXCL) and a rename replaces the directory entry; a hard-linked old
 * entry keeps its bytes under its other name. A symlink at the leaf is refused, not replaced.
 */
function replaceFile(directory: string, name: string, bytes: Buffer, mode: number): void {
  const target = join(directory, name);
  let leaf: ReturnType<typeof lstatSync> | null = null;
  try { leaf = lstatSync(target); } catch { leaf = null; }
  if (leaf?.isSymbolicLink()) throw Object.assign(new Error(`report bundle file is a symbolic link: ${target}`), { code: "ELOOP" });
  if (leaf && !leaf.isFile()) throw Object.assign(new Error(`report bundle file is not a regular file: ${target}`), { code: "EISDIR" });
  const temporary = join(directory, `.${name}.${process.pid}-${randomBytes(6).toString("hex")}.breaklint-tmp`);
  try {
    const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode);
    try {
      let offset = 0;
      while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
    } finally { closeSync(fd); }
    renameSync(temporary, target);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function writeCapturedAsset(targetRoot: string, name: string, bytes: Buffer): void {
  const assets = join(targetRoot, "assets");
  const directory = lstatSync(assets);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("report asset directory is not a regular directory");
  replaceFile(assets, name, bytes, 0o600);
}

/** Top-level bundle files: like assets, a pre-existing symlink at the leaf is refused, not followed. */
function writeBundleFile(targetRoot: string, name: string, content: string): void {
  replaceFile(targetRoot, name, Buffer.from(content, "utf8"), 0o666);
}

function evidenceAsset(evidence: Evidence, sourceRoot: string, targetRoot: string): Asset | null {
  if (!evidence.integrity || !safeExtension(evidence.path, [".png"])) return null;
  if (evidence.integrity.byteLength > MAX_ASSET_BYTES) return null;
  const bytes = capturedAsset(sourceRoot, basename(evidence.path), evidence.integrity.byteLength);
  const dimensions = bytes ? pngDimensions(bytes) : null;
  if (!bytes || !dimensions || bytes.length !== evidence.integrity.byteLength || sha256Bytes(bytes) !== evidence.integrity.sha256 || dimensions.width !== evidence.integrity.widthPx || dimensions.height !== evidence.integrity.heightPx) return null;
  const file = `${evidence.integrity.sha256}.png`;
  writeCapturedAsset(targetRoot, file, bytes);
  return { href: `assets/${file}`, kind: "png", integrity: { sha256: evidence.integrity.sha256, byteLength: evidence.integrity.byteLength } };
}

function diagnosticPdf(report: Report, finding: Finding, sourceRoot: string | undefined, targetRoot: string): Asset | null {
  if (!sourceRoot) return null;
  const artifact = report.documents.find((document) => document.path === finding.document)?.renderArtifact;
  if (!artifact || !safeExtension(artifact.path, [".pdf"])) return null;
  if (artifact.byteLength > MAX_ASSET_BYTES) return null;
  const bytes = capturedAsset(sourceRoot, basename(artifact.path), artifact.byteLength);
  if (!bytes || !bytes.subarray(0, 5).equals(Buffer.from("%PDF-")) || bytes.length !== artifact.byteLength || sha256Bytes(bytes) !== artifact.sha256) return null;
  const file = `${artifact.sha256}.pdf`;
  writeCapturedAsset(targetRoot, file, bytes);
  return { href: `assets/${file}`, kind: "pdf", integrity: { sha256: artifact.sha256, byteLength: artifact.byteLength } };
}

function findingAsset(report: Report, finding: Finding, sourceRoot: string | undefined, targetRoot: string): Asset | null {
  if (!sourceRoot || !finding.evidence.ref || !finding.evidence.bindsFinding) return null;
  const evidence = report.documents.flatMap((document) => document.evidence).find((item) => item.path === finding.evidence.ref || item.key === finding.evidence.ref);
  return evidence ? evidenceAsset(evidence, sourceRoot, targetRoot) : null;
}

function cropBox(finding: Finding): { x: number; y: number; width: number; height: number; pageWidth: number; pageHeight: number } | null {
  const candidate = (finding as unknown as { target?: { renderBox?: unknown } }).target?.renderBox;
  if (!candidate || typeof candidate !== "object") return null;
  const box = candidate as Record<string, unknown>;
  const keys = ["x", "y", "width", "height", "pageWidth", "pageHeight"];
  if (!keys.every((key) => typeof box[key] === "number" && Number.isFinite(box[key]))) return null;
  const x = box.x as number; const y = box.y as number; const width = box.width as number; const height = box.height as number;
  const pageWidth = box.pageWidth as number; const pageHeight = box.pageHeight as number;
  if (pageWidth <= 0 || pageHeight <= 0 || width <= 0 || height <= 0 || x >= pageWidth || y >= pageHeight || x + width <= 0 || y + height <= 0) return null;
  return { x, y, width, height, pageWidth, pageHeight };
}

function crop(asset: Asset | null, finding: Finding): string {
  const box = cropBox(finding);
  if (!asset || asset.kind !== "png" || !box) return "";
  const pad = Math.max(24, Math.min(box.width, box.height) * .2);
  const left = Math.max(0, box.x - pad), top = Math.max(0, box.y - pad);
  const width = Math.min(box.pageWidth, box.x + box.width + pad) - left;
  const height = Math.min(box.pageHeight, box.y + box.height + pad) - top;
  const clipId = `crop-${sha256Bytes(Buffer.from(`${finding.runFindingId}:${left}:${top}:${width}:${height}`)).slice(0, 24)}`;
  return `<figure class="crop"><svg role="img" aria-label="Verified target and surrounding context" viewBox="${left} ${top} ${width} ${height}" style="display:block;width:100%"><defs><clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><rect x="${left}" y="${top}" width="${width}" height="${height}"/></clipPath></defs><g clip-path="url(#${clipId})"><image href="${href(asset.href)}" x="0" y="0" width="${box.pageWidth}" height="${box.pageHeight}"/><rect class="target-outline" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="none" stroke-width="3" vector-effect="non-scaling-stroke"/></g></svg><figcaption>Marked target context from verified full-page evidence; only the visible intersection is shown for overflow. The original box is page-relative in css-page-top-left coordinates. Source: ${source(finding)}.</figcaption></figure>`;
}

function source(finding: Finding): string {
  const original = finding.originalSource;
  if (original.status === "verified" && original.location) {
    return original.role === "verified-container-only"
      ? `Verified container only: ${displayPath(original.location.file)}:${num(original.location.line)}:${num(original.location.column)}; no exact original range`
      : `Verified original range: ${displayPath(original.location.file)}:${num(original.location.line)}:${num(original.location.column)}`;
  }
  if (original.status === "ambiguous") return `Ambiguous original source (${num(Array.isArray(original.candidates) ? original.candidates.length : null)} candidates)`;
  if (original.status === "declared") return "Declared original source; verify before editing";
  return "Original source unavailable";
}

function displayPath(value: unknown): string {
  return typeof value === "string" && /^(?:\/|~[\\/]|[A-Za-z]:[\\/]|\\\\)/u.test(value) ? "&lt;local-path-withheld&gt;" : esc(value);
}

function contextOrigin(finding: ContextFinding): string {
  const origin = finding.originalSource;
  if (origin.status === "ambiguous") return `ambiguous · ${num(origin.candidateCount)} candidate source range${origin.candidateCount === 1 ? "" : "s"} · choose none automatically`;
  if (!origin.location) return `${esc(origin.status)} · ${esc(origin.role)} · no original range`;
  const location = origin.location;
  if (origin.role === "verified-container-only") return `${displayPath(location.file)}:${num(location.line)}:${num(location.column)} · verified container only · no exact original range`;
  const integrity = origin.integrity ? ` · SHA-256 ${esc(origin.integrity.sha256)} (${num(origin.integrity.byteLength)} bytes)` : " · integrity unavailable";
  return `${displayPath(location.file)}:${num(location.line)}:${num(location.column)}–${num(location.endLine)}:${num(location.endColumn)} · bytes ${num(location.offset)}–${num(location.endOffset)} · ${esc(location.coordinateSystem)} · ${esc(origin.status)} · ${esc(origin.role)}${integrity}`;
}

function contextEvaluation(finding: ContextFinding): string {
  const evaluation = finding.evaluation;
  if (!evaluation) return "No uniquely matching canonical target evaluation is available.";
  const values = evaluation.measurements.map((item) => `${item.name} ${item.operator ?? ""} ${item.value ?? "null"}${item.unit ? ` ${item.unit}` : ""}${item.threshold === null ? "" : ` threshold ${item.threshold}`}`).join("; ");
  return `Status ${evaluation.status}; predicate ${evaluation.predicate.connective}/${String(evaluation.predicate.violated)}; ${evaluation.reason ?? "no decline reason"}; ${values || "no measurement values"}.`;
}

function findingCard(report: Report, finding: Finding, index: number, assets: AssetMap, evidenceDir: string | undefined, outputRoot: string, context: ContextFinding | undefined): string {
  const asset = findingAsset(report, finding, evidenceDir, outputRoot);
  if (asset) assets.set(finding.runFindingId, asset);
  const pdf = diagnosticPdf(report, finding, evidenceDir, outputRoot);
  if (pdf) assets.set(`pdf:${pdf.integrity.sha256}`, pdf);
  const evidence = asset ? `<a href="${href(asset.href)}">Open verified full-page evidence</a>` : "Evidence unavailable or failed integrity verification.";
  const pdfLink = pdf ? ` <a href="${href(pdf.href)}">Open verified diagnostic PDF</a>` : "";
  const origin = context ? contextOrigin(context) : `${source(finding)} · role ${esc(finding.originalSource.role)}`;
  const evaluation = context ? contextEvaluation(context) : "No uniquely matching canonical target evaluation is available.";
  const repair = context?.repair.options.length ? context.repair.options.map(esc).join(" ") : "No concrete verified-source repair option is available.";
  return `<article class="finding ${esc(finding.severity)}" id="finding-${index + 1}"><p class="eyebrow">${esc(finding.severity)} · ${esc(finding.ruleId)}</p><h2>${esc(finding.runFindingId)}</h2><p>${esc(finding.message)}</p><dl><div><dt>Measured</dt><dd>${num(finding.measurement.value)} ${esc(finding.measurement.unit)}</dd></div><div><dt>Threshold</dt><dd>${num(finding.measurement.threshold)} ${esc(finding.measurement.unit)}</dd></div><div><dt>Scope</dt><dd>${displayPath(finding.document)} · diagnostic page ${num(finding.page)} · target ${esc(finding.target.nodeKey)} · box ${finding.target.renderBox ? "css-page-top-left" : "css-screen-pixels"}</dd></div><div><dt>Original source range</dt><dd>${origin}</dd></div><div><dt>Canonical evaluation</dt><dd>${esc(evaluation)}</dd></div><div><dt>Input position / identity</dt><dd>${finding.source ? `${displayPath(finding.source.file)}:${num(finding.source.line)}:${num(finding.source.column)} (${esc(finding.source.coordinateSystem)})` : "unavailable"} · ${esc(finding.stableIdentity.status)}</dd></div></dl><p><strong>Proven fact:</strong> the measurement above was recorded for this target.</p><p><strong>Possible causes:</strong> not established by this report.</p><p><strong>Repair option:</strong> ${repair}</p><p><strong>Next check:</strong> inspect source and evidence, then recheck under compatible conditions.</p><p class="evidence">${evidence}${pdfLink}</p>${crop(asset, finding)}<p><a href="#finding-navigation">Back to findings</a></p></article>`;
}

/** Script-free, offline HTML from a canonical document report (schema 4 or 5) or a screen report. It does not make evidence navigable by itself. */
export function renderReport(report: Report | unknown, options: RenderReportOptions = {}): string {
  const context = createContextPack(report, options);
  // The context pack already decided whether this report can be projected; a stamped report
  // without the parts the projection reads is "legacy or invalid" there, and so it is here.
  const invalid = context.selection.reason === "legacy-or-invalid-report-cannot-establish-source-or-repair-claims";
  const isScreen = !invalid && READABLE_SCREEN_REPORT_SCHEMA_VERSIONS.includes(context.canonicalReport.schemaVersion as number) && context.canonicalReport.profileKind === "screen";
  const legacy = invalid || !isScreen && (!READABLE_REPORT_SCHEMA_VERSIONS.includes(context.canonicalReport.schemaVersion as number) || context.canonicalReport.profileKind !== "document");
  const title = options.title ?? "breaklint report";
  const theme = options.theme ?? "light";
  if (options.comparison && options.comparison.afterRunId !== context.canonicalReport.runId) throw new Error("comparison does not refer to this current report");
  const comparison = options.comparison ? `<section class="state"><h2>Repair comparison</h2><p>Before ${esc(options.comparison.beforeRunId)} → after ${esc(options.comparison.afterRunId)}</p><dl>${(["new", "persisting", "resolved", "unmatchable", "not-sufficiently-measured"] as const).map(status => `<div><dt>${status}</dt><dd>${options.comparison!.results.filter(item => item.status === status).length}</dd></div>`).join("")}</dl><ul>${options.comparison.results.map(item => `<li>${esc(item.beforeRunFindingId ?? item.afterRunFindingIds.join(", "))}: ${esc(item.status)} — ${esc(item.reasons.join(", "))}</li>`).join("")}</ul><p>Absent or reduced measurement is not a repair. Identical removal and recreation between observations cannot be distinguished.</p></section>` : "";
  const documentFindings = context.findings.filter((item): item is ContextFinding => "runFindingId" in item);
  const screenCards = context.findings.filter((item) => "id" in item).map((item, index) => `<article class="finding ${esc(item.severity)}" id="finding-${index + 1}"><p class="eyebrow">${esc(item.severity)} · ${esc(item.ruleId)}</p><h2>${esc(item.id)}</h2><p>${esc(item.observation)}</p><dl><div><dt>Measured</dt><dd>${num(item.measurement.value)} ${esc(item.measurement.unit ?? "")}</dd></div><div><dt>Scenario / route</dt><dd>${esc(item.scope.scenario)} · ${esc(item.scope.route)} · ${esc(item.scope.viewport)}</dd></div><div><dt>Target</dt><dd>${esc(item.scope.targetRef)} · ${esc(item.scope.coordinateSystem)}</dd></div><div><dt>Source</dt><dd>${esc(item.source.status)} ${item.source.file ? displayPath(item.source.file) : ""}</dd></div><div><dt>Evidence</dt><dd>${item.evidence.bindsFinding ? esc(item.evidence.screenshot ?? "bound asset unavailable") : "not bound"}</dd></div></dl><p><strong>Next check:</strong> rerun the same scenario and viewport after a bounded repair.</p><p><a href="#finding-navigation">Back to findings</a></p></article>`).join("");
  const runState = `<dl class="run-state"><div><dt>Verdict / exit</dt><dd>${esc(context.run.verdict ?? "unavailable")} / ${exitCode(context.run.exitCode)}</dd></div><div><dt>Infrastructure events</dt><dd>${num(context.run.infrastructureCount)}</dd></div><div><dt>Not measured</dt><dd>${num(context.run.notMeasuredCount)}</dd></div></dl>`;
  const diagnostics = context.diagnostics.items.length === 0 ? "" : `<section class="diagnostics" aria-labelledby="diagnostics-heading"><h2 id="diagnostics-heading">Infrastructure and nonmeasurement</h2><ul>${context.diagnostics.items.map((item) => `<li><code>${esc(item.kind)}</code>: ${esc(item.reason)}${item.context ? ` · ${esc(item.context)}` : ""}</li>`).join("")}</ul>${context.diagnostics.omittedCount ? `<p>${num(context.diagnostics.omittedCount)} additional diagnostic entries omitted from this bounded view; inspect canonical JSON.</p>` : ""}</section>`;
  const navigation = `<nav id="finding-navigation" aria-label="Finding navigation">${context.findings.map((item, index) => `<a href="#finding-${index + 1}">${index + 1}. ${esc(item.severity)} ${esc(item.ruleId)}</a>`).join(" · ")}</nav>`;
  const cards = legacy ? `<section class="state"><h2>Legacy or invalid report</h2><p>Source verification and repair claims are unavailable for this report shape. Inspect canonical JSON with a compatible breaklint version.</p>${runState}</section>` : `<section class="state ${context.selection.complete ? "complete" : "incomplete"}"><h2>${context.selection.complete ? "Measured report" : "Incomplete report"}</h2><p>${context.selection.complete ? "The bounded context includes all recorded findings." : `Do not treat absence as repair. ${esc(context.selection.reason)}; omitted findings: ${num(context.selection.omittedCount)}.`}</p>${runState}</section><section class="cards"><p class="section-label">Prioritized findings</p>${navigation}${isScreen ? screenCards : documentFindings.map((item, index) => `<article class="finding ${esc(item.severity)}" id="finding-${index + 1}"><p class="eyebrow">${esc(item.severity)} · ${esc(item.ruleId)}</p><h2>${esc(item.runFindingId)}</h2><p>${esc(item.observation)}</p><dl><div><dt>Measured</dt><dd>${num(item.measurement.value)} ${esc(item.measurement.unit)}</dd></div><div><dt>Threshold</dt><dd>${num(item.measurement.threshold)} ${esc(item.measurement.unit)}</dd></div><div><dt>Scope</dt><dd>${esc(item.scope.document)} · diagnostic page ${num(item.scope.page)} · ${esc(item.scope.coordinateSystem)}</dd></div><div><dt>Original source range</dt><dd>${contextOrigin(item)}</dd></div></dl><p><strong>Canonical evaluation:</strong> ${esc(contextEvaluation(item))}</p><p><strong>Repair option:</strong> ${item.repair.options.length ? item.repair.options.map(esc).join(" ") : "No concrete verified-source repair option is available."}</p><p><strong>Next check:</strong> inspect source and evidence, then recheck after a bounded repair.</p><p><a href="#finding-navigation">Back to findings</a></p></article>`).join("") || "<p>No finding cards were recorded. Infrastructure and nonmeasurement counts remain above.</p>"}</section>`;
  return `<!doctype html><html lang="en" data-theme="${esc(theme)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'"><title>${esc(title)}</title><style>${BUNDLE_HTML_STYLES}</style></head><body><main><header><p class="eyebrow">Canonical JSON report ${esc(context.canonicalReport.runId ?? "unavailable")}</p><h1>${esc(title)}</h1><p>JSON is canonical. This offline view is a bounded projection.</p></header>${comparison}${diagnostics}${cards}<footer><p>${esc(context.untrustedData.notice)}</p></footer></main></body></html>`;
}

/** Writes report.json, context.json and a self-contained report.html. Assets are copied only after hash and path verification. */
export function writeReportBundle(report: Report | ReadableScreenReport, options: WriteReportBundleOptions): ReportBundleResult {
  // A non-object cannot be a report; it was once noticed only after the output directory existed.
  if (report === null || typeof report !== "object" || Array.isArray(report)) throw new TypeError("writeReportBundle requires a report object");
  // Resolved as the file system resolves it, so `link/../dir` is the directory beside the link's
  // target that a caller's own check (and the CLI's empty-directory check) looked at.
  const root = physicalPath(options.outDir);
  if (options.comparison) {
    if (options.comparison.afterRunId !== report.runId) throw new Error("comparison does not refer to this current report");
  }
  // Validate and render canonical inputs BEFORE mutating the output directory,
  // so a rejected comparison or invalid report never leaves a mixed bundle on disk.
  const contextPack = createContextPack(report, options);
  let html = renderReport(report, options);
  const canonical = JSON.stringify(report, null, 2) + "\n";

  mkdirSync(join(root, "assets"), { recursive: true });
  const assetsDirectory = lstatSync(join(root, "assets"));
  if (!assetsDirectory.isDirectory() || assetsDirectory.isSymbolicLink()) throw new Error("report asset directory is not a regular directory");
  const assets: AssetMap = new Map();

  // Render once more with only validated assets. This keeps unsafe evidence strings as text.
  const selected = contextPack.findings;
  const cards = report.profileKind === "screen"
    ? selected.map((item, index) => "id" in item ? screenFindingCard(report, report.findings.find((finding) => finding.id === item.id)!, index, assets, options.evidenceDir, root) : "").join("")
    : selected.map((item, index) => "runFindingId" in item ? findingCard(report, report.findings.find((finding) => finding.runFindingId === item.runFindingId)!, index, assets, options.evidenceDir, root, item) : "").join("");
  html = html.replace(/<section class="cards">[\s\S]*?<\/section>/u, () => `<section class="cards"><p class="section-label">Prioritized findings</p><nav id="finding-navigation" aria-label="Finding navigation">${selected.map((item, index) => `<a href="#finding-${index + 1}">${index + 1}. ${esc(item.severity)} ${esc(item.ruleId)}</a>`).join(" · ")}</nav>${cards || "<p>No finding cards were recorded.</p>"}</section>`);
  const bundleEvidence = {
    contractVersion: 1,
    reportScope: "historical-capture",
    comparisonScope: options.comparison ? "historical-reports-not-a-current-asset-recheck" : null,
    findings: selected.map((item) => {
      const id = "runFindingId" in item ? item.runFindingId : item.id;
      const asset = assets.get(id);
      return { findingId: id, status: asset ? "available" : "missing-or-integrity-failed", asset: asset ? { path: asset.href, ...asset.integrity } : null };
    }),
    assets: [...new Map([...assets.values()].map(asset => [asset.href, asset])).values()].map(asset => ({ path: asset.href, kind: asset.kind, ...asset.integrity })),
  };
  const availability = `<section class="diagnostics"><h2>Current bundle evidence</h2><p>Canonical JSON describes the historical capture. This bundle separately verifies the copied files. A comparison of historical reports is not a current asset recheck.</p><ul>${bundleEvidence.findings.map(item => `<li>${esc(item.findingId)}: ${esc(item.status)}${item.asset ? ` · <a href="${href(item.asset.path)}">verified asset</a> · SHA-256 ${esc(item.asset.sha256)}` : ""}</li>`).join("")}</ul><p><a href="bundle.json">Complete asset integrity manifest</a></p></section>`;
  html = html.replace('<section class="cards">', () => `${availability}<section class="cards">`);

  writeBundleFile(root, "report.json", canonical);
  if (options.comparison) {
    writeBundleFile(root, "comparison.json", JSON.stringify(options.comparison, null, 2) + "\n");
  }
  writeBundleFile(root, "bundle.json", JSON.stringify(bundleEvidence, null, 2) + "\n");
  writeBundleFile(root, "context.json", JSON.stringify({ ...contextPack, bundleEvidence }, null, 2) + "\n");
  writeBundleFile(root, "report.html", html);
  // The paths are reported as the caller wrote them (resolved) unless that spelling names a
  // different directory than the one written, which only a `..` after a symlink does.
  const lexical = resolve(options.outDir);
  const shown = physicalPath(lexical) === root ? lexical : root;
  return { outDir: shown, reportPath: join(shown, "report.json"), htmlPath: join(shown, "report.html"), contextPath: join(shown, "context.json"), assets: [...assets.values()].map((asset) => asset.href) };
}

function screenFindingCard(report: ReadableScreenReport, finding: ScreenFinding, index: number, assets: AssetMap, evidenceDir: string | undefined, root: string): string {
  const artifact = report.artifact;
  let asset: Asset | null = null;
  if (evidenceDir && finding.evidence.bindsFinding && artifact.relativePath && artifact.sha256 && artifact.byteLength && artifact.widthPx && artifact.heightPx) {
    const bytes = artifact.byteLength <= MAX_ASSET_BYTES ? capturedAsset(evidenceDir, artifact.relativePath, artifact.byteLength) : null;
    const dimensions = bytes ? pngDimensions(bytes) : null;
    if (bytes && dimensions && bytes.length === artifact.byteLength && sha256Bytes(bytes) === artifact.sha256 && dimensions.width === artifact.widthPx && dimensions.height === artifact.heightPx) {
      const file = `${artifact.sha256}.png`;
      writeCapturedAsset(root, file, bytes);
      asset = { href: `assets/${file}`, kind: "png", integrity: { sha256: artifact.sha256, byteLength: artifact.byteLength } };
      assets.set(finding.id, asset);
    }
  }
  const source = report.evaluations.find((entry) => entry.id === finding.evaluationId)?.source;
  // Geometry is only used when every value is a finite number; otherwise there is no outline.
  const rawBox = finding.target.box;
  const box = rawBox && [rawBox.x, rawBox.y, rawBox.width, rawBox.height].every((value) => finiteNumber(value) !== null) ? rawBox : null;
  const scale = finiteNumber(report.scope.viewport.deviceScaleFactor) ?? 0;
  const widthPx = finiteNumber(artifact.widthPx) ?? 0, heightPx = finiteNumber(artifact.heightPx) ?? 0;
  const width = widthPx && scale > 0 ? widthPx / scale : 0;
  const height = heightPx && scale > 0 ? heightPx / scale : 0;
  const addScroll = artifact.capture === "full-page" && finding.target.coordinateSystem !== "css-document-pixels";
  const scrollX = finiteNumber(finding.target.scroll?.x), scrollY = finiteNumber(finding.target.scroll?.y);
  const x = box && (!addScroll || scrollX !== null) ? box.x + (addScroll ? scrollX! : 0) : 0;
  const y = box && (!addScroll || scrollY !== null) ? box.y + (addScroll ? scrollY! : 0) : 0;
  const left = Math.max(0, x), top = Math.max(0, y);
  const right = Math.min(width, x + (box?.width ?? 0)), bottom = Math.min(height, y + (box?.height ?? 0));
  const outline = box && width > 0 && height > 0 && right > left && bottom > top
    ? `<span class="target-outline" aria-hidden="true" style="left:${left / width * 100}%;top:${top / height * 100}%;width:${(right - left) / width * 100}%;height:${(bottom - top) / height * 100}%"></span>` : "";
  const evidence = asset ? `<figure style="position:relative;margin:1rem 0"><img style="display:block;width:100%" src="${href(asset.href)}" alt="Verified screen evidence with marked visible target">${outline}</figure><a href="${href(asset.href)}">Open verified full screen surface</a><p>Visible intersection of the target box; coordinates: ${esc(finding.target.coordinateSystem)}. Capture: ${esc(artifact.capture)}.</p>` : "Evidence unavailable or failed integrity verification.";
  const repairByRule: Record<ScreenFinding["ruleId"], string> = {
    "web/unexpected-horizontal-overflow": "Inspect the named container width, minimum width and child sizing. Constrain the overflowing child to the available width; retain an explicit scroll container where wider content is intentional.",
    "web/content-clipped": "Inspect the clipping ancestor and the target box. Increase the available size or restore an intentional scroll path so the content is reachable.",
    "web/sibling-overlap": "Inspect layout spacing, negative margins, grid/flex placement or absolute positioning between the overlapping siblings; name intentional overlays explicitly.",
    "web/svg-text-overflows-viewport": "Inspect the SVG viewBox, font size, or text positioning so the rendered <text> bounding box stays inside the SVG viewport.",
    "web/small-text": "Increase the computed font size above the configured minimum threshold (uncalibrated heuristic).",
    "web/small-touch-target": "Increase the interactive control's hit area (padding, min-width, min-height) above the configured minimum dimension (uncalibrated heuristic).",
  };
  const repair = repairByRule[finding.ruleId] ?? "Inspect the target geometry and rerun the same scenario and viewport.";
  return `<article class="finding ${esc(finding.severity)}" id="finding-${index + 1}"><p class="eyebrow">${esc(finding.severity)} · ${esc(finding.ruleId)}</p><h2>${esc(finding.id)}</h2><dl><div><dt>Measured / threshold</dt><dd>${num(finding.measurement.value)} / ${num(finding.measurement.threshold)} ${esc(finding.measurement.unit)}</dd></div><div><dt>Scenario / route</dt><dd>${esc(report.scope.scenario)} · ${esc(report.scope.url)}</dd></div><div><dt>Viewport</dt><dd>${num(report.scope.viewport.width)}×${num(report.scope.viewport.height)}</dd></div><div><dt>Target</dt><dd>${esc(finding.target.selector)}</dd></div><div><dt>Source</dt><dd>${esc(source?.status ?? "unknown")} ${source?.file ? displayPath(source.file) : ""}</dd></div></dl><p><strong>Observation:</strong> geometry recorded for the target; a shared cause is not established.</p><p><strong>Repair option:</strong> ${esc(repair)}</p><p><strong>Next check:</strong> rerun the same scenario and viewport and inspect adjacent content for follow-up effects.</p><div class="evidence">${evidence}</div><p><a href="#finding-navigation">Back to findings</a></p></article>`;
}
