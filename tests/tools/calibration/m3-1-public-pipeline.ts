import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  buildBlindPacket,
  buildBlindPacketV2,
  buildBlindContextArtifacts,
  buildBlindContextArtifactsV2,
  buildFreezeProjection,
  buildPilotReport,
  buildPublicIntakeManifest,
  canonicalJson,
  deriveStableTargetId,
  enumerateSvgTextTargets,
  ingestPublicArtifact,
  validateStrictSplits,
  verifyBlindPacketV2Custodial,
  type PublicArtifactIntakeRequest,
  type PublicIntakeManifestDocument,
  type RuleId,
  type SplitDocument,
} from "./m3-1-pilot.ts";
import {
  buildM31ToM30ReadinessBridge,
  verifyStoredM31ToM30ReadinessBridge,
} from "./m3-1-readiness-bridge.ts";

const SHA256 = /^[a-f0-9]{64}$/u;
const MEDIA_TYPES = new Set(["text/html", "image/svg+xml"]);
const MAX_PUBLIC_ARTIFACT_BYTES = 10 * 1024 * 1024;

function digest(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeRelative(path: string, label: string): void {
  if (!path || isAbsolute(path) || path.includes("..") || path.includes("~") || path.includes("\\")) {
    throw new Error(`${label} must be a safe POSIX-style relative path`);
  }
}

function safeChild(root: string, child: string, label: string): string {
  safeRelative(child, label);
  const resolvedRoot = resolve(root);
  const resolved = resolve(resolvedRoot, child);
  const rel = relative(resolvedRoot, resolved);
  if (rel.startsWith("..") || isAbsolute(rel) || !resolved.startsWith(`${resolvedRoot}${sep}`)) throw new Error(`${label} escapes its approved root`);
  return resolved;
}

function assertApprovedOutputRoot(approvedRoot: string, outputRoot: string, mustExist: boolean): void {
  if (!existsSync(approvedRoot) || lstatSync(approvedRoot).isSymbolicLink() || !lstatSync(approvedRoot).isDirectory()) {
    throw new Error("approvedOutputRoot must already exist as a real directory");
  }
  const approvedReal = realpathSync(approvedRoot);
  const output = mustExist
    ? realpathSync(outputRoot)
    : join(realpathSync(dirname(resolve(outputRoot))), basename(outputRoot));
  const rel = relative(approvedReal, output);
  if (!rel || rel.startsWith("..") || isAbsolute(rel) || !output.startsWith(`${approvedReal}${sep}`)) throw new Error("outputRoot must be a strict child of approvedOutputRoot");
  if (mustExist && (!existsSync(output) || lstatSync(output).isSymbolicLink() || !lstatSync(output).isDirectory())) throw new Error("output bundle does not exist as a real directory");
  if (!mustExist && existsSync(output)) throw new Error("output bundle already exists; overwrite is forbidden");
}

function atomicWrite(root: string, relativePath: string, bytes: Buffer | string): void {
  const destination = safeChild(root, relativePath, "bundle output path");
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = `${destination}.tmp-${process.pid}`;
  writeFileSync(temporary, bytes, { flag: "wx" });
  renameSync(temporary, destination);
}

export interface LocalPipelineSource {
  kind: "local";
  sourceRoot: string;
  sourceRelativePath: string;
}

export interface HttpsPipelineSource {
  kind: "https";
  url: string;
}

export interface PublicPipelineSourceSpec extends Omit<PublicArtifactIntakeRequest, "artifactRoot" | "artifactPath"> {
  source: LocalPipelineSource | HttpsPipelineSource;
  outputRelativePath: string;
  expectedSha256: string;
  expectedByteLength: number;
  mediaType: "text/html" | "image/svg+xml";
  split: "development" | "tuning" | "holdout";
  ruleIds: RuleId[];
}

export interface PublicPipelineEvidenceSpec {
  evidenceRoot: string;
  evidenceRelativePath: string;
  outputRelativePath: string;
  expectedSha256: string;
  expectedByteLength: number;
}

export interface PublicPipelineSpec {
  contractVersion: "m3-1-public-pipeline-spec-v1";
  pilotId: string;
  createdAt: string;
  approvedOutputRoot: string;
  outputRoot: string;
  annotationOutputRoot: string;
  exactHttpsAllowlist: string[];
  orderSeed: string;
  holdoutId: string;
  samplingPlanId: string;
  samplingPlanSha256: string;
  analysisPlanSha256: string;
  guidelineSha256ByRule: Record<RuleId, string>;
  sources: PublicPipelineSourceSpec[];
  evidence: PublicPipelineEvidenceSpec[];
}

export interface PublicPipelineSuccessorSpec extends Omit<PublicPipelineSpec, "contractVersion"> {
  contractVersion: "m3-1-public-pipeline-spec-v2";
  previousFreezeSha256: string;
}

function acquireApprovedLocalBytes(root: string, relativePath: string, label: string): Buffer {
  if (!existsSync(root) || lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) throw new Error(`${label} root must be a real directory`);
  const rootReal = realpathSync(root);
  const path = safeChild(rootReal, relativePath, label);
  if (!existsSync(path) || lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) throw new Error(`${label} must be a real regular file`);
  const real = realpathSync(path);
  if (!real.startsWith(`${rootReal}${sep}`)) throw new Error(`${label} escapes its approved root`);
  return readFileSync(real);
}

async function acquireBytes(source: PublicPipelineSourceSpec, exactHttpsAllowlist: string[]): Promise<Buffer> {
  if (source.source.kind === "local") {
    return acquireApprovedLocalBytes(source.source.sourceRoot, source.source.sourceRelativePath, "local source");
  }

  const url = new URL(source.source.url);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("HTTPS source must have no credentials, query or fragment");
  if (!exactHttpsAllowlist.includes(url.href)) throw new Error("HTTPS source is not on the exact URL allowlist");
  const response = await fetch(url, { redirect: "manual", credentials: "omit", cache: "no-store", headers: { Accept: source.mediaType, "Accept-Encoding": "identity" } });
  if (response.status >= 300 && response.status < 400) throw new Error("HTTP redirects are forbidden; approve the exact final URL instead");
  if (!response.ok) throw new Error(`HTTPS source returned ${response.status}`);
  if (response.url !== url.href) throw new Error("HTTPS final URL differs from the exact approved URL");
  const receivedType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (receivedType !== source.mediaType) throw new Error(`HTTPS media type ${receivedType ?? "missing"} differs from ${source.mediaType}`);
  const contentEncoding = response.headers.get("content-encoding");
  if (contentEncoding !== null && contentEncoding.toLowerCase() !== "identity") throw new Error("HTTPS source ignored Accept-Encoding identity");
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) !== source.expectedByteLength) throw new Error("HTTPS Content-Length differs from the preregistered byte length");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_PUBLIC_ARTIFACT_BYTES) throw new Error("HTTPS artifact exceeds the public-pilot size limit");
  return bytes;
}

