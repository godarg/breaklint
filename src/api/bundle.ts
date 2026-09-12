import { closeSync, constants, lstatSync, mkdirSync, openSync, writeFileSync, writeSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import type { Evidence, Finding, Report } from "../core/types.ts";
import type { PublicScreenReport, ScreenFinding } from "../web/types.ts";
import type { ReportComparison } from "./compare.ts";
import { captureBoundedSourceFile, sha256Bytes } from "../source/bytes.ts";
import { createContextPack, type ContextFinding, type CreateContextPackOptions } from "./context.ts";

export interface RenderReportOptions extends CreateContextPackOptions { title?: string; theme?: "light" | "dark"; comparison?: ReportComparison; }
export interface WriteReportBundleOptions extends RenderReportOptions { outDir: string; evidenceDir?: string; }
export interface ReportBundleResult { outDir: string; reportPath: string; htmlPath: string; contextPath: string; assets: readonly string[]; }

const esc = (value: unknown): string => String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "�").replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
const MAX_ASSET_BYTES = 64 * 1024 * 1024;

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

function writeCapturedAsset(targetRoot: string, name: string, bytes: Buffer): void {
  const assets = join(targetRoot, "assets");
  const directory = lstatSync(assets);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("report asset directory is not a regular directory");
  const target = join(assets, name);
  const fd = openSync(target, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
  try {
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
  } finally { closeSync(fd); }
}

/** Top-level bundle files: like assets, a pre-existing symlink at the leaf is refused, not followed. */
function writeBundleFile(targetRoot: string, name: string, content: string): void {
  const fd = openSync(join(targetRoot, name), constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o666);
  try { writeFileSync(fd, content, "utf8"); } finally { closeSync(fd); }
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
  return `<figure class="crop"><svg role="img" aria-label="Verified target and surrounding context" viewBox="${left} ${top} ${width} ${height}" style="display:block;width:100%;background:#fff"><defs><clipPath id="${clipId}" clipPathUnits="userSpaceOnUse"><rect x="${left}" y="${top}" width="${width}" height="${height}"/></clipPath></defs><g clip-path="url(#${clipId})"><image href="${esc(asset.href)}" x="0" y="0" width="${box.pageWidth}" height="${box.pageHeight}"/><rect class="target-outline" x="${box.x}" y="${box.y}" width="${box.width}" height="${box.height}" fill="none" stroke="#bd3500" stroke-width="3" vector-effect="non-scaling-stroke"/></g></svg><figcaption>Marked target context from verified full-page evidence; only the visible intersection is shown for overflow. The original box is page-relative in css-page-top-left coordinates. Source: ${source(finding)}.</figcaption></figure>`;
}

function source(finding: Finding): string {
  const original = finding.originalSource;
  if (original.status === "verified" && original.location) {
    return original.role === "verified-container-only"
      ? `Verified container only: ${displayPath(original.location.file)}:${original.location.line}:${original.location.column}; no exact original range`
      : `Verified original range: ${displayPath(original.location.file)}:${original.location.line}:${original.location.column}`;
  }
  if (original.status === "ambiguous") return `Ambiguous original source (${original.candidates.length} candidates)`;
  if (original.status === "declared") return "Declared original source; verify before editing";
  return "Original source unavailable";
}

function displayPath(value: string): string {
  return /^(?:\/|~[\\/]|[A-Za-z]:[\\/]|\\\\)/u.test(value) ? "&lt;local-path-withheld&gt;" : esc(value);
}

function contextOrigin(finding: ContextFinding): string {
  const origin = finding.originalSource;
  if (origin.status === "ambiguous") return `ambiguous · ${origin.candidateCount} candidate source range${origin.candidateCount === 1 ? "" : "s"} · choose none automatically`;
  if (!origin.location) return `${esc(origin.status)} · ${esc(origin.role)} · no original range`;
  const location = origin.location;
  if (origin.role === "verified-container-only") return `${displayPath(location.file)}:${location.line}:${location.column} · verified container only · no exact original range`;
  const integrity = origin.integrity ? ` · SHA-256 ${esc(origin.integrity.sha256)} (${origin.integrity.byteLength} bytes)` : " · integrity unavailable";
  return `${displayPath(location.file)}:${location.line}:${location.column}–${location.endLine}:${location.endColumn} · bytes ${location.offset}–${location.endOffset} · ${esc(location.coordinateSystem)} · ${esc(origin.status)} · ${esc(origin.role)}${integrity}`;
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
  const evidence = asset ? `<a href="${esc(asset.href)}">Open verified full-page evidence</a>` : "Evidence unavailable or failed integrity verification.";
  const pdfLink = pdf ? ` <a href="${esc(pdf.href)}">Open verified diagnostic PDF</a>` : "";
  const origin = context ? contextOrigin(context) : `${source(finding)} · role ${esc(finding.originalSource.role)}`;
  const evaluation = context ? contextEvaluation(context) : "No uniquely matching canonical target evaluation is available.";
  const repair = context?.repair.options.length ? context.repair.options.map(esc).join(" ") : "No concrete verified-source repair option is available.";
  return `<article class="finding ${esc(finding.severity)}" id="finding-${index + 1}"><p class="eyebrow">${esc(finding.severity)} · ${esc(finding.ruleId)}</p><h2>${esc(finding.runFindingId)}</h2><p>${esc(finding.message)}</p><dl><div><dt>Measured</dt><dd>${esc(finding.measurement.value)} ${esc(finding.measurement.unit)}</dd></div><div><dt>Threshold</dt><dd>${esc(finding.measurement.threshold)} ${esc(finding.measurement.unit)}</dd></div><div><dt>Scope</dt><dd>${displayPath(finding.document)} · diagnostic page ${finding.page} · target ${esc(finding.target.nodeKey)} · box ${finding.target.renderBox ? "css-page-top-left" : "css-screen-pixels"}</dd></div><div><dt>Original source range</dt><dd>${origin}</dd></div><div><dt>Canonical evaluation</dt><dd>${esc(evaluation)}</dd></div><div><dt>Input position / identity</dt><dd>${finding.source ? `${displayPath(finding.source.file)}:${finding.source.line}:${finding.source.column} (${esc(finding.source.coordinateSystem)})` : "unavailable"} · ${esc(finding.stableIdentity.status)}</dd></div></dl><p><strong>Proven fact:</strong> the measurement above was recorded for this target.</p><p><strong>Possible causes:</strong> not established by this report.</p><p><strong>Repair option:</strong> ${repair}</p><p><strong>Next check:</strong> inspect source and evidence, then recheck under compatible conditions.</p><p class="evidence">${evidence}${pdfLink}</p>${crop(asset, finding)}<p><a href="#finding-navigation">Back to findings</a></p></article>`;
}

/** Script-free, offline HTML from a Report4. It does not make evidence navigable by itself. */
export function renderReport(report: Report | unknown, options: RenderReportOptions = {}): string {
  const context = createContextPack(report, options);
  const isScreen = context.canonicalReport.schemaVersion === 1 && context.canonicalReport.profileKind === "screen";
  const legacy = !isScreen && (context.canonicalReport.schemaVersion !== 4 || context.canonicalReport.profileKind !== "document");
  const title = options.title ?? "breaklint report";
  const theme = options.theme ?? "light";
  if (options.comparison && options.comparison.afterRunId !== context.canonicalReport.runId) throw new Error("comparison does not refer to this current report");
  const comparison = options.comparison ? `<section class="state"><h2>Repair comparison</h2><p>Before ${esc(options.comparison.beforeRunId)} → after ${esc(options.comparison.afterRunId)}</p><dl>${(["new", "persisting", "resolved", "unmatchable", "not-sufficiently-measured"] as const).map(status => `<div><dt>${status}</dt><dd>${options.comparison!.results.filter(item => item.status === status).length}</dd></div>`).join("")}</dl><ul>${options.comparison.results.map(item => `<li>${esc(item.beforeRunFindingId ?? item.afterRunFindingIds.join(", "))}: ${esc(item.status)} — ${esc(item.reasons.join(", "))}</li>`).join("")}</ul><p>Absent or reduced measurement is not a repair. Identical removal and recreation between observations cannot be distinguished.</p></section>` : "";
  const documentFindings = context.findings.filter((item): item is ContextFinding => "runFindingId" in item);
  const screenCards = context.findings.filter((item) => "id" in item).map((item, index) => `<article class="finding ${esc(item.severity)}" id="finding-${index + 1}"><p class="eyebrow">${esc(item.severity)} · ${esc(item.ruleId)}</p><h2>${esc(item.id)}</h2><p>${esc(item.observation)}</p><dl><div><dt>Measured</dt><dd>${esc(item.measurement.value)} ${esc(item.measurement.unit ?? "")}</dd></div><div><dt>Scenario / route</dt><dd>${esc(item.scope.scenario)} · ${esc(item.scope.route)} · ${esc(item.scope.viewport)}</dd></div><div><dt>Target</dt><dd>${esc(item.scope.targetRef)} · ${esc(item.scope.coordinateSystem)}</dd></div><div><dt>Source</dt><dd>${esc(item.source.status)} ${item.source.file ? displayPath(item.source.file) : ""}</dd></div><div><dt>Evidence</dt><dd>${item.evidence.bindsFinding ? esc(item.evidence.screenshot ?? "bound asset unavailable") : "not bound"}</dd></div></dl><p><strong>Next check:</strong> rerun the same scenario and viewport after a bounded repair.</p><p><a href="#finding-navigation">Back to findings</a></p></article>`).join("");
  const runState = `<dl class="run-state"><div><dt>Verdict / exit</dt><dd>${esc(context.run.verdict ?? "unavailable")} / ${esc(context.run.exitCode ?? "unavailable")}</dd></div><div><dt>Infrastructure events</dt><dd>${context.run.infrastructureCount}</dd></div><div><dt>Not measured</dt><dd>${context.run.notMeasuredCount}</dd></div></dl>`;
  const diagnostics = context.diagnostics.items.length === 0 ? "" : `<section class="diagnostics" aria-labelledby="diagnostics-heading"><h2 id="diagnostics-heading">Infrastructure and nonmeasurement</h2><ul>${context.diagnostics.items.map((item) => `<li><code>${esc(item.kind)}</code>: ${esc(item.reason)}${item.context ? ` · ${esc(item.context)}` : ""}</li>`).join("")}</ul>${context.diagnostics.omittedCount ? `<p>${context.diagnostics.omittedCount} additional diagnostic entries omitted from this bounded view; inspect canonical JSON.</p>` : ""}</section>`;
  const navigation = `<nav id="finding-navigation" aria-label="Finding navigation">${context.findings.map((item, index) => `<a href="#finding-${index + 1}">${index + 1}. ${esc(item.severity)} ${esc(item.ruleId)}</a>`).join(" · ")}</nav>`;
  const cards = legacy ? `<section class="state"><h2>Legacy or invalid report</h2><p>Source verification and repair claims are unavailable for this report shape. Inspect canonical JSON with a compatible breaklint version.</p>${runState}</section>` : `<section class="state ${context.selection.complete ? "complete" : "incomplete"}"><h2>${context.selection.complete ? "Measured report" : "Incomplete report"}</h2><p>${context.selection.complete ? "The bounded context includes all recorded findings." : `Do not treat absence as repair. ${esc(context.selection.reason)}; omitted findings: ${context.selection.omittedCount}.`}</p>${runState}</section><section class="cards"><p class="section-label">Prioritized findings</p>${navigation}${isScreen ? screenCards : documentFindings.map((item, index) => `<article class="finding ${esc(item.severity)}" id="finding-${index + 1}"><p class="eyebrow">${esc(item.severity)} · ${esc(item.ruleId)}</p><h2>${esc(item.runFindingId)}</h2><p>${esc(item.observation)}</p><dl><div><dt>Measured</dt><dd>${esc(item.measurement.value)} ${esc(item.measurement.unit)}</dd></div><div><dt>Threshold</dt><dd>${esc(item.measurement.threshold)} ${esc(item.measurement.unit)}</dd></div><div><dt>Scope</dt><dd>${esc(item.scope.document)} · diagnostic page ${item.scope.page} · ${esc(item.scope.coordinateSystem)}</dd></div><div><dt>Original source range</dt><dd>${contextOrigin(item)}</dd></div></dl><p><strong>Canonical evaluation:</strong> ${esc(contextEvaluation(item))}</p><p><strong>Repair option:</strong> ${item.repair.options.length ? item.repair.options.map(esc).join(" ") : "No concrete verified-source repair option is available."}</p><p><strong>Next check:</strong> inspect source and evidence, then recheck after a bounded repair.</p><p><a href="#finding-navigation">Back to findings</a></p></article>`).join("") || "<p>No finding cards were recorded. Infrastructure and nonmeasurement counts remain above.</p>"}</section>`;
  return `<!doctype html><html lang="en" data-theme="${esc(theme)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'"><title>${esc(title)}</title><style>:root{--ink:#17231f;--paper:#f8f6f0;--muted:#53615b;--line:#bec8c0;--accent:#b55b24;--warn:#936c00;--bad:#9e3030;--space:clamp(1rem,3vw,2.5rem);color-scheme:light dark}html[data-theme=dark]{--ink:#edf2ec;--paper:#16211d;--muted:#c1ccc4;--line:#4d5a52;--accent:#ed9a61;--warn:#e8c163;--bad:#f18b8b}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}main{max-width:74rem;margin:auto;padding:var(--space)}header{border-inline-start:.4rem solid var(--accent);padding-inline-start:1rem}h1{font:700 clamp(2rem,6vw,4.4rem)/.98 Georgia,serif;letter-spacing:-.035em;margin:.4rem 0 1rem}.eyebrow,.section-label{text-transform:uppercase;letter-spacing:.08em;font-size:.78rem;color:var(--muted)}.state,.finding,.diagnostics{border:1px solid var(--line);padding:1.2rem;margin-block:1.2rem}.state.incomplete{border-inline-start:.4rem solid var(--warn)}.finding.error{border-inline-start:.4rem solid var(--bad)}.finding.warn{border-inline-start:.4rem solid var(--warn)}.finding.info{border-inline-start:.4rem solid var(--accent)}.diagnostics{overflow-wrap:anywhere}.finding h2{font-size:1rem;overflow-wrap:anywhere}dl{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem;margin:1rem 0}dt{font-size:.75rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}a{color:var(--ink);text-decoration-thickness:2px;text-underline-offset:.18em}.crop{margin:1rem 0;break-inside:avoid}.crop svg{max-height:32rem}.crop figcaption{font-size:.82rem;color:var(--muted)}.evidence figure{position:relative;margin:1rem 0}.evidence figure>.target-outline{position:absolute;border:3px solid #bd3500;box-shadow:0 0 0 1px #fff;pointer-events:none}.evidence figure>img{display:block;width:100%}@media(max-width:390px){main{padding:1rem}dl{grid-template-columns:1fr}.finding{padding:1rem}}@media print{@page{size:A4;margin:12mm}body{background:#fff;color:#000}main{max-width:none;padding:0}.finding,.state{break-inside:avoid}.finding:has(.crop){break-inside:auto}.crop{break-inside:avoid;max-height:none}.crop svg{max-height:90mm!important}a{color:#000}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto}}</style></head><body><main><header><p class="eyebrow">Canonical JSON report ${esc(context.canonicalReport.runId ?? "unavailable")}</p><h1>${esc(title)}</h1><p>JSON is canonical. This offline view is a bounded projection.</p></header>${comparison}${diagnostics}${cards}<footer><p>${esc(context.untrustedData.notice)}</p></footer></main></body></html>`;
}

/** Writes report.json, context.json and a self-contained report.html. Assets are copied only after hash and path verification. */
export function writeReportBundle(report: Report | PublicScreenReport, options: WriteReportBundleOptions): ReportBundleResult {
  const root = resolve(options.outDir);
  mkdirSync(join(root, "assets"), { recursive: true });
  const assetsDirectory = lstatSync(join(root, "assets"));
  if (!assetsDirectory.isDirectory() || assetsDirectory.isSymbolicLink()) throw new Error("report asset directory is not a regular directory");
  const assets: AssetMap = new Map();
  const canonical = JSON.stringify(report, null, 2) + "\n";
  writeBundleFile(root, "report.json", canonical);

  let html = renderReport(report, options);
  // Render once more with only validated assets. This keeps unsafe evidence strings as text.
  const selected = createContextPack(report, options).findings;
  const cards = report.profileKind === "screen"
    ? selected.map((item, index) => "id" in item ? screenFindingCard(report, report.findings.find((finding) => finding.id === item.id)!, index, assets, options.evidenceDir, root) : "").join("")
    : selected.map((item, index) => "runFindingId" in item ? findingCard(report, report.findings.find((finding) => finding.runFindingId === item.runFindingId)!, index, assets, options.evidenceDir, root, item) : "").join("");
  html = html.replace(/<section class="cards">[\s\S]*?<\/section>/u, () => `<section class="cards"><p class="section-label">Prioritized findings</p><nav id="finding-navigation" aria-label="Finding navigation">${selected.map((item, index) => `<a href="#finding-${index + 1}">${index + 1}. ${esc(item.severity)} ${esc(item.ruleId)}</a>`).join(" · ")}</nav>${cards || "<p>No finding cards were recorded.</p>"}</section>`);
  if (options.comparison) {
    if (options.comparison.afterRunId !== report.runId) throw new Error("comparison does not refer to this current report");
    writeBundleFile(root, "comparison.json", JSON.stringify(options.comparison, null, 2) + "\n");
  }
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
  writeBundleFile(root, "bundle.json", JSON.stringify(bundleEvidence, null, 2) + "\n");
  writeBundleFile(root, "context.json", JSON.stringify({ ...createContextPack(report, options), bundleEvidence }, null, 2) + "\n");
  const availability = `<section class="diagnostics"><h2>Current bundle evidence</h2><p>Canonical JSON describes the historical capture. This bundle separately verifies the copied files. A comparison of historical reports is not a current asset recheck.</p><ul>${bundleEvidence.findings.map(item => `<li>${esc(item.findingId)}: ${esc(item.status)}${item.asset ? ` · <a href="${esc(item.asset.path)}">verified asset</a> · SHA-256 ${item.asset.sha256}` : ""}</li>`).join("")}</ul><p><a href="bundle.json">Complete asset integrity manifest</a></p></section>`;
  html = html.replace('<section class="cards">', () => `${availability}<section class="cards">`);
  writeBundleFile(root, "report.html", html);
  return { outDir: root, reportPath: join(root, "report.json"), htmlPath: join(root, "report.html"), contextPath: join(root, "context.json"), assets: [...assets.values()].map((asset) => asset.href) };
}

function screenFindingCard(report: PublicScreenReport, finding: ScreenFinding, index: number, assets: AssetMap, evidenceDir: string | undefined, root: string): string {
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
  const box = finding.target.box;
  const scale = report.scope.viewport.deviceScaleFactor;
  const width = artifact.widthPx && scale > 0 ? artifact.widthPx / scale : 0;
  const height = artifact.heightPx && scale > 0 ? artifact.heightPx / scale : 0;
  const x = box ? box.x + (artifact.capture === "full-page" ? finding.target.scroll.x : 0) : 0;
  const y = box ? box.y + (artifact.capture === "full-page" ? finding.target.scroll.y : 0) : 0;
  const left = Math.max(0, x), top = Math.max(0, y);
  const right = Math.min(width, x + (box?.width ?? 0)), bottom = Math.min(height, y + (box?.height ?? 0));
  const outline = box && width > 0 && height > 0 && right > left && bottom > top
    ? `<span class="target-outline" aria-hidden="true" style="left:${left / width * 100}%;top:${top / height * 100}%;width:${(right - left) / width * 100}%;height:${(bottom - top) / height * 100}%"></span>` : "";
  const evidence = asset ? `<figure style="position:relative;margin:1rem 0"><img style="display:block;width:100%" src="${esc(asset.href)}" alt="Verified screen evidence with marked visible target">${outline}</figure><a href="${esc(asset.href)}">Open verified full screen surface</a><p>Visible intersection of the target box; coordinates: ${esc(finding.target.coordinateSystem)}. Capture: ${esc(artifact.capture)}.</p>` : "Evidence unavailable or failed integrity verification.";
  const repair = finding.ruleId === "web/unexpected-horizontal-overflow" ? "Inspect the named container width, minimum width and child sizing. Constrain the overflowing child to the available width; retain an explicit scroll container where wider content is intentional." : "Inspect the clipping ancestor and the target box. Increase the available size or restore an intentional scroll path so the content is reachable.";
  return `<article class="finding ${esc(finding.severity)}" id="finding-${index + 1}"><p class="eyebrow">${esc(finding.severity)} · ${esc(finding.ruleId)}</p><h2>${esc(finding.id)}</h2><dl><div><dt>Measured / threshold</dt><dd>${esc(finding.measurement.value)} / ${esc(finding.measurement.threshold)} ${esc(finding.measurement.unit)}</dd></div><div><dt>Scenario / route</dt><dd>${esc(report.scope.scenario)} · ${esc(report.scope.url)}</dd></div><div><dt>Viewport</dt><dd>${report.scope.viewport.width}×${report.scope.viewport.height}</dd></div><div><dt>Target</dt><dd>${esc(finding.target.selector)}</dd></div><div><dt>Source</dt><dd>${esc(source?.status ?? "unknown")} ${source?.file ? displayPath(source.file) : ""}</dd></div></dl><p><strong>Observation:</strong> geometry recorded for the target; a shared cause is not established.</p><p><strong>Repair option:</strong> ${repair}</p><p><strong>Next check:</strong> rerun the same scenario and viewport and inspect adjacent content for follow-up effects.</p><div class="evidence">${evidence}</div><p><a href="#finding-navigation">Back to findings</a></p></article>`;
}