function verifyExpectedBytes(source: PublicPipelineSourceSpec, bytes: Buffer): void {
  if (!SHA256.test(source.expectedSha256) || digest(bytes) !== source.expectedSha256) throw new Error(`source ${source.sourceLocator} SHA-256 differs from preregistration`);
  if (!Number.isSafeInteger(source.expectedByteLength) || source.expectedByteLength < 1 || bytes.length !== source.expectedByteLength) throw new Error(`source ${source.sourceLocator} byte length differs from preregistration`);
  if (!MEDIA_TYPES.has(source.mediaType)) throw new Error("unsupported public artifact media type");
  safeRelative(source.outputRelativePath, "public artifact output path");
  if (source.ruleIds.length === 0 || new Set(source.ruleIds).size !== source.ruleIds.length) throw new Error("source ruleIds must be non-empty and unique");
}

type BundleIndexContract = "m3-1-public-pipeline-bundle-index-v1" | "m3-1-blind-annotation-bundle-index-v1" | "m3-1-public-pipeline-bundle-index-v2" | "m3-1-blind-annotation-bundle-index-v2";

function bundleIndex(root: string, paths: string[], contractVersion: BundleIndexContract): { contractVersion: BundleIndexContract; files: Array<{ path: string; sha256: string; byteLength: number }> } {
  return {
    contractVersion,
    files: [...paths].sort().map((path) => {
      const bytes = readFileSync(safeChild(root, path, "bundle index path"));
      return { path, sha256: digest(bytes), byteLength: bytes.length };
    }),
  };
}

function bundleFiles(root: string, prefix = ""): string[] {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? bundleFiles(root, path) : [path];
  }).sort();
}

/** Historical v1/v2 reconstruction API for frozen-evidence tests. The operational CLI refuses creation. */
export async function createPublicPipelineBundle(spec: PublicPipelineSpec | PublicPipelineSuccessorSpec): Promise<{ outputRoot: string; annotationOutputRoot: string; bundleIndexSha256: string; annotationBundleIndexSha256: string; reportStatus: string }> {
  if (spec.contractVersion !== "m3-1-public-pipeline-spec-v1" && spec.contractVersion !== "m3-1-public-pipeline-spec-v2") throw new Error("unsupported public pipeline spec");
  const successor = spec.contractVersion === "m3-1-public-pipeline-spec-v2";
  if (successor && (!SHA256.test(spec.previousFreezeSha256) || spec.previousFreezeSha256 !== "e9f880a8489e835aeeed89f1d387a8ba6d3be184d6b1297f5711138b95b42de9")) throw new Error("successor pipeline must bind the immutable v1 freeze hash");
  if (!SHA256.test(spec.samplingPlanSha256)) throw new Error("samplingPlanSha256 is invalid");
  assertApprovedOutputRoot(spec.approvedOutputRoot, spec.outputRoot, false);
  assertApprovedOutputRoot(spec.approvedOutputRoot, spec.annotationOutputRoot, false);
  if (resolve(spec.outputRoot) === resolve(spec.annotationOutputRoot)) throw new Error("evidence and annotation bundles must be separate roots");
  const evidenceStage = mkdtempSync(join(dirname(spec.outputRoot), ".m3-1-evidence-stage-"));
  const annotationStage = mkdtempSync(join(dirname(spec.annotationOutputRoot), ".m3-1-annotation-stage-"));
  try {
    const manifestDocuments: PublicIntakeManifestDocument[] = [];
    const splitDocuments: SplitDocument[] = [];
    const allBlindTargets: Parameters<typeof buildBlindPacket>[0]["targets"] = [];
    const contextsByTargetId: Parameters<typeof buildBlindPacket>[0]["contextsByTargetId"] = {};
    const contextsByTargetIdV2: Parameters<typeof buildBlindPacketV2>[0]["contextsByTargetId"] = {};
    const blindContextArtifacts = new Map<string, Buffer>();
    const evidencePaths: string[] = [];
    const annotationPaths: string[] = [];
    const evidenceHashes = new Set<string>();
    for (const evidence of [...spec.evidence].sort((left, right) => left.outputRelativePath.localeCompare(right.outputRelativePath, "en"))) {
      safeRelative(evidence.outputRelativePath, "source evidence output path");
      if (!/^source-evidence\/[A-Za-z0-9._-]+\.json$/u.test(evidence.outputRelativePath)) throw new Error("source evidence output must be a neutral JSON path");
      const bytes = acquireApprovedLocalBytes(evidence.evidenceRoot, evidence.evidenceRelativePath, "source evidence");
      if (!SHA256.test(evidence.expectedSha256) || digest(bytes) !== evidence.expectedSha256 || bytes.length !== evidence.expectedByteLength) throw new Error(`source evidence ${evidence.outputRelativePath} differs from preregistration`);
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      atomicWrite(evidenceStage, evidence.outputRelativePath, bytes);
      evidencePaths.push(evidence.outputRelativePath); evidenceHashes.add(evidence.expectedSha256);
    }
    for (const source of [...spec.sources].sort((left, right) => left.sourceLocator.localeCompare(right.sourceLocator, "en"))) {
      for (const hash of [source.provenanceEvidenceSha256, source.rightsEvidenceSha256, source.privacyEvidenceSha256, source.founderAuthorizationSha256].filter((value): value is string => typeof value === "string")) if (!evidenceHashes.has(hash)) throw new Error(`source ${source.sourceLocator} references evidence bytes absent from the approved evidence spec`);
      const bytes = await acquireBytes(source, spec.exactHttpsAllowlist);
      verifyExpectedBytes(source, bytes);
      atomicWrite(evidenceStage, source.outputRelativePath, bytes); evidencePaths.push(source.outputRelativePath);
      const intake = ingestPublicArtifact({ ...source, artifactRoot: evidenceStage, artifactPath: source.outputRelativePath });
      const targets = enumerateSvgTextTargets(bytes, source.ruleIds);
      const boundTargets = targets.map((target) => ({ ...target, documentId: intake.documentId }));
      const contexts = successor ? buildBlindContextArtifactsV2(bytes, source.mediaType, boundTargets) : buildBlindContextArtifacts(bytes, source.mediaType, boundTargets);
      if (successor) Object.assign(contextsByTargetIdV2, contexts.contextsByTargetId);
      else Object.assign(contextsByTargetId, contexts.contextsByTargetId);
      for (const artifact of contexts.artifacts) {
        const existing = blindContextArtifacts.get(artifact.path);
        if (existing && !existing.equals(artifact.bytes)) throw new Error("blind context path collision");
        blindContextArtifacts.set(artifact.path, artifact.bytes);
      }
      manifestDocuments.push({ ...intake, mediaType: source.mediaType, publicRelativePath: source.outputRelativePath, targets });
      splitDocuments.push({ documentId: intake.documentId, split: source.split, artifactSha256: intake.artifactSha256, originGroupId: intake.originGroupId, duplicateGroupId: intake.duplicateGroupId, derivationGroupId: intake.derivationGroupId, templateGroupId: intake.templateGroupId, versionGroupId: intake.versionGroupId });
      allBlindTargets.push(...targets.map((target) => ({ ...target, documentId: intake.documentId })));
    }
    const manifest = buildPublicIntakeManifest({ manifestId: `intake_manifest_${spec.pilotId}`, createdAt: spec.createdAt, documents: manifestDocuments });
    for (const [path, bytes] of [...blindContextArtifacts].sort(([left], [right]) => left.localeCompare(right, "en"))) { atomicWrite(annotationStage, path, bytes); annotationPaths.push(path); }
    const blindPacket = successor
      ? buildBlindPacketV2({ packetId: `blind_packet_${spec.pilotId}`, orderSeed: spec.orderSeed, targets: allBlindTargets, contextsByTargetId: contextsByTargetIdV2 })
      : buildBlindPacket({ packetId: `blind_packet_${spec.pilotId}`, orderSeed: spec.orderSeed, targets: allBlindTargets, contextsByTargetId });
    atomicWrite(annotationStage, "blind-packet.json", canonicalJson(blindPacket)); annotationPaths.push("blind-packet.json");
    const annotationIndex = bundleIndex(annotationStage, annotationPaths, successor ? "m3-1-blind-annotation-bundle-index-v2" : "m3-1-blind-annotation-bundle-index-v1");
    atomicWrite(annotationStage, "bundle-index.json", canonicalJson(annotationIndex));
    const annotationBundleIndexSha256 = digest(canonicalJson(annotationIndex));

    const splitReport = validateStrictSplits(splitDocuments);
    if (!splitReport.valid) throw new Error(`origin-strict split validation failed: ${canonicalJson(splitReport.issues)}`);
    const persistedSplitReport = { ...splitReport, assignments: [...splitDocuments].sort((left, right) => left.documentId.localeCompare(right.documentId, "en")).map((document) => ({ documentId: document.documentId, split: document.split, artifactSha256: document.artifactSha256, originGroupId: document.originGroupId, duplicateGroupId: document.duplicateGroupId ?? null, derivationGroupId: document.derivationGroupId ?? null, templateGroupId: document.templateGroupId ?? null, versionGroupId: document.versionGroupId ?? null })) };
    const holdoutDocumentIds = new Set(splitDocuments.filter((document) => document.split === "holdout").map((document) => document.documentId));
    const freeze = buildFreezeProjection({ contractVersion: "m3-1-freeze-projection-v1", holdoutId: spec.holdoutId, purpose: "holdout-evaluation-preregistration", createdAt: spec.createdAt, frozenAt: spec.createdAt, sequence: successor ? 2 : 1, previousFreezeSha256: successor ? spec.previousFreezeSha256 : null, blindPacketSha256: blindPacket.packetSha256, blindPacketBundle: { bundleId: `blind_bundle_${spec.pilotId}`, bundleIndexSha256: annotationBundleIndexSha256, indexedFileCount: annotationPaths.length }, samplingPlanSha256: spec.samplingPlanSha256, analysisPlanSha256: spec.analysisPlanSha256, guidelineSha256ByRule: spec.guidelineSha256ByRule, renderer: { status: "blocked-missing-renderer-asset-freeze", rendererFreezeSha256: null, assetManifestSha256: null }, documents: manifestDocuments.filter((document) => holdoutDocumentIds.has(document.documentId)).map((document) => ({ documentId: document.documentId, artifactSha256: document.artifactSha256, split: "holdout", groups: { originGroupId: document.originGroupId, duplicateGroupId: document.duplicateGroupId, derivationGroupId: document.derivationGroupId, templateGroupId: document.templateGroupId, versionGroupId: document.versionGroupId }, source: { sourceLocator: document.sourceLocator, sourceCapturedAt: document.sourceCapturedAt, sourceCaptureMode: document.sourceCaptureMode, firstPartySourceSnapshot: document.firstPartySourceSnapshot, provenanceClass: document.provenanceClass, provenanceEvidenceSha256: document.provenanceEvidenceSha256, rightsBasis: document.rightsBasis, rightsEvidenceSha256: document.rightsEvidenceSha256, privacyClass: document.privacyClass, privacyEvidenceSha256: document.privacyEvidenceSha256, founderAuthorizationSha256: document.founderAuthorizationSha256 }, targets: document.targets.map((target) => ({ targetId: target.targetId, ruleId: target.ruleId })) })) });
    const report = buildPilotReport({ pilotId: spec.pilotId, createdAt: spec.createdAt, manifestReference: { artifactId: manifest.manifestId, artifactSha256: digest(canonicalJson(manifest)), artifactContractVersion: manifest.contractVersion }, samplingPlanId: spec.samplingPlanId, samplingPlanSha256: spec.samplingPlanSha256, artifactCount: manifestDocuments.length, realDocumentCount: manifestDocuments.filter((document) => document.realDocumentEligible).length, originGroupCount: new Set(manifestDocuments.map((document) => document.originGroupId)).size, sourceGateValid: true, annotationGateValid: false, splitGateValid: true, externalFreezeValid: false, externalTrustValid: false, captureEvidenceValid: false });
    for (const [path, value] of [["intake-manifest.json", manifest], ["split-report.json", persistedSplitReport], ["freeze-projection.json", freeze], ["pilot-report.json", report]] as const) { atomicWrite(evidenceStage, path, canonicalJson(value)); evidencePaths.push(path); }
    atomicWrite(evidenceStage, "m3-0-readiness-bridge.json", canonicalJson(buildM31ToM30ReadinessBridge(evidenceStage))); evidencePaths.push("m3-0-readiness-bridge.json");
    const evidenceIndex = bundleIndex(evidenceStage, evidencePaths, successor ? "m3-1-public-pipeline-bundle-index-v2" : "m3-1-public-pipeline-bundle-index-v1");
    atomicWrite(evidenceStage, "bundle-index.json", canonicalJson(evidenceIndex));
    const bundleIndexSha256 = digest(canonicalJson(evidenceIndex));
    renameSync(annotationStage, spec.annotationOutputRoot);
    renameSync(evidenceStage, spec.outputRoot);
    return { outputRoot: spec.outputRoot, annotationOutputRoot: spec.annotationOutputRoot, bundleIndexSha256, annotationBundleIndexSha256, reportStatus: report.executionStatus };
  } catch (error) {
    rmSync(evidenceStage, { recursive: true, force: true }); rmSync(annotationStage, { recursive: true, force: true });
    if (existsSync(spec.annotationOutputRoot) && !existsSync(spec.outputRoot)) rmSync(spec.annotationOutputRoot, { recursive: true, force: true });
    throw error;
  }
}

function readJson(path: string): unknown {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path))) as unknown;
}

/** Verifies historical bundle integrity only; it is not human-delivery authorization. */
export function verifyPublicPipelineBundle(spec: PublicPipelineSpec | PublicPipelineSuccessorSpec): { valid: boolean; issues: string[]; bundleIndexSha256: string; annotationBundleIndexSha256: string } {
  const successor = spec.contractVersion === "m3-1-public-pipeline-spec-v2";
  if (successor && (!SHA256.test(spec.previousFreezeSha256) || spec.previousFreezeSha256 !== "e9f880a8489e835aeeed89f1d387a8ba6d3be184d6b1297f5711138b95b42de9")) throw new Error("successor pipeline must bind the immutable v1 freeze hash");
  assertApprovedOutputRoot(spec.approvedOutputRoot, spec.outputRoot, true);
  assertApprovedOutputRoot(spec.approvedOutputRoot, spec.annotationOutputRoot, true);
  const issues: string[] = [];
  const indexPath = safeChild(spec.outputRoot, "bundle-index.json", "evidence bundle index");
  const annotationIndexPath = safeChild(spec.annotationOutputRoot, "bundle-index.json", "annotation bundle index");
  const index = readJson(indexPath) as { contractVersion?: unknown; files?: unknown };
  const annotationIndex = readJson(annotationIndexPath) as { contractVersion?: unknown; files?: unknown };
  if (index.contractVersion !== (successor ? "m3-1-public-pipeline-bundle-index-v2" : "m3-1-public-pipeline-bundle-index-v1") || !Array.isArray(index.files)) throw new Error("evidence bundle index is invalid");
  if (annotationIndex.contractVersion !== (successor ? "m3-1-blind-annotation-bundle-index-v2" : "m3-1-blind-annotation-bundle-index-v1") || !Array.isArray(annotationIndex.files)) throw new Error("annotation bundle index is invalid");

  const expectedEvidencePaths = [...spec.sources.map((source) => source.outputRelativePath), ...spec.evidence.map((evidence) => evidence.outputRelativePath), "freeze-projection.json", "intake-manifest.json", "m3-0-readiness-bridge.json", "pilot-report.json", "split-report.json"].sort();
  const verifyIndexedBundle = (root: string, actual: { files?: unknown }, expectedPaths: string[], prefix: string): void => {
    const entries = actual.files as Array<{ path: string; sha256: string; byteLength: number }>;
    if (canonicalJson(entries.map((entry) => entry.path).sort()) !== canonicalJson(expectedPaths)) issues.push(`${prefix}-index-file-set-mismatch`);
    if (canonicalJson(bundleFiles(root)) !== canonicalJson([...expectedPaths, "bundle-index.json"].sort())) issues.push(`${prefix}-physical-file-set-mismatch`);
    for (const entry of entries) {
      try { const bytes = readFileSync(safeChild(root, entry.path, `${prefix} indexed path`)); if (bytes.length !== entry.byteLength || digest(bytes) !== entry.sha256) issues.push(`${prefix}-file-drift:${entry.path}`); }
      catch { issues.push(`${prefix}-file-missing:${entry.path}`); }
    }
  };

  const approvedEvidenceHashes = new Set<string>();
  for (const evidence of spec.evidence) {
    try {
      const external = acquireApprovedLocalBytes(evidence.evidenceRoot, evidence.evidenceRelativePath, "source evidence oracle");
      if (!SHA256.test(evidence.expectedSha256) || digest(external) !== evidence.expectedSha256 || external.length !== evidence.expectedByteLength) throw new Error("external evidence differs from preregistration");
      const bundled = readFileSync(safeChild(spec.outputRoot, evidence.outputRelativePath, "bundled source evidence"));
      if (!bundled.equals(external)) issues.push(`spec-evidence-byte-drift:${evidence.outputRelativePath}`);
      approvedEvidenceHashes.add(evidence.expectedSha256);
    } catch (error) { issues.push(`spec-evidence-reconstruction-failed:${evidence.outputRelativePath}:${error instanceof Error ? error.message : String(error)}`); }
  }

  const manifestDocuments: PublicIntakeManifestDocument[] = [];
  const splitDocuments: SplitDocument[] = [];
  const blindTargets: Parameters<typeof buildBlindPacket>[0]["targets"] = [];
  const contextsByTargetId: Parameters<typeof buildBlindPacket>[0]["contextsByTargetId"] = {};
  const contextsByTargetIdV2: Parameters<typeof buildBlindPacketV2>[0]["contextsByTargetId"] = {};
  const contextArtifacts = new Map<string, Buffer>();
  for (const source of [...spec.sources].sort((left, right) => left.sourceLocator.localeCompare(right.sourceLocator, "en"))) {
    try {
      for (const hash of [source.provenanceEvidenceSha256, source.rightsEvidenceSha256, source.privacyEvidenceSha256, source.founderAuthorizationSha256].filter((value): value is string => typeof value === "string")) if (!approvedEvidenceHashes.has(hash)) throw new Error("referenced source evidence is absent from independent evidence spec");
      const bytes = readFileSync(safeChild(spec.outputRoot, source.outputRelativePath, "spec-bound source artifact"));
      verifyExpectedBytes(source, bytes);
      const intake = ingestPublicArtifact({ ...source, artifactRoot: spec.outputRoot, artifactPath: source.outputRelativePath });
      const targets = enumerateSvgTextTargets(bytes, source.ruleIds);
      const boundTargets = targets.map((target) => ({ ...target, documentId: intake.documentId }));
      const contexts = successor ? buildBlindContextArtifactsV2(bytes, source.mediaType, boundTargets) : buildBlindContextArtifacts(bytes, source.mediaType, boundTargets);
      if (successor) Object.assign(contextsByTargetIdV2, contexts.contextsByTargetId);
      else Object.assign(contextsByTargetId, contexts.contextsByTargetId);
      for (const artifact of contexts.artifacts) contextArtifacts.set(artifact.path, artifact.bytes);
      manifestDocuments.push({ ...intake, mediaType: source.mediaType, publicRelativePath: source.outputRelativePath, targets });
      splitDocuments.push({ documentId: intake.documentId, split: source.split, artifactSha256: intake.artifactSha256, originGroupId: intake.originGroupId, duplicateGroupId: intake.duplicateGroupId, derivationGroupId: intake.derivationGroupId, templateGroupId: intake.templateGroupId, versionGroupId: intake.versionGroupId });
      blindTargets.push(...targets.map((target) => ({ ...target, documentId: intake.documentId })));
    } catch (error) { issues.push(`spec-source-reconstruction-failed:${source.sourceLocator}:${error instanceof Error ? error.message : String(error)}`); }
  }

  const expectedAnnotationPaths = [...contextArtifacts.keys(), "blind-packet.json"].sort();
  verifyIndexedBundle(spec.outputRoot, index, expectedEvidencePaths, "evidence-bundle");
  verifyIndexedBundle(spec.annotationOutputRoot, annotationIndex, expectedAnnotationPaths, "annotation-bundle");
  if (manifestDocuments.length === spec.sources.length) {
    const expectedManifest = buildPublicIntakeManifest({ manifestId: `intake_manifest_${spec.pilotId}`, createdAt: spec.createdAt, documents: manifestDocuments });
    const expectedBlindPacket = successor
      ? buildBlindPacketV2({ packetId: `blind_packet_${spec.pilotId}`, orderSeed: spec.orderSeed, targets: blindTargets, contextsByTargetId: contextsByTargetIdV2 })
      : buildBlindPacket({ packetId: `blind_packet_${spec.pilotId}`, orderSeed: spec.orderSeed, targets: blindTargets, contextsByTargetId });
    const expectedAnnotationFiles = new Map<string, Buffer>([["blind-packet.json", Buffer.from(canonicalJson(expectedBlindPacket))], ...[...contextArtifacts].map(([path, bytes]) => [path, bytes] as [string, Buffer])]);
    const expectedAnnotationIndex = { contractVersion: successor ? "m3-1-blind-annotation-bundle-index-v2" as const : "m3-1-blind-annotation-bundle-index-v1" as const, files: [...expectedAnnotationFiles].sort(([left], [right]) => left.localeCompare(right, "en")).map(([path, bytes]) => ({ path, sha256: digest(bytes), byteLength: bytes.length })) };
    if (canonicalJson(annotationIndex) !== canonicalJson(expectedAnnotationIndex)) issues.push("annotation-bundle-index-independent-recompute-mismatch");
    for (const [path, bytes] of expectedAnnotationFiles) { try { if (!readFileSync(safeChild(spec.annotationOutputRoot, path, "annotation deliverable")).equals(bytes)) issues.push(`spec-derived-annotation-drift:${path}`); } catch { issues.push(`spec-derived-annotation-missing:${path}`); } }
    if (successor) {
      const actualPacket = readJson(safeChild(spec.annotationOutputRoot, "blind-packet.json", "blind packet v2"));
      const custodial = verifyBlindPacketV2Custodial({ packet: actualPacket, packetId: `blind_packet_${spec.pilotId}`, orderSeed: spec.orderSeed, targets: blindTargets, contextsByTargetId: contextsByTargetIdV2, artifactsByPath: contextArtifacts });
      for (const issue of custodial.issues) issues.push(`blind-packet-v2:${issue}`);
    }
    const splitValidation = validateStrictSplits(splitDocuments);
    const expectedSplitReport = { ...splitValidation, assignments: [...splitDocuments].sort((left, right) => left.documentId.localeCompare(right.documentId, "en")).map((document) => ({ documentId: document.documentId, split: document.split, artifactSha256: document.artifactSha256, originGroupId: document.originGroupId, duplicateGroupId: document.duplicateGroupId ?? null, derivationGroupId: document.derivationGroupId ?? null, templateGroupId: document.templateGroupId ?? null, versionGroupId: document.versionGroupId ?? null })) };
    const holdoutIds = new Set(splitDocuments.filter((document) => document.split === "holdout").map((document) => document.documentId));
    const expectedFreeze = buildFreezeProjection({ contractVersion: "m3-1-freeze-projection-v1", holdoutId: spec.holdoutId, purpose: "holdout-evaluation-preregistration", createdAt: spec.createdAt, frozenAt: spec.createdAt, sequence: successor ? 2 : 1, previousFreezeSha256: successor ? spec.previousFreezeSha256 : null, blindPacketSha256: expectedBlindPacket.packetSha256, blindPacketBundle: { bundleId: `blind_bundle_${spec.pilotId}`, bundleIndexSha256: digest(canonicalJson(expectedAnnotationIndex)), indexedFileCount: expectedAnnotationPaths.length }, samplingPlanSha256: spec.samplingPlanSha256, analysisPlanSha256: spec.analysisPlanSha256, guidelineSha256ByRule: spec.guidelineSha256ByRule, renderer: { status: "blocked-missing-renderer-asset-freeze", rendererFreezeSha256: null, assetManifestSha256: null }, documents: manifestDocuments.filter((document) => holdoutIds.has(document.documentId)).map((document) => ({ documentId: document.documentId, artifactSha256: document.artifactSha256, split: "holdout", groups: { originGroupId: document.originGroupId, duplicateGroupId: document.duplicateGroupId, derivationGroupId: document.derivationGroupId, templateGroupId: document.templateGroupId, versionGroupId: document.versionGroupId }, source: { sourceLocator: document.sourceLocator, sourceCapturedAt: document.sourceCapturedAt, sourceCaptureMode: document.sourceCaptureMode, firstPartySourceSnapshot: document.firstPartySourceSnapshot, provenanceClass: document.provenanceClass, provenanceEvidenceSha256: document.provenanceEvidenceSha256, rightsBasis: document.rightsBasis, rightsEvidenceSha256: document.rightsEvidenceSha256, privacyClass: document.privacyClass, privacyEvidenceSha256: document.privacyEvidenceSha256, founderAuthorizationSha256: document.founderAuthorizationSha256 }, targets: document.targets.map((target) => ({ targetId: target.targetId, ruleId: target.ruleId })) })) });
    const expectedReport = buildPilotReport({ pilotId: spec.pilotId, createdAt: spec.createdAt, manifestReference: { artifactId: expectedManifest.manifestId, artifactSha256: digest(canonicalJson(expectedManifest)), artifactContractVersion: expectedManifest.contractVersion }, samplingPlanId: spec.samplingPlanId, samplingPlanSha256: spec.samplingPlanSha256, artifactCount: manifestDocuments.length, realDocumentCount: manifestDocuments.filter((document) => document.realDocumentEligible).length, originGroupCount: new Set(manifestDocuments.map((document) => document.originGroupId)).size, sourceGateValid: true, annotationGateValid: false, splitGateValid: splitValidation.valid, externalFreezeValid: false, externalTrustValid: false, captureEvidenceValid: false });
    for (const [path, expected] of [["intake-manifest.json", expectedManifest], ["split-report.json", expectedSplitReport], ["freeze-projection.json", expectedFreeze], ["pilot-report.json", expectedReport]] as const) { try { if (canonicalJson(readJson(safeChild(spec.outputRoot, path, path))) !== canonicalJson(expected)) issues.push(`spec-derived-artifact-drift:${path}`); } catch { issues.push(`spec-derived-artifact-missing:${path}`); } }
  }
  try { issues.push(...verifyStoredM31ToM30ReadinessBridge(spec.outputRoot).issues); } catch { issues.push("m3-0-readiness-bridge-missing-or-invalid"); }
  try { const expectedIndex = bundleIndex(spec.outputRoot, expectedEvidencePaths, successor ? "m3-1-public-pipeline-bundle-index-v2" : "m3-1-public-pipeline-bundle-index-v1"); if (canonicalJson(index) !== canonicalJson(expectedIndex)) issues.push("bundle-index-independent-recompute-mismatch"); } catch { issues.push("bundle-index-independent-recompute-failed"); }
  return { valid: issues.length === 0, issues: [...new Set(issues)].sort(), bundleIndexSha256: digest(readFileSync(indexPath)), annotationBundleIndexSha256: digest(readFileSync(annotationIndexPath)) };
}
