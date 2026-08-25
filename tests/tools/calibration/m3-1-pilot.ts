import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { TextDecoder } from "node:util";

import { Ajv2020 } from "ajv/dist/2020.js";
import { parse, type DefaultTreeAdapterMap } from "parse5";

export type RuleId =
  | "svg/text-clipped"
  | "svg/text-ink-collision"
  | "svg/text-overflows-viewport";
const RULE_IDS: readonly RuleId[] = ["svg/text-clipped", "svg/text-ink-collision", "svg/text-overflows-viewport"];

type ProvenanceClass =
  | "public-first-party"
  | "public-redistributable"
  | "synthetic-first-party";
type RightsBasis =
  | "first-party-founder-authorized"
  | "public-domain"
  | "cc0-1.0";
type PrivacyClass =
  | "synthetic-no-personal-data"
  | "reviewed-no-personal-data"
  | "reviewed-public-business-identity";
type Split = "development" | "tuning" | "holdout";

const SHA256 = /^[a-f0-9]{64}$/u;
const SHA1 = /^[a-f0-9]{40}$/u;
const COMMIT = /^[a-f0-9]{40}$/u;
const OPAQUE_LOCATOR = /^source_[a-z0-9][a-z0-9._-]{7,119}$/u;
const GROUP_ID = /^[a-z]+_group_[A-Za-z0-9._-]{8,80}$/u;
const OPAQUE_IDENTITY = /^[A-Za-z][A-Za-z0-9._-]{7,79}$/u;
const TARGET_ID = /^target_[a-f0-9]{32}$/u;
const DOCUMENT_ID = /^doc_[a-f0-9]{32}$/u;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const RFC3339_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const FORBIDDEN_BLIND_KEYS = /(?:finding|score|threshold|production.?label|outcome|calibrated|severity|candidate.?config|breaklint.?result)/iu;
const PRODUCER_TRUST_KEYS = /^(?:publicKey|privateKey|key|certificate|trustedRoot|trustPolicy|rootCertificate|customTrustedRoot|revocation|revocations|revokedSignerDigests|revokedSourceDigests)$/iu;
const m31Ajv = new Ajv2020({ allErrors: true, strict: true, formats: { "date-time": RFC3339_DATE_TIME } });
const validateBlindPacketSchema = m31Ajv.compile(JSON.parse(readFileSync(new URL("../../../schemas/calibration/blind-packet-v1.schema.json", import.meta.url), "utf8")) as object);
const validateBlindPacketV2Schema = m31Ajv.compile(JSON.parse(readFileSync(new URL("../../../schemas/calibration/blind-packet-v2.schema.json", import.meta.url), "utf8")) as object);
const validateBlindPacketV3Schema = m31Ajv.compile(JSON.parse(readFileSync(new URL("../../../schemas/calibration/blind-packet-v3.schema.json", import.meta.url), "utf8")) as object);
const validatePinnedTrustPolicySchema = m31Ajv.compile(JSON.parse(readFileSync(new URL("../../../schemas/calibration/attestor-trust-policy-v1.schema.json", import.meta.url), "utf8")) as object);

export const PINNED_M3_1_TRUST_POLICY = Object.freeze({
  contractVersion: "m3-1-attestor-trust-policy-v1",
  policyId: "attestor_policy_breaklint_local_draft_0001",
  policyVersion: 1,
  createdAt: "2026-08-23T00:00:00Z",
  effectiveFrom: "2026-08-23T00:00:00Z",
  expiresAt: "2027-08-23T00:00:00Z",
  purpose: Object.freeze(["holdout-freeze", "capture-attestation"]),
  governanceSource: Object.freeze({
    sourceId: "breaklint-repository-local-demonstrator",
    sourceSha256: null,
    pinLocation: "repository-local-untrusted-demonstrator",
    externallyGoverned: false,
  }),
  previousPolicySha256: null,
  minimumReceiptSequence: 1,
  minimumCheckpointSha256: null,
  allowedWorkflowIdentities: Object.freeze([Object.freeze({
    identityId: "attestor_identity_breaklint_github_main_0001",
    issuer: "https://token.actions.githubusercontent.com",
    subject: "repo:godarg/breaklint:ref:refs/heads/main",
    repository: "godarg/breaklint",
    workflowPath: ".github/workflows/m3-1-attest.yml",
    workflowRef: "godarg/breaklint/.github/workflows/m3-1-attest.yml@refs/heads/main",
    sourceRef: "refs/heads/main",
    oidcAudience: "sigstore",
    trustRootProvider: "github-cli-built-in-sigstore-public-good",
    runnerEnvironment: "github-hosted",
    notBefore: "2026-08-23T00:00:00Z",
    notAfter: "2027-08-23T00:00:00Z",
    allowedPurposes: Object.freeze(["holdout-freeze", "capture-attestation"]),
  })]),
  rotations: Object.freeze([]),
  revocations: Object.freeze([]),
  unknownIdentityDisposition: "reject",
  expiredIdentityDisposition: "reject",
  rotatedOutIdentityDisposition: "reject",
  revokedIdentityDisposition: "reject",
  replayDisposition: "reject",
  rollbackDisposition: "reject",
  allowSelfProvidedTrustRoot: false,
  externalPolicyPinRequired: true,
  externalPolicyPinPresent: false,
  policyStatus: "untrusted",
  evidenceTrust: "untrusted",
});
if (!validatePinnedTrustPolicySchema(PINNED_M3_1_TRUST_POLICY)) throw new Error(`pinned M3-1 trust policy schema invalid: ${JSON.stringify(validatePinnedTrustPolicySchema.errors)}`);
const PINNED_M3_1_WORKFLOW_IDENTITY = PINNED_M3_1_TRUST_POLICY.allowedWorkflowIdentities[0]!;

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, entry]) => [key, canonical(entry)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return `${JSON.stringify(canonical(value))}\n`;
}

function requireSha256(value: string, label: string): void {
  if (!SHA256.test(value)) throw new Error(`${label} must be a lowercase SHA-256 digest`);
}

function validateSafeRelativeFile(root: string, declaredPath: string): string {
  if (!declaredPath || isAbsolute(declaredPath) || declaredPath.includes("..") || declaredPath.includes("~")) {
    throw new Error("artifactPath must be a safe relative path");
  }
  const rootReal = realpathSync(root);
  const lexical = resolve(rootReal, declaredPath);
  const lexicalRelative = relative(rootReal, lexical);
  if (lexicalRelative.startsWith("..") || isAbsolute(lexicalRelative)) {
    throw new Error("artifactPath must be a safe relative path");
  }
  if (!existsSync(lexical)) throw new Error("artifact does not exist");
  if (lstatSync(lexical).isSymbolicLink()) throw new Error("artifact symlinks are forbidden");
  const artifactReal = realpathSync(lexical);
  const realRelative = relative(rootReal, artifactReal);
  if (realRelative.startsWith("..") || isAbsolute(realRelative) || !artifactReal.startsWith(`${rootReal}${sep}`)) {
    throw new Error("artifact escapes the approved root");
  }
  if (!lstatSync(artifactReal).isFile()) throw new Error("artifact must be a regular file");
  return artifactReal;
}

function validateOpaqueLocator(locator: string): void {
  if (
    !OPAQUE_LOCATOR.test(locator)
    || /(?:token|secret|password|credential|session|bearer|api.?key)/iu.test(locator)
  ) {
    throw new Error("sourceLocator must be an opaque locator without a path, URL, identity or secret");
  }
}

export interface PublicArtifactIntakeRequest {
  artifactRoot: string;
  artifactPath: string;
  sourceLocator: string;
  sourceCapturedAt: string;
  sourceCaptureMode: "https-byte-capture" | "founder-authorized-source-snapshot" | "synthetic-fixture-construction";
  firstPartySourceSnapshot?: { commitSha: string; blobSha1: string; commitTime: string };
  provenanceClass: ProvenanceClass;
  rightsBasis: RightsBasis;
  privacyClass?: PrivacyClass;
  privacyApproved: true;
  redistributionApproved: true;
  provenanceEvidenceSha256: string;
  rightsEvidenceSha256: string;
  privacyEvidenceSha256: string;
  founderAuthorizationSha256?: string;
  originGroupId: string;
  duplicateGroupId: string;
  derivationGroupId: string;
  templateGroupId: string;
  versionGroupId: string;
}

export interface PublicArtifactIntakeResult {
  documentId: string;
  artifactSha256: string;
  byteLength: number;
  sourceLocator: string;
  sourceCapturedAt: string;
  sourceCaptureMode: PublicArtifactIntakeRequest["sourceCaptureMode"];
  firstPartySourceSnapshot: PublicArtifactIntakeRequest["firstPartySourceSnapshot"] | null;
  provenanceClass: ProvenanceClass;
  rightsBasis: RightsBasis;
  privacyClass: PrivacyClass;
  realDocumentEligible: boolean;
  originGroupId: string;
  duplicateGroupId: string;
  derivationGroupId: string;
  templateGroupId: string;
  versionGroupId: string;
  provenanceEvidenceSha256: string;
  rightsEvidenceSha256: string;
  privacyEvidenceSha256: string;
  founderAuthorizationSha256: string | null;
}

export interface PublicIntakeManifestDocument extends PublicArtifactIntakeResult {
  mediaType: "text/html" | "image/svg+xml";
  publicRelativePath: string;
  targets: EnumeratedTextTarget[];
}

export function ingestPublicArtifact(request: PublicArtifactIntakeRequest): PublicArtifactIntakeResult {
  validateOpaqueLocator(request.sourceLocator);
  if (!RFC3339_DATE_TIME.test(request.sourceCapturedAt)) throw new Error("sourceCapturedAt must be an RFC 3339 timestamp");
  if (![request.originGroupId, request.duplicateGroupId, request.derivationGroupId, request.templateGroupId, request.versionGroupId].every((entry) => GROUP_ID.test(entry))) {
    throw new Error("all origin, duplicate, derivation, template and version group IDs must be stable opaque identifiers");
  }
  const permittedPair =
    (request.provenanceClass === "public-first-party" && request.rightsBasis === "first-party-founder-authorized")
    || (request.provenanceClass === "public-redistributable" && ["public-domain", "cc0-1.0"].includes(request.rightsBasis))
    || (request.provenanceClass === "synthetic-first-party" && request.rightsBasis === "first-party-founder-authorized");
  if (!permittedPair) throw new Error("provenance class and rights basis are not an approved pair");
  if (request.provenanceClass === "public-redistributable" && request.sourceCaptureMode !== "https-byte-capture") throw new Error("public redistributable input requires an HTTPS byte-capture binding");
  if (request.provenanceClass === "public-first-party" && request.sourceCaptureMode !== "founder-authorized-source-snapshot") throw new Error("public first-party input requires a Founder-authorized source snapshot");
  if (request.provenanceClass === "synthetic-first-party" && request.sourceCaptureMode !== "synthetic-fixture-construction") throw new Error("synthetic input requires an explicit synthetic construction binding");
  if (request.sourceCaptureMode === "founder-authorized-source-snapshot") {
    if (!request.firstPartySourceSnapshot || !COMMIT.test(request.firstPartySourceSnapshot.commitSha) || !SHA1.test(request.firstPartySourceSnapshot.blobSha1) || !RFC3339_DATE_TIME.test(request.firstPartySourceSnapshot.commitTime)) throw new Error("first-party source snapshot binding is incomplete");
  } else if (request.firstPartySourceSnapshot !== undefined) throw new Error("source commit/blob metadata is permitted only for first-party snapshots");
  if (request.privacyApproved !== true) throw new Error("explicit privacy approval is required");
  if (request.redistributionApproved !== true) throw new Error("explicit redistribution approval is required");

  if (!request.privacyClass) throw new Error("an explicit privacy class is required");
  const privacyClass = request.privacyClass;
  if (privacyClass === "reviewed-public-business-identity") {
    if (!request.founderAuthorizationSha256) {
      throw new Error("reviewed public business identity requires Founder authorization evidence");
    }
    requireSha256(request.founderAuthorizationSha256, "founderAuthorizationSha256");
  }
  const realDocumentEligible = request.provenanceClass !== "synthetic-first-party";
  for (const [label, digest] of [
    ["provenanceEvidenceSha256", request.provenanceEvidenceSha256],
    ["rightsEvidenceSha256", request.rightsEvidenceSha256],
    ["privacyEvidenceSha256", request.privacyEvidenceSha256],
  ] as const) {
    requireSha256(digest, label);
  }

  const artifact = validateSafeRelativeFile(request.artifactRoot, request.artifactPath);
  const bytes = readFileSync(artifact);
  const artifactSha256 = sha256(bytes);
  return {
    documentId: `doc_${artifactSha256.slice(0, 32)}`,
    artifactSha256,
    byteLength: bytes.length,
    sourceLocator: request.sourceLocator,
    sourceCapturedAt: request.sourceCapturedAt,
    sourceCaptureMode: request.sourceCaptureMode,
    firstPartySourceSnapshot: request.firstPartySourceSnapshot ?? null,
    provenanceClass: request.provenanceClass,
    rightsBasis: request.rightsBasis,
    privacyClass,
    realDocumentEligible,
    originGroupId: request.originGroupId,
    duplicateGroupId: request.duplicateGroupId,
    derivationGroupId: request.derivationGroupId,
    templateGroupId: request.templateGroupId,
    versionGroupId: request.versionGroupId,
    provenanceEvidenceSha256: request.provenanceEvidenceSha256,
    rightsEvidenceSha256: request.rightsEvidenceSha256,
    privacyEvidenceSha256: request.privacyEvidenceSha256,
    founderAuthorizationSha256: request.founderAuthorizationSha256 ?? null,
  };
}

export interface StableTargetIdentity {
  artifactSha256: string;
  svgRootKey: string;
  sourceIdentity: string;
  ruleId: RuleId;
}

export function deriveStableTargetId(identity: StableTargetIdentity): string {
  requireSha256(identity.artifactSha256, "artifactSha256");
  if (!identity.svgRootKey || !identity.sourceIdentity) throw new Error("target source identity is incomplete");
  return `target_${sha256(`${identity.artifactSha256}\0${identity.svgRootKey}\0${identity.sourceIdentity}\0${identity.ruleId}`).slice(0, 32)}`;
}

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

function childElements(node: Node): Element[] {
  if (!("childNodes" in node)) return [];
  return node.childNodes.filter((child): child is Element => "tagName" in child);
}

function elementText(node: Node): string {
  if ("nodeName" in node && node.nodeName === "#text" && "value" in node) return node.value;
  if (!("childNodes" in node)) return "";
  return node.childNodes.map(elementText).join("");
}

function attribute(element: Element, name: string): string | null {
  return element.attrs.find((entry) => entry.name === name)?.value ?? null;
}

export interface EnumeratedTextTarget extends StableTargetIdentity {
  targetId: string;
  structuralPath: string;
}

export function enumerateSvgTextTargets(bytes: Buffer, ruleIds: RuleId[]): EnumeratedTextTarget[] {
  if (ruleIds.length === 0 || new Set(ruleIds).size !== ruleIds.length) throw new Error("requested rule IDs must be non-empty and unique");
  const artifactSha256 = sha256(bytes);
  const document = parse(bytes.toString("utf8"));
  const targets: EnumeratedTextTarget[] = [];

  function walk(node: Node, path: string, svgRoot: { key: string; path: string } | null): void {
    const children = childElements(node);
    const counters = new Map<string, number>();
    for (const child of children) {
      const index = counters.get(child.tagName) ?? 0;
      counters.set(child.tagName, index + 1);
      const childPath = `${path}/${child.tagName}[${index}]`;
      let nextSvgRoot = svgRoot;
      if (child.tagName === "svg") {
        const authoredId = attribute(child, "id");
        nextSvgRoot = { key: authoredId ? `author-id:${authoredId}` : `structural-path:${childPath}`, path: childPath };
      }
      if (child.tagName === "text" && nextSvgRoot) {
        const authoredId = attribute(child, "id");
        const normalizedAttributes = child.attrs
          .filter((entry) => entry.name !== "id")
          .sort((left, right) => left.name.localeCompare(right.name, "en"))
          .map((entry) => `${entry.name}=${entry.value.trim().replace(/\s+/gu, " ")}`)
          .join("\0");
        const normalizedText = elementText(child).trim().replace(/\s+/gu, " ");
        const sourceIdentity = authoredId
          ? `author-id:${authoredId}`
          : `source-signature:${sha256(`${nextSvgRoot.path}\0${childPath}\0${normalizedAttributes}\0${normalizedText}`)}`;
        for (const ruleId of ruleIds) {
          const identity = { artifactSha256, svgRootKey: nextSvgRoot.key, sourceIdentity, ruleId };
          targets.push({ ...identity, targetId: deriveStableTargetId(identity), structuralPath: childPath });
        }
      }
      walk(child, childPath, nextSvgRoot);
    }
  }
  walk(document, "", null);
  return targets;
}

export function buildPublicIntakeManifest(input: {
  manifestId: string;
  createdAt: string;
  documents: PublicIntakeManifestDocument[];
}): {
  contractVersion: "m3-1-public-intake-manifest-v1";
  manifestId: string;
  createdAt: string;
  purpose: "m3-1-public-corpus-intake";
  documents: Array<{
    documentId: string;
    artifact: { sha256: string; byteLength: number; mediaType: "text/html" | "image/svg+xml"; relativePath: string };
    sourceLocator: string;
    sourceCapturedAt: string;
    sourceCaptureMode: PublicArtifactIntakeRequest["sourceCaptureMode"];
    firstPartySourceSnapshot: PublicArtifactIntakeRequest["firstPartySourceSnapshot"] | null;
    provenanceClass: ProvenanceClass;
    provenanceEvidenceSha256: string;
    rightsBasis: RightsBasis;
    rightsEvidenceSha256: string;
    privacyClass: PrivacyClass;
    privacyEvidenceSha256: string;
    founderAuthorizationSha256: string | null;
    groups: { originGroupId: string; duplicateGroupId: string; derivationGroupId: string; templateGroupId: string; versionGroupId: string };
    targets: Array<{ targetId: string; artifactSha256: string; ruleId: RuleId; svgRootLocator: Record<string, string>; targetLocator: Record<string, string> }>;
    claimEligible: false;
    captureAttestorTrustValid: false;
    calibrated: false;
  }>;
  claimEligible: false;
  captureAttestorTrustValid: false;
  calibrated: false;
  evidenceTrust: "untrusted-intake-only";
} {
  if (!/^intake_manifest_[A-Za-z0-9._-]{8,80}$/u.test(input.manifestId)) throw new Error("invalid intake manifest ID");
  if (!ISO_DATE_TIME.test(input.createdAt)) throw new Error("invalid intake manifest timestamp");
  const documentIds = new Set<string>();
  const documents = [...input.documents]
    .map((document) => {
      if (!DOCUMENT_ID.test(document.documentId)) throw new Error("invalid intake document ID");
      if (documentIds.has(document.documentId)) throw new Error("duplicate intake document ID");
      documentIds.add(document.documentId);
      validateOpaqueLocator(document.sourceLocator);
      requireSha256(document.artifactSha256, "artifactSha256");
      if (isAbsolute(document.publicRelativePath) || document.publicRelativePath.includes("..") || document.publicRelativePath.includes("~")) {
        throw new Error("publicRelativePath must be safe and relative");
      }
      for (const target of document.targets) {
        if (target.artifactSha256 !== document.artifactSha256) throw new Error("target artifact hash does not match intake document bytes");
        if (deriveStableTargetId(target) !== target.targetId) throw new Error("target ID does not match its byte-bound source identity");
      }
      const locator = (identity: string, structuralPath: string, artifactSha256: string): Record<string, string> => {
        if (identity.startsWith("author-id:")) return { mode: "author-id", authorId: identity.slice("author-id:".length) };
        const sourceSignatureSha256 = identity.startsWith("source-signature:")
          ? identity.slice("source-signature:".length)
          : sha256(`${artifactSha256}\0${identity}`);
        return { mode: "byte-bound-structural", structuralPath, sourceSignatureSha256 };
      };
      return {
        documentId: document.documentId,
        artifact: { sha256: document.artifactSha256, byteLength: document.byteLength, mediaType: document.mediaType, relativePath: document.publicRelativePath },
        sourceLocator: document.sourceLocator,
        sourceCapturedAt: document.sourceCapturedAt,
        sourceCaptureMode: document.sourceCaptureMode,
        firstPartySourceSnapshot: document.firstPartySourceSnapshot,
        provenanceClass: document.provenanceClass,
        provenanceEvidenceSha256: document.provenanceEvidenceSha256,
        rightsBasis: document.rightsBasis,
        rightsEvidenceSha256: document.rightsEvidenceSha256,
        privacyClass: document.privacyClass,
        privacyEvidenceSha256: document.privacyEvidenceSha256,
        founderAuthorizationSha256: document.founderAuthorizationSha256,
        groups: {
          originGroupId: document.originGroupId,
          duplicateGroupId: document.duplicateGroupId,
          derivationGroupId: document.derivationGroupId,
          templateGroupId: document.templateGroupId,
          versionGroupId: document.versionGroupId,
        },
        targets: [...document.targets]
          .sort((left, right) => left.targetId.localeCompare(right.targetId, "en"))
          .map((target) => ({
            targetId: target.targetId,
            artifactSha256: target.artifactSha256,
            ruleId: target.ruleId,
            svgRootLocator: locator(target.svgRootKey, target.svgRootKey.startsWith("structural-path:") ? target.svgRootKey.slice("structural-path:".length) : target.structuralPath.split("/text[")[0] ?? target.structuralPath, target.artifactSha256),
            targetLocator: locator(target.sourceIdentity, target.structuralPath, target.artifactSha256),
          })),
        claimEligible: false as const,
        captureAttestorTrustValid: false as const,
        calibrated: false as const,
      };
    })
    .sort((left, right) => left.documentId.localeCompare(right.documentId, "en"));
  const withoutHash = {
    contractVersion: "m3-1-public-intake-manifest-v1" as const,
    manifestId: input.manifestId,
    createdAt: input.createdAt,
    purpose: "m3-1-public-corpus-intake" as const,
    documents,
    claimEligible: false as const,
    captureAttestorTrustValid: false as const,
    calibrated: false as const,
    evidenceTrust: "untrusted-intake-only" as const,
  };
  return withoutHash;
}

export interface BlindTarget {
  targetId: string;
  documentId: string;
  artifactSha256: string;
  svgRootKey: string;
  structuralPath: string;
  sourceIdentity: string;
  ruleId: RuleId;
  [key: string]: unknown;
}

export interface BlindTargetContext {
  artifactPath: string;
  artifactSha256: string;
  byteLength: number;
  mediaType: "image/svg+xml";
  targetLocator: { mode: "context-structural-path"; structuralPathWithinContext: string };
  renderingContract: {
    mode: "browser-native-isolated-svg";
    externalAssetsFetched: false;
    sourceScope: "exact-svg-document" | "embedded-inline-svg-only";
    sourceByteTreatment: "exact-source-subtree-plus-inert-packet-comment";
    limitations: string[];
  };
}

export interface BlindTargetContextV2 {
  artifactPath: string;
  artifactSha256: string;
  byteLength: number;
  mediaType: "image/svg+xml";
  targetLocator: { mode: "context-structural-path"; structuralPathWithinContext: string };
  renderingContract: {
    mode: "browser-native-isolated-svg";
    externalAssetsFetched: false;
    sourceScope: "exact-svg-document" | "embedded-inline-svg-only";
    sourceByteTreatment: "deterministic-svg-sanitization-v2";
    sanitizerContractVersion: "m3-1-svg-blind-sanitizer-v2";
    independentContentVerificationRequired: true;
    limitations: string[];
  };
}

const BLIND_CONTEXT_INERT_COMMENT = "<!-- isolated annotation context; source subtree otherwise byte-exact -->";

function neutralizeBlindSvgContext(svgSource: string): string {
  const start = svgSource.search(/<svg\b/iu);
  if (start < 0) throw new Error("blind SVG context root is missing");
  let quote: '"' | "'" | null = null;
  for (let index = start; index < svgSource.length; index += 1) {
    const character = svgSource[index];
    if (quote !== null) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") quote = character;
    else if (character === ">") return `${svgSource.slice(0, index + 1)}${BLIND_CONTEXT_INERT_COMMENT}${svgSource.slice(index + 1)}`;
  }
  throw new Error("blind SVG context opening tag is incomplete");
}

function blindContextHasExternalAssetReference(svgSource: string): boolean {
  const document = parse(svgSource);
  const inspectCssValue = (value: string): boolean => {
    if (/@import\b/iu.test(value)) return true;
    for (const match of value.matchAll(/url\(\s*["']?([^)'"\s]+)["']?\s*\)/giu)) {
      const target = match[1]!;
      if (!target.startsWith("#") && !target.startsWith("data:")) return true;
    }
    return false;
  };
  const walk = (node: Node): boolean => {
    if ("tagName" in node) {
      for (const entry of node.attrs) {
        const name = entry.name.toLowerCase();
        if ((name === "href" || name === "src" || name === "xlink:href") &&
            !entry.value.startsWith("#") && !entry.value.startsWith("data:")) return true;
        if (inspectCssValue(entry.value)) return true;
      }
      if (node.tagName.toLowerCase() === "style" && inspectCssValue(elementText(node))) return true;
    }
    return "childNodes" in node && node.childNodes.some(walk);
  };
  if (walk(document)) return true;
  // Parsing is the structural authority. This remaining text check covers a top-level @import
  // token outside an element, which parse5 may retain as a text node rather than an SVG element.
  if (/@import\b/iu.test(elementText(document))) return true;
  return false;
}

export function buildBlindContextArtifacts(bytes: Buffer, mediaType: "text/html" | "image/svg+xml", targets: BlindTarget[]): {
  artifacts: Array<{ path: string; bytes: Buffer; sha256: string; byteLength: number }>;
  contextsByTargetId: Record<string, BlindTargetContext>;
} {
  type LocatedNode = Node & { sourceCodeLocation?: { startOffset?: number; endOffset?: number } };
  const source = bytes.toString("utf8");
  const document = parse(source, { sourceCodeLocationInfo: true });
  const svgSourceByPath = new Map<string, string>();
  function walk(node: Node, path: string): void {
    const counters = new Map<string, number>();
    for (const child of childElements(node)) {
      const index = counters.get(child.tagName) ?? 0;
      counters.set(child.tagName, index + 1);
      const childPath = `${path}/${child.tagName}[${index}]`;
      if (child.tagName === "svg") {
        const location = (child as LocatedNode).sourceCodeLocation;
        if (location?.startOffset === undefined || location.endOffset === undefined) throw new Error("SVG context source offsets are unavailable");
        const svgSource = source.slice(location.startOffset, location.endOffset);
        if (blindContextHasExternalAssetReference(svgSource)) throw new Error("blind context would require an external asset fetch");
        svgSourceByPath.set(childPath, svgSource);
      }
      walk(child, childPath);
    }
  }
  walk(document, "");
  const artifactByRoot = new Map<string, { path: string; bytes: Buffer; sha256: string; byteLength: number }>();
  const contextsByTargetId: Record<string, BlindTargetContext> = {};
  for (const target of targets) {
    const match = /^(.*?\/svg\[\d+\])/u.exec(target.structuralPath);
    const rootPath = match?.[1];
    const svgSource = rootPath ? svgSourceByPath.get(rootPath) : undefined;
    if (!rootPath || !svgSource) throw new Error(`SVG context is missing for target ${target.targetId}`);
    let artifact = artifactByRoot.get(rootPath);
    if (!artifact) {
      const contextBytes = Buffer.from(neutralizeBlindSvgContext(svgSource), "utf8");
      const contextSha256 = sha256(contextBytes);
      artifact = { path: `blind-context/context_${contextSha256.slice(0, 24)}.svg`, bytes: contextBytes, sha256: contextSha256, byteLength: contextBytes.length };
      artifactByRoot.set(rootPath, artifact);
    }
    const targetLocator = { mode: "context-structural-path" as const, structuralPathWithinContext: target.structuralPath.slice(rootPath.length) || "/" };
    contextsByTargetId[target.targetId] = {
      artifactPath: artifact.path,
      artifactSha256: artifact.sha256,
      byteLength: artifact.byteLength,
      mediaType: "image/svg+xml",
      targetLocator,
      renderingContract: {
        mode: "browser-native-isolated-svg",
        externalAssetsFetched: false,
        sourceScope: mediaType === "text/html" ? "embedded-inline-svg-only" : "exact-svg-document",
        sourceByteTreatment: "exact-source-subtree-plus-inert-packet-comment",
        limitations: mediaType === "text/html"
          ? ["Only the embedded inline SVG is presented; the unstyled containing HTML page is not claimed as a faithful site render.", "Font identity and production renderer capture are not frozen; annotation is process-pilot evidence only."]
          : ["Font identity and production renderer capture are not frozen; annotation is process-pilot evidence only."],
      },
    };
  }
  return { artifacts: [...artifactByRoot.values()].sort((left, right) => left.path.localeCompare(right.path, "en")), contextsByTargetId };
}

const SVG_ALLOWED_NAMESPACE_DECLARATIONS = new Map([
  ["xmlns", "http://www.w3.org/2000/svg"],
  ["xmlns:xlink", "http://www.w3.org/1999/xlink"],
]);
const SVG_REMOVED_NAMESPACE_PREFIXES = "(?:cc|dc|inkscape|rdf|sodipodi|svg)";
const SVG_OUTCOME_HINT = /(?:(?:^|[^A-Za-z0-9])break\s*lint\b[\s\S]{0,32}\b(?:finding|result|outcome|pass|fail|severity|score|threshold|calibrat(?:ed|ion)?)\b|(?:^|[^A-Za-z0-9])(?:finding|outcome|result|verdict|severity|calibrated|production[\s_.-]*label|candidate[\s_.-]*config)(?=[\s:_.-])\s*[:=_-]\s*(?:pass|fail|true|false|positive|negative|present|absent|blocker|critical|high|medium|low|[0-9]))/iu;
const SVG_TOOL_HINT = /\b(?:inkscape|sodipodi|adobe\s+illustrator|created\s+with|exported\s+by)\b/iu;
// Blind-context attribute values may only call functions that are pure geometry, plus `url()`
// restricted to a same-document fragment. This is an ALLOWLIST on purpose: the previous guard
// enumerated the URL syntaxes it knew (`href`/`src`/`@import`/`url(<bare token>)`), and an
// independent review defeated it twice without a backslash — `url("https://host/x"/*c*/)`, whose
// trailing comment escapes the bare-token pattern, and `image-set("https://host/x" 1x)`, which
// never spells `url(` at all. Both produced an annotator context that the fixed-point verifier
// called valid while real Chrome fetched from it. A denylist of CSS functions cannot be finished;
// CSS keeps adding fetching functions. Measured against every legitimate byte we hold, the whole
// corpus needs exactly four names — matrix, scale, translate, url — so an allowlist costs nothing.
const SVG_ALLOWED_ATTRIBUTE_FUNCTIONS = new Set([
  "matrix", "translate", "translatex", "translatey",
  "scale", "scalex", "scaley", "rotate", "skewx", "skewy", "url",
]);
const SVG_ATTRIBUTE_FUNCTION_CALL = /([A-Za-z-][\w-]*)\s*\(/gu;
const SVG_ATTRIBUTE_URL_OPENING = /url\s*\(/giu;
const SVG_SAME_DOCUMENT_FRAGMENT = /^(?:"#[A-Za-z_][\w.:-]*"|'#[A-Za-z_][\w.:-]*'|#[A-Za-z_][\w.:-]*)$/u;
// The prefix allowlist below used to admit `xlink`/`xml` wholesale, so `xml:id`, `xml:lang` and
// `xlink:title` reached the annotator verbatim: an authored `xml:id` is not rewritten by the idMap
// (that rewrite keys on the local name `id`), so a source-identifying value survived while every
// `#reference` to it was rewritten away, and `xlink:title` carried arbitrary text past the same
// gate that removes `<title>`/`<desc>` for exactly this reason. Measured across the delivered v2
// contexts, the whole corpus needs exactly two qualified names, so an allowlist costs nothing.
const SVG_ALLOWED_NAMESPACED_ATTRIBUTES = new Set(["xlink:href", "xml:space"]);

const SVG_PRIVATE_PATH_HINT = /(?:\bfile:|\b[A-Za-z]:\\|\/(?:Users|home|private|var\/folders)\/|(?:^|[\s"'])\.\.?\/|\.(?:ai|eps|html?|pdf|svg)\b)/iu;

function normalizeBlindHintText(value: string): string {
  return value.normalize("NFKC").replace(/[\u200B-\u200D\u2060\uFEFF]/gu, "").replace(/\s+/gu, " ");
}

type LocatedElement = Element & {
  sourceCodeLocation?: {
    attrs?: Record<string, { startOffset: number; endOffset: number }>;
  } | null;
};

function parsedElements(source: string): Element[] {
  const elements: Element[] = [];
  const document = parse(source, { sourceCodeLocationInfo: true });
  const walk = (node: Node): void => {
    if ("tagName" in node) elements.push(node);
    if ("childNodes" in node) node.childNodes.forEach(walk);
  };
  walk(document);
  return elements;
}

function qualifiedAttributeName(entry: Element["attrs"][number]): string {
  return entry.prefix ? `${entry.prefix}:${entry.name}` : entry.name;
}

function replaceParsedAttributes(source: string, replace: (name: string, value: string, quote: "\"" | "'") => string): string {
  const replacements: Array<{ start: number; end: number; text: string }> = [];
  for (const element of parsedElements(source) as LocatedElement[]) {
    const locations = element.sourceCodeLocation?.attrs;
    if (!locations) continue;
    for (const entry of element.attrs) {
      const qualified = qualifiedAttributeName(entry);
      const location = locations[qualified] ?? Object.entries(locations).find(([name]) => name.toLowerCase() === qualified.toLowerCase())?.[1];
      if (!location) throw new Error(`blind SVG context attribute location is unavailable: ${qualified}`);
      const raw = source.slice(location.startOffset, location.endOffset);
      const match = /^([:\w.-]+)(\s*=\s*)(["'])([\s\S]*)\3$/u.exec(raw);
      if (!match) throw new Error(`blind SVG context attribute location is malformed: ${qualified}`);
      const [, name, separator, quote, value] = match as RegExpExecArray & [string, string, string, "\"" | "'", string];
      replacements.push({ start: location.startOffset, end: location.endOffset, text: `${name}${separator}${quote}${replace(name, value, quote)}${quote}` });
    }
  }
  let rewritten = source;
  for (const replacement of replacements.sort((left, right) => right.start - left.start)) {
    rewritten = `${rewritten.slice(0, replacement.start)}${replacement.text}${rewritten.slice(replacement.end)}`;
  }
  return rewritten;
}

function decodeXmlCharacterReferences(value: string): string {
  if (/&(?!(?:#(?:x[0-9A-Fa-f]+|[0-9]+)|amp|apos|gt|lt|quot);)/gu.test(value)) throw new Error("blind SVG context contains a bare or unknown character reference");
  return value.replace(/&(#(?:x[0-9A-Fa-f]+|[0-9]+)|amp|apos|gt|lt|quot);/gu, (_match, entity: string) => {
    if (entity === "amp") return "&";
    if (entity === "apos") return "'";
    if (entity === "gt") return ">";
    if (entity === "lt") return "<";
    if (entity === "quot") return "\"";
    const numeric = entity.startsWith("#x") ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    if (!Number.isSafeInteger(numeric) || numeric <= 0 || numeric > 0x10FFFF || (numeric >= 0xD800 && numeric <= 0xDFFF)) throw new Error("blind SVG context contains an invalid character reference");
    return String.fromCodePoint(numeric);
  });
}

function validateSvgMarkupLexically(source: string): void {
  let offset = 0;
  while (offset < source.length) {
    const opening = source.indexOf("<", offset);
    if (opening < 0) break;
    if (source.startsWith("<!--", opening)) {
      const end = source.indexOf("-->", opening + 4);
      if (end < 0) throw new Error("blind SVG context contains an unterminated comment");
      offset = end + 3;
      continue;
    }
    let cursor = opening + 1;
    const closing = source[cursor] === "/";
    if (closing) cursor += 1;
    const nameMatch = /^[A-Za-z_][A-Za-z0-9_.:-]*/u.exec(source.slice(cursor));
    if (!nameMatch) throw new Error("blind SVG context contains malformed tag syntax");
    cursor += nameMatch[0].length;
    if (closing) {
      while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
      if (source[cursor] !== ">") throw new Error("blind SVG context contains malformed closing tag syntax");
      offset = cursor + 1;
      continue;
    }
    const names = new Set<string>();
    while (cursor < source.length) {
      while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
      if (source[cursor] === ">") { offset = cursor + 1; break; }
      if (source[cursor] === "/" && source[cursor + 1] === ">") { offset = cursor + 2; break; }
      const attributeMatch = /^[A-Za-z_][A-Za-z0-9_.:-]*/u.exec(source.slice(cursor));
      if (!attributeMatch) throw new Error("blind SVG context contains malformed attribute syntax");
      const attributeName = attributeMatch[0];
      const normalizedName = attributeName.toLowerCase();
      if (names.has(normalizedName)) throw new Error(`blind SVG context contains a duplicate attribute: ${attributeName}`);
      names.add(normalizedName);
      cursor += attributeName.length;
      while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
      if (source[cursor] !== "=") throw new Error(`blind SVG context attribute ${attributeName} must have an explicit value`);
      cursor += 1;
      while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
      const quote = source[cursor];
      if (quote !== "\"" && quote !== "'") throw new Error(`blind SVG context attribute ${attributeName} must be quoted`);
      const valueStart = cursor + 1;
      const valueEnd = source.indexOf(quote, valueStart);
      if (valueEnd < 0) throw new Error(`blind SVG context attribute ${attributeName} has an unterminated value`);
      const attributeValue = source.slice(valueStart, valueEnd);
      if (attributeValue.includes("\\")) throw new Error(`blind SVG context attribute ${attributeName} contains a backslash or CSS escape`);
      if (attributeValue.includes("/*") || attributeValue.includes("*/")) throw new Error(`blind SVG context attribute ${attributeName} contains a CSS comment`);
      for (const call of attributeValue.matchAll(SVG_ATTRIBUTE_FUNCTION_CALL)) {
        const functionName = call[1]!.toLowerCase();
        if (!SVG_ALLOWED_ATTRIBUTE_FUNCTIONS.has(functionName)) {
          throw new Error(`blind SVG context attribute ${attributeName} calls a non-allowlisted function: ${functionName}`);
        }
      }
      // CSS closes an unterminated function at end-of-input ("consume a function": on EOF this is a
      // parse error, but the function is returned). So `url(https://host/x` with no closing paren is
      // a COMPLETE url() to a browser. Round 4 tried to make the target check total by requiring the
      // parentheses to balance — but balance is a COUNT over the whole value, while a style attribute
      // is a DECLARATION LIST. A stray `)` in a *different* declaration rebalances the value without
      // closing the open `url(`, and a third independent review fetched from four such channels in
      // real Chrome, e.g. `transform:translate(1px));mask-image:url(https://host/x`. The target check
      // must therefore not depend on a closing paren at all: every `url(` opening yields a target that
      // is read to its `)` OR to the end of the value, and that target must be a same-document
      // fragment. The balance rule is kept as an independent, cheap guard — measured across all 6242
      // attribute values in the v1 and v2 SVG corpora nothing legitimate is unbalanced — but no
      // guarantee hangs on it any more.
      for (const opening of attributeValue.matchAll(SVG_ATTRIBUTE_URL_OPENING)) {
        const rest = attributeValue.slice(opening.index + opening[0].length);
        const close = rest.indexOf(")");
        const target = (close < 0 ? rest : rest.slice(0, close)).trim();
        if (!SVG_SAME_DOCUMENT_FRAGMENT.test(target)) {
          throw new Error(`blind SVG context attribute ${attributeName} references a url() target that is not a same-document fragment`);
        }
      }
      const openParens = (attributeValue.match(/\(/gu) ?? []).length;
      const closeParens = (attributeValue.match(/\)/gu) ?? []).length;
      if (openParens !== closeParens) {
        throw new Error(`blind SVG context attribute ${attributeName} contains unbalanced parentheses`);
      }
      if (attributeValue.includes("&")) {
        decodeXmlCharacterReferences(attributeValue);
        throw new Error(`blind SVG context attribute ${attributeName} contains a character reference`);
      }
      cursor = valueEnd + 1;
    }
    if (cursor >= source.length && offset <= opening) throw new Error("blind SVG context contains an unterminated opening tag");
  }
}

export function sanitizeBlindSvgContextV2(svgSource: string): string {
  if (!/<svg\b/iu.test(svgSource)) throw new Error("blind SVG context root is missing");
  if (/<\?(?:xml|[A-Za-z_:])/iu.test(svgSource)) throw new Error("blind SVG context contains a processing instruction");
  if (/<!\s*(?:DOCTYPE|ENTITY|\[CDATA\[)/iu.test(svgSource)) throw new Error("blind SVG context contains a forbidden XML declaration");
  if (/<\/?(?:script|foreignObject|iframe|object|embed|animate|animateMotion|animateTransform|set|discard|style)\b/iu.test(svgSource)) throw new Error("blind SVG context contains active or independently mutable content");
  if (/\son[a-z][\w.-]*\s*=/iu.test(svgSource)) throw new Error("blind SVG context contains an event handler");
  validateSvgMarkupLexically(svgSource);
  if (/data\s*:/iu.test(svgSource)) throw new Error("blind SVG context contains a data URL");
  if (blindContextHasExternalAssetReference(svgSource)) throw new Error("blind context would require an external asset fetch");

  let sanitized = svgSource;
  const comments = sanitized.match(/<!--[\s\S]*?-->/gu) ?? [];
  const commentOpenCount = sanitized.match(/<!--/gu)?.length ?? 0;
  if (comments.length !== commentOpenCount) throw new Error("blind SVG context contains an unterminated comment");
  sanitized = sanitized.replace(/<!--[\s\S]*?-->/gu, "");
  if (sanitized.includes("-->")) throw new Error("blind SVG context contains an unmatched comment terminator");
  sanitized = sanitized.replace(/<(?:[A-Za-z][\w.-]*:)?metadata\b[^>]*>[\s\S]*?<\/(?:[A-Za-z][\w.-]*:)?metadata\s*>/giu, "");
  sanitized = sanitized.replace(/<sodipodi:namedview\b[^>]*(?:\/>|>[\s\S]*?<\/sodipodi:namedview\s*>)/giu, "");
  sanitized = sanitized.replace(/<(?:title|desc)\b[^>]*>[\s\S]*?<\/(?:title|desc)\s*>/giu, "");
  sanitized = sanitized.replace(new RegExp(`\\s+(?:xmlns:${SVG_REMOVED_NAMESPACE_PREFIXES}|${SVG_REMOVED_NAMESPACE_PREFIXES}:[\\w.-]+)\\s*=\\s*(["'])[\\s\\S]*?\\1`, "giu"), "");
  sanitized = sanitized.replace(/\s+(?:data-)?(?:editor|export(?:er|tool|version)?|generator)\s*=\s*(["'])[\s\S]*?\1/giu, "");
  sanitized = sanitized.replace(/\s+(?:aria-[\w.-]+|class|data-[\w.-]+|role)\s*=\s*(["'])[\s\S]*?\1/giu, "");
  if (/<(?:[A-Za-z][\w.-]*:)?metadata\b/iu.test(sanitized)) throw new Error("blind SVG context contains malformed metadata");
  if (/<(?:title|desc)\b/iu.test(sanitized)) throw new Error("blind SVG context contains malformed descriptive metadata");

  const elements = parsedElements(sanitized);
  for (const element of elements) {
    const elementPrefix = element.tagName.includes(":") ? element.tagName.slice(0, element.tagName.indexOf(":")) : null;
    if (elementPrefix) throw new Error(`blind SVG context contains an unknown element namespace: ${elementPrefix}`);
    for (const entry of element.attrs) {
      const qualified = qualifiedAttributeName(entry).toLowerCase();
      if (qualified === "xmlns" || qualified.startsWith("xmlns:")) {
        const expected = SVG_ALLOWED_NAMESPACE_DECLARATIONS.get(qualified);
        if (expected === undefined || entry.value !== expected) throw new Error(`blind SVG context contains an unknown namespace: ${qualified}`);
        continue;
      }
      const prefix = (entry.prefix ?? (qualified.includes(":") ? qualified.slice(0, qualified.indexOf(":")) : "")).toLowerCase();
      if (!prefix) continue;
      if (!new Set(["xlink", "xml"]).has(prefix)) throw new Error(`blind SVG context contains an unknown attribute namespace: ${prefix}`);
      if (!SVG_ALLOWED_NAMESPACED_ATTRIBUTES.has(qualified)) throw new Error(`blind SVG context contains a non-allowlisted namespaced attribute: ${qualified}`);
    }
  }

  const idMap = new Map<string, string>();
  for (const element of elements) {
    for (const entry of element.attrs) {
      if (qualifiedAttributeName(entry).toLowerCase() !== "id") continue;
      const original = entry.value;
      if (!original || idMap.has(original)) throw new Error("blind SVG context contains an empty or duplicate ID");
      idMap.set(original, `blind-id-${String(idMap.size + 1).padStart(6, "0")}`);
    }
  }
  sanitized = replaceParsedAttributes(sanitized, (name, value) => {
    if (name.toLowerCase() === "id") return idMap.get(value) ?? value;
    let rewritten = value;
    for (const [original, replacement] of idMap) {
      const exactFragment = new RegExp(`#${original.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?![A-Za-z0-9_.:-])`, "gu");
      rewritten = rewritten.replace(exactFragment, `#${replacement}`);
      if (/^(?:aria-labelledby|aria-describedby)$/iu.test(name)) rewritten = rewritten.split(/\s+/u).map((token) => token === original ? replacement : token).join(" ");
      if (/^(?:begin|end)$/iu.test(name)) rewritten = rewritten.replace(new RegExp(`(^|;)\\s*${original.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}\\.`, "gu"), `$1${replacement}.`);
    }
    if (!/^(?:d|points|transform|viewBox|xmlns(?::xlink)?|xlink:href|href)$/iu.test(name) && SVG_PRIVATE_PATH_HINT.test(rewritten)) throw new Error(`blind SVG context attribute ${name} contains a source path or filename hint`);
    return rewritten;
  });

  const decoded = decodeXmlCharacterReferences(sanitized);
  const normalized = normalizeBlindHintText(decoded);
  if (SVG_OUTCOME_HINT.test(normalized)) throw new Error("blind SVG context contains an outcome hint");
  if (SVG_TOOL_HINT.test(normalized)) throw new Error("blind SVG context contains a generator or editor hint");
  if (SVG_PRIVATE_PATH_HINT.test(normalized)) throw new Error("blind SVG context contains a source path or filename hint");
  if (/data\s*:/iu.test(normalized)) throw new Error("blind SVG context contains an encoded data URL");
  if (blindContextHasExternalAssetReference(sanitized)) throw new Error("sanitized blind context would require an external asset fetch");
  return sanitized.replace(/[\t ]+(?=\r?\n)/gu, "");
}

export function verifySanitizedBlindSvgContextV2(bytes: Buffer): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  let source: string;
  try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return { valid: false, issues: ["context-not-valid-utf8"] }; }
  try {
    const reconstructed = sanitizeBlindSvgContextV2(source);
    if (reconstructed !== source) issues.push("context-not-sanitizer-fixed-point");
  } catch (error) {
    issues.push(`context-content-invalid:${error instanceof Error ? error.message : String(error)}`);
  }
  return { valid: issues.length === 0, issues };
}

export function buildBlindContextArtifactsV2(bytes: Buffer, mediaType: "text/html" | "image/svg+xml", targets: BlindTarget[]): {
  artifacts: Array<{ path: string; bytes: Buffer; sha256: string; byteLength: number }>;
  contextsByTargetId: Record<string, BlindTargetContextV2>;
} {
  type LocatedNode = Node & { sourceCodeLocation?: { startOffset?: number; endOffset?: number } };
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const document = parse(source, { sourceCodeLocationInfo: true });
  const svgSourceByPath = new Map<string, string>();
  function walk(node: Node, path: string): void {
    const counters = new Map<string, number>();
    for (const child of childElements(node)) {
      const index = counters.get(child.tagName) ?? 0;
      counters.set(child.tagName, index + 1);
      const childPath = `${path}/${child.tagName}[${index}]`;
      if (child.tagName === "svg") {
        const location = (child as LocatedNode).sourceCodeLocation;
        if (location?.startOffset === undefined || location.endOffset === undefined) throw new Error("SVG context source offsets are unavailable");
        svgSourceByPath.set(childPath, source.slice(location.startOffset, location.endOffset));
      }
      walk(child, childPath);
    }
  }
  walk(document, "");
  const artifactByRoot = new Map<string, { path: string; bytes: Buffer; sha256: string; byteLength: number }>();
  const contextsByTargetId: Record<string, BlindTargetContextV2> = {};
  for (const target of targets) {
    const match = /^(.*?\/svg\[\d+\])/u.exec(target.structuralPath);
    const rootPath = match?.[1];
    const svgSource = rootPath ? svgSourceByPath.get(rootPath) : undefined;
    if (!rootPath || !svgSource) throw new Error(`SVG context is missing for target ${target.targetId}`);
    let artifact = artifactByRoot.get(rootPath);
    if (!artifact) {
      const contextBytes = Buffer.from(sanitizeBlindSvgContextV2(svgSource), "utf8");
      const verification = verifySanitizedBlindSvgContextV2(contextBytes);
      if (!verification.valid) throw new Error(`sanitized blind context failed independent content verification: ${verification.issues.join(",")}`);
      const contextSha256 = sha256(contextBytes);
      artifact = { path: `blind-context/context_${contextSha256.slice(0, 24)}.svg`, bytes: contextBytes, sha256: contextSha256, byteLength: contextBytes.length };
      artifactByRoot.set(rootPath, artifact);
    }
    contextsByTargetId[target.targetId] = {
      artifactPath: artifact.path,
      artifactSha256: artifact.sha256,
      byteLength: artifact.byteLength,
      mediaType: "image/svg+xml",
      targetLocator: { mode: "context-structural-path", structuralPathWithinContext: target.structuralPath.slice(rootPath.length) || "/" },
      renderingContract: {
        mode: "browser-native-isolated-svg",
        externalAssetsFetched: false,
        sourceScope: mediaType === "text/html" ? "embedded-inline-svg-only" : "exact-svg-document",
        sourceByteTreatment: "deterministic-svg-sanitization-v2",
        sanitizerContractVersion: "m3-1-svg-blind-sanitizer-v2",
        independentContentVerificationRequired: true,
        limitations: mediaType === "text/html"
          ? ["Only the sanitized embedded inline SVG is presented; the containing HTML page is not included.", "Font identity and production renderer capture are not frozen; annotation remains process-pilot evidence only."]
          : ["Font identity and production renderer capture are not frozen; annotation remains process-pilot evidence only."],
      },
    };
  }
  return { artifacts: [...artifactByRoot.values()].sort((left, right) => left.path.localeCompare(right.path, "en")), contextsByTargetId };
}

function findForbiddenBlindKey(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findForbiddenBlindKey(entry);
      if (found) return found;
    }
  } else if (value !== null && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_BLIND_KEYS.test(key)) return key;
      const found = findForbiddenBlindKey(entry);
      if (found) return found;
    }
  }
  return null;
}

export function buildBlindPacket(input: { packetId: string; orderSeed: string; targets: BlindTarget[]; contextsByTargetId: Record<string, BlindTargetContext> }): {
  contractVersion: "m3-1-blind-packet-v1";
  packetId: string;
  blinded: true;
  custodialMappingRequired: true;
  humanExecutable: true;
  executionBlocker: null;
  deliveryContract: { annotationBundleOnly: true; repositoryAccessPermitted: false; sourceManifestAccessPermitted: false; splitAccessPermitted: false };
  orderSeedSha256: string;
  targets: Array<{ blindTargetId: string; ruleId: RuleId; neutralOrder: number; context: BlindTargetContext }>;
  packetSha256: string;
} {
  if (!/^blind_packet_[A-Za-z0-9._-]{8,80}$/u.test(input.packetId)) throw new Error("invalid packet ID");
  if (input.orderSeed.length < 16) throw new Error("order seed must be nontrivial");
  const forbidden = findForbiddenBlindKey(input.targets);
  if (forbidden) throw new Error(`blind packet contains oracle-leaking field: ${forbidden}`);
  const unique = new Set<string>();
  for (const target of input.targets) {
    if (!TARGET_ID.test(target.targetId) || !DOCUMENT_ID.test(target.documentId)) throw new Error("blind packet target identity is invalid");
    requireSha256(target.artifactSha256, "artifactSha256");
    if (deriveStableTargetId(target) !== target.targetId) throw new Error("blind packet target ID does not match byte-bound source identity");
    if (unique.has(target.targetId)) throw new Error("blind packet contains duplicate target IDs");
    unique.add(target.targetId);
    const context = input.contextsByTargetId[target.targetId];
    if (!context || !SHA256.test(context.artifactSha256) || context.byteLength < 1 || !/^blind-context\/context_[a-f0-9]{24}\.svg$/u.test(context.artifactPath)) throw new Error("blind packet target context is missing or invalid");
  }
  const ordered = [...input.targets]
    .sort((left, right) => {
      const leftOrder = sha256(`${input.orderSeed}\0${left.targetId}`);
      const rightOrder = sha256(`${input.orderSeed}\0${right.targetId}`);
      return leftOrder.localeCompare(rightOrder, "en") || left.targetId.localeCompare(right.targetId, "en");
    })
    .map((target, index) => ({
      blindTargetId: `blind_target_${sha256(`${input.orderSeed}\0${target.targetId}`).slice(0, 32)}`,
      ruleId: target.ruleId,
      neutralOrder: index + 1,
      context: input.contextsByTargetId[target.targetId]!,
    }));
  const packetWithoutHash = {
    contractVersion: "m3-1-blind-packet-v1" as const,
    packetId: input.packetId,
    blinded: true as const,
    custodialMappingRequired: true as const,
    humanExecutable: true as const,
    executionBlocker: null,
    deliveryContract: { annotationBundleOnly: true as const, repositoryAccessPermitted: false as const, sourceManifestAccessPermitted: false as const, splitAccessPermitted: false as const },
    orderSeedSha256: sha256(input.orderSeed),
    targets: ordered,
  };
  const packet = { ...packetWithoutHash, packetSha256: sha256(canonicalJson(packetWithoutHash)) };
  if (!validateBlindPacketSchema(packet)) throw new Error(`blind packet schema validation failed: ${JSON.stringify(validateBlindPacketSchema.errors)}`);
  return packet;
}

export interface BlindPacketV2 {
  contractVersion: "m3-1-blind-packet-v2";
  packetId: string;
  blinded: true;
  custodialMappingRequired: true;
  humanExecutable: true;
  executionBlocker: null;
  deliveryContract: { annotationBundleOnly: true; repositoryAccessPermitted: false; sourceManifestAccessPermitted: false; splitAccessPermitted: false };
  orderContract: {
    algorithm: "sha256-seed-nul-target-id-v1";
    orderSeedSha256: string;
    orderedBlindTargetIdsSha256: string;
    independentReconstructionRequired: true;
  };
  targetCount: number;
  targetSetSha256: string;
  blindTargetSetSha256: string;
  targets: Array<{ blindTargetId: string; ruleId: RuleId; neutralOrder: number; context: BlindTargetContextV2 }>;
  packetSha256: string;
}

function blindTargetOrderDigest(orderSeed: string, targetId: string): string {
  return sha256(`${orderSeed}\0${targetId}`);
}

export function buildBlindPacketV2(input: { packetId: string; orderSeed: string; targets: BlindTarget[]; contextsByTargetId: Record<string, BlindTargetContextV2> }): BlindPacketV2 {
  if (!/^blind_packet_[A-Za-z0-9._-]{8,80}$/u.test(input.packetId)) throw new Error("invalid packet ID");
  if (SVG_OUTCOME_HINT.test(normalizeBlindHintText(input.packetId))) throw new Error("blind packet ID contains an outcome hint");
  if (input.orderSeed.length < 16) throw new Error("order seed must be nontrivial");
  const forbidden = findForbiddenBlindKey(input.targets);
  if (forbidden) throw new Error(`blind packet contains oracle-leaking field: ${forbidden}`);
  const unique = new Set<string>();
  for (const target of input.targets) {
    if (!TARGET_ID.test(target.targetId) || !DOCUMENT_ID.test(target.documentId)) throw new Error("blind packet target identity is invalid");
    requireSha256(target.artifactSha256, "artifactSha256");
    if (deriveStableTargetId(target) !== target.targetId) throw new Error("blind packet target ID does not match byte-bound source identity");
    if (unique.has(target.targetId)) throw new Error("blind packet contains duplicate target IDs");
    unique.add(target.targetId);
    const context = input.contextsByTargetId[target.targetId];
    if (!context || !SHA256.test(context.artifactSha256) || context.byteLength < 1 || !/^blind-context\/context_[a-f0-9]{24}\.svg$/u.test(context.artifactPath)) throw new Error("blind packet target context is missing or invalid");
  }
  if (unique.size === 0) throw new Error("blind packet must contain targets");
  const ordered = [...input.targets]
    .sort((left, right) => blindTargetOrderDigest(input.orderSeed, left.targetId).localeCompare(blindTargetOrderDigest(input.orderSeed, right.targetId), "en") || left.targetId.localeCompare(right.targetId, "en"))
    .map((target, index) => ({
      blindTargetId: `blind_target_${blindTargetOrderDigest(input.orderSeed, target.targetId).slice(0, 32)}`,
      ruleId: target.ruleId,
      neutralOrder: index + 1,
      context: input.contextsByTargetId[target.targetId]!,
    }));
  const orderedBlindTargetIds = ordered.map((target) => target.blindTargetId);
  const packetWithoutHash = {
    contractVersion: "m3-1-blind-packet-v2" as const,
    packetId: input.packetId,
    blinded: true as const,
    custodialMappingRequired: true as const,
    humanExecutable: true as const,
    executionBlocker: null,
    deliveryContract: { annotationBundleOnly: true as const, repositoryAccessPermitted: false as const, sourceManifestAccessPermitted: false as const, splitAccessPermitted: false as const },
    orderContract: {
      algorithm: "sha256-seed-nul-target-id-v1" as const,
      orderSeedSha256: sha256(input.orderSeed),
      orderedBlindTargetIdsSha256: sha256(canonicalJson(orderedBlindTargetIds)),
      independentReconstructionRequired: true as const,
    },
    targetCount: ordered.length,
    targetSetSha256: sha256(canonicalJson([...unique].sort())),
    blindTargetSetSha256: sha256(canonicalJson([...orderedBlindTargetIds].sort())),
    targets: ordered,
  };
  const packet: BlindPacketV2 = { ...packetWithoutHash, packetSha256: sha256(canonicalJson(packetWithoutHash)) };
  if (!validateBlindPacketV2Schema(packet)) throw new Error(`blind packet v2 schema validation failed: ${JSON.stringify(validateBlindPacketV2Schema.errors)}`);
  return packet;
}

export function verifyBlindPacketV2Public(packet: unknown, artifactsByPath: ReadonlyMap<string, Buffer>): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  if (!validateBlindPacketV2Schema(packet)) return { valid: false, issues: [`packet-schema-invalid:${JSON.stringify(validateBlindPacketV2Schema.errors)}`] };
  const typed = packet as BlindPacketV2;
  const { packetSha256, ...withoutHash } = typed;
  if (sha256(canonicalJson(withoutHash)) !== packetSha256) issues.push("packet-self-hash-mismatch");
  if (typed.targetCount !== typed.targets.length) issues.push("packet-target-count-mismatch");
  const blindIds = typed.targets.map((target) => target.blindTargetId);
  if (new Set(blindIds).size !== blindIds.length) issues.push("packet-blind-target-duplicate");
  if (typed.targets.some((target, index) => target.neutralOrder !== index + 1)) issues.push("packet-neutral-order-not-contiguous");
  if (sha256(canonicalJson(blindIds)) !== typed.orderContract.orderedBlindTargetIdsSha256) issues.push("packet-order-commitment-mismatch");
  if (sha256(canonicalJson([...blindIds].sort())) !== typed.blindTargetSetSha256) issues.push("packet-blind-target-set-mismatch");
  for (const target of typed.targets) {
    const bytes = artifactsByPath.get(target.context.artifactPath);
    if (!bytes) { issues.push(`packet-context-missing:${target.context.artifactPath}`); continue; }
    if (bytes.length !== target.context.byteLength || sha256(bytes) !== target.context.artifactSha256 || !target.context.artifactPath.endsWith(`${target.context.artifactSha256.slice(0, 24)}.svg`)) issues.push(`packet-context-binding-mismatch:${target.context.artifactPath}`);
    const content = verifySanitizedBlindSvgContextV2(bytes);
    for (const issue of content.issues) issues.push(`${issue}:${target.context.artifactPath}`);
  }
  return { valid: issues.length === 0, issues: [...new Set(issues)].sort() };
}

export function verifyBlindPacketV2Custodial(input: {
  packet: unknown;
  packetId: string;
  orderSeed: string;
  targets: BlindTarget[];
  contextsByTargetId: Record<string, BlindTargetContextV2>;
  artifactsByPath: ReadonlyMap<string, Buffer>;
}): { valid: boolean; issues: string[] } {
  const publicVerification = verifyBlindPacketV2Public(input.packet, input.artifactsByPath);
  const issues = [...publicVerification.issues];
  try {
    const expected = buildBlindPacketV2({ packetId: input.packetId, orderSeed: input.orderSeed, targets: input.targets, contextsByTargetId: input.contextsByTargetId });
    if (canonicalJson(expected) !== canonicalJson(input.packet)) issues.push("packet-custodial-reconstruction-mismatch");
  } catch (error) {
    issues.push(`packet-custodial-reconstruction-failed:${error instanceof Error ? error.message : String(error)}`);
  }
  return { valid: issues.length === 0, issues: [...new Set(issues)].sort() };
}

/**
 * The operational delivery gate is intentionally narrower than the historical packet schemas.
 * Packet v1/v2 remain immutable evidence, including their old `humanExecutable` field, but the
 * repeated source-channel failures retire both formats from new human sessions. Only a raster-only
 * v3 is the only format that may eventually cross the annotation CLI boundary. The current gate
 * still blocks it until the renderer, network-evidence verifier and visual-sufficiency oracle exist.
 */
export function validateHumanPacketDelivery(packet: unknown): { valid: boolean; issues: string[] } {
  if (!validateBlindPacketV3Schema(packet)) {
    const version = packet !== null && typeof packet === "object" && "contractVersion" in packet
      ? String((packet as { contractVersion?: unknown }).contractVersion)
      : "missing";
    if (version === "m3-1-blind-packet-v1" || version === "m3-1-blind-packet-v2") {
      return { valid: false, issues: ["legacy-svg-source-packet-not-authorized-for-human-delivery"] };
    }
    return { valid: false, issues: [`raster-packet-v3-schema-invalid:${JSON.stringify(validateBlindPacketV3Schema.errors)}`] };
  }
  const typed = packet as { packetSha256: string; targets: Array<{ neutralOrder: number; context: { artifactPath: string; artifactSha256: string; width: number; height: number; targetLocator: { x: number; y: number; width: number; height: number } } }> };
  const { packetSha256, ...withoutHash } = typed;
  const issues: string[] = [];
  if (sha256(canonicalJson(withoutHash)) !== packetSha256) issues.push("raster-packet-self-hash-mismatch");
  if (typed.targets.some((target, index) => target.neutralOrder !== index + 1)) issues.push("raster-packet-neutral-order-not-contiguous");
  for (const target of typed.targets) {
    if (!target.context.artifactPath.endsWith(`${target.context.artifactSha256.slice(0, 24)}.png`)) issues.push("raster-context-path-hash-mismatch");
    const bounds = target.context.targetLocator;
    if (bounds.x + bounds.width > target.context.width || bounds.y + bounds.height > target.context.height) issues.push("raster-target-bounds-outside-context");
  }
  issues.push("raster-v3-renderer-network-and-visual-sufficiency-gate-not-implemented");
  return { valid: issues.length === 0, issues: [...new Set(issues)].sort() };
}

export interface AnnotationSession {
  sessionId: string;
  annotatorOpaqueId: string;
  packetSha256: string;
  startedAt: string;
  completedAt: string;
  findingExposed: boolean;
}

export interface IdentityBinding {
  annotatorOpaqueId: string;
  externalSubjectFingerprint: string;
  registryReceiptSha256: string;
}

export function validateAnnotationChronology(input: {
  revealAt: string;
  sessions: AnnotationSession[];
  identityBindings: IdentityBinding[];
}): { valid: boolean; structurallyValid: boolean; realIdentityExternallyVerified: false; issues: string[] } {
  const issues: string[] = [];
  if (!ISO_DATE_TIME.test(input.revealAt)) issues.push("reveal-time-invalid");
  if (input.sessions.length !== 2) issues.push("two-annotation-sessions-required");
  const annotators = new Set(input.sessions.map((session) => session.annotatorOpaqueId));
  if (annotators.size !== input.sessions.length) issues.push("annotator-identity-duplicate");
  const packets = new Set(input.sessions.map((session) => session.packetSha256));
  if (packets.size !== 1) issues.push("annotation-packet-mismatch");
  const revealAt = Date.parse(input.revealAt);
  for (const session of input.sessions) {
    if (!ISO_DATE_TIME.test(session.startedAt) || !ISO_DATE_TIME.test(session.completedAt)) issues.push("annotation-time-invalid");
    const startedAt = Date.parse(session.startedAt);
    const completedAt = Date.parse(session.completedAt);
    if (!(startedAt <= completedAt && completedAt < revealAt)) issues.push("annotation-after-reveal");
    if (session.findingExposed) issues.push("breaklint-result-exposed");
  }
  if (input.identityBindings.length < 2) issues.push("real-identity-bindings-missing");
  else {
    const bindingByOpaqueId = new Map(input.identityBindings.map((binding) => [binding.annotatorOpaqueId, binding]));
    if ([...annotators].some((id) => !bindingByOpaqueId.has(id))) issues.push("real-identity-bindings-missing");
    const externalSubjects = new Set(input.identityBindings.map((binding) => binding.externalSubjectFingerprint));
    if (externalSubjects.size !== input.identityBindings.length) issues.push("external-real-identity-duplicate");
    for (const binding of input.identityBindings) requireSha256(binding.registryReceiptSha256, "registryReceiptSha256");
  }
  const structurallyValid = issues.length === 0;
  // M3-1 has no approved external human identity registry yet. Data fields alone never prove reality.
  if (structurallyValid) issues.push("external-human-identity-oracle-unavailable");
  return { valid: false, structurallyValid, realIdentityExternallyVerified: false, issues: [...new Set(issues)].sort() };
}

export type AnnotationLabel = "positive" | "negative" | "ambiguous" | "abstain" | "invalid_target";
export interface BlindAnnotationRecord {
  sessionId: string;
  blindTargetId: string;
  ruleId: RuleId;
  label: AnnotationLabel;
  rationale: string;
  createdAt: string;
}
export interface BlindAdjudicationRecord {
  blindTargetId: string;
  adjudicatorOpaqueId: string;
  sourceSessionIds: [string, string];
  finalLabel: AnnotationLabel;
  rationale: string;
  createdAt: string;
  blinded: true;
  breaklintResultExposed: false;
}

const ANNOTATION_LABELS: readonly AnnotationLabel[] = ["positive", "negative", "ambiguous", "abstain", "invalid_target"];
type ConfusionTable = Record<AnnotationLabel, Record<AnnotationLabel, number>>;
export interface AnnotationStatistics {
  labels: readonly AnnotationLabel[];
  confusionTable: ConfusionTable;
  exactAgreement: number;
  cohenKappa: number | null;
  krippendorffNominalAlpha: number | null;
  annotatorPrevalence: {
    annotatorA: { sessionId: string; prevalence: Record<AnnotationLabel, number> };
    annotatorB: { sessionId: string; prevalence: Record<AnnotationLabel, number> };
  };
  pooledPrevalence: Record<AnnotationLabel, number>;
  nonbinaryRates: { ambiguous: number; abstain: number; invalid_target: number; anyNonbinary: number };
  adjudication: { required: number; completed: number; rejectedInvalid: number; completionRate: number; finalLabelCounts: Record<AnnotationLabel, number> };
  originGroupCount: number;
  originGroupBootstrap:
    | { disposition: "computed"; reason: null; minimumOriginGroups: 2; confidenceLevel: 0.95; iterations: number; seedSha256: string; exactAgreement95Ci: [number, number]; cohenKappa95Ci: [number | null, number | null] }
    | { disposition: "not-computable"; reason: "insufficient-origin-groups"; minimumOriginGroups: 2; confidenceLevel: 0.95; iterations: number; seedSha256: string; exactAgreement95Ci: null; cohenKappa95Ci: null };
}

function emptyLabelCounts(): Record<AnnotationLabel, number> {
  return Object.fromEntries(ANNOTATION_LABELS.map((label) => [label, 0])) as Record<AnnotationLabel, number>;
}

function agreementMetrics(pairs: Array<[AnnotationLabel, AnnotationLabel]>): { exactAgreement: number; cohenKappa: number | null; krippendorffNominalAlpha: number | null } {
  const left = emptyLabelCounts();
  const right = emptyLabelCounts();
  const pooled = emptyLabelCounts();
  let agreements = 0;
  for (const [a, b] of pairs) {
    left[a] += 1; right[b] += 1; pooled[a] += 1; pooled[b] += 1;
    if (a === b) agreements += 1;
  }
  const n = pairs.length;
  if (n === 0) return { exactAgreement: 0, cohenKappa: null, krippendorffNominalAlpha: null };
  const observed = agreements / n;
  const expectedKappa = ANNOTATION_LABELS.reduce((sum, label) => sum + (left[label] / n) * (right[label] / n), 0);
  const cohenKappa = expectedKappa === 1 ? null : (observed - expectedKappa) / (1 - expectedKappa);
  const pooledN = n * 2;
  const expectedAgreementAlpha = pooledN < 2 ? 1 : ANNOTATION_LABELS.reduce((sum, label) => sum + pooled[label] * (pooled[label] - 1), 0) / (pooledN * (pooledN - 1));
  const expectedDisagreementAlpha = 1 - expectedAgreementAlpha;
  const krippendorffNominalAlpha = expectedDisagreementAlpha === 0 ? null : 1 - ((n - agreements) / n) / expectedDisagreementAlpha;
  return { exactAgreement: observed, cohenKappa, krippendorffNominalAlpha };
}

function percentile(values: number[], probability: number): number | null {
  if (values.length === 0) return null;
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.min(ordered.length - 1, Math.max(0, Math.floor(probability * ordered.length)));
  return ordered[index]!;
}

function bootstrapOriginGroups(input: { pairsByOrigin: Map<string, Array<[AnnotationLabel, AnnotationLabel]>>; iterations: number; seed: string }): AnnotationStatistics["originGroupBootstrap"] {
  const groups = [...input.pairsByOrigin].sort(([left], [right]) => left.localeCompare(right, "en"));
  const common = {
    minimumOriginGroups: 2 as const,
    confidenceLevel: 0.95 as const,
    iterations: input.iterations,
    seedSha256: sha256(input.seed),
  };
  if (groups.length < common.minimumOriginGroups) {
    return {
      disposition: "not-computable",
      reason: "insufficient-origin-groups",
      ...common,
      exactAgreement95Ci: null,
      cohenKappa95Ci: null,
    };
  }
  let state = Number.parseInt(sha256(input.seed).slice(0, 8), 16) || 1;
  const randomIndex = (size: number): number => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) % size;
  };
  const agreements: number[] = [];
  const kappas: number[] = [];
  for (let iteration = 0; iteration < input.iterations; iteration += 1) {
    const sample: Array<[AnnotationLabel, AnnotationLabel]> = [];
    for (let draw = 0; draw < groups.length; draw += 1) sample.push(...groups[randomIndex(groups.length)]![1]);
    const metrics = agreementMetrics(sample);
    agreements.push(metrics.exactAgreement);
    if (metrics.cohenKappa !== null) kappas.push(metrics.cohenKappa);
  }
  return {
    disposition: "computed",
    reason: null,
    ...common,
    exactAgreement95Ci: [percentile(agreements, 0.025) ?? 0, percentile(agreements, 0.975) ?? 0],
    cohenKappa95Ci: [percentile(kappas, 0.025), percentile(kappas, 0.975)],
  };
}

export function validateAnnotationWorkflow(input: {
  packet: ReturnType<typeof buildBlindPacket>;
  sessions: AnnotationSession[];
  annotations: BlindAnnotationRecord[];
  adjudications: BlindAdjudicationRecord[];
  originGroupByBlindTargetId: Record<string, string>;
  statisticsPlan: { bootstrapIterations: number; bootstrapSeed: string; confidenceLevel: 0.95 };
}): { valid: false; structurallyValid: boolean; agreement: { exactAgreement: number; agreedTargets: number; comparableTargets: number } | null; statistics: AnnotationStatistics | null; issues: string[] } {
  const issues: string[] = [];
  if (!input.packet.humanExecutable) issues.push("blind-packet-not-human-executable");
  if (input.sessions.length !== 2 || new Set(input.sessions.map((session) => session.annotatorOpaqueId)).size !== 2) issues.push("two-distinct-annotation-sessions-required");
  if (input.sessions.some((session) => session.packetSha256 !== input.packet.packetSha256 || session.findingExposed)) issues.push("annotation-session-packet-or-blinding-invalid");
  const targets = new Map(input.packet.targets.map((target) => [target.blindTargetId, target]));
  const mappedTargets = Object.keys(input.originGroupByBlindTargetId).sort();
  if (canonicalJson(mappedTargets) !== canonicalJson([...targets.keys()].sort()) || Object.values(input.originGroupByBlindTargetId).some((group) => !GROUP_ID.test(group))) issues.push("custodial-origin-mapping-incomplete-or-invalid");
  if (!Number.isSafeInteger(input.statisticsPlan.bootstrapIterations) || input.statisticsPlan.bootstrapIterations < 1000 || input.statisticsPlan.bootstrapIterations > 100000 || input.statisticsPlan.bootstrapSeed.length < 16 || input.statisticsPlan.confidenceLevel !== 0.95) issues.push("annotation-statistics-plan-invalid");
  const sessionIds = new Set(input.sessions.map((session) => session.sessionId));
  const sessionsById = new Map(input.sessions.map((session) => [session.sessionId, session]));
  for (const session of input.sessions) {
    if (!RFC3339_DATE_TIME.test(session.startedAt) || !RFC3339_DATE_TIME.test(session.completedAt) || Date.parse(session.startedAt) > Date.parse(session.completedAt)) issues.push("annotation-session-time-invalid");
  }
  const annotationsBySession = new Map<string, Map<string, BlindAnnotationRecord>>();
  for (const annotation of input.annotations) {
    if (!sessionIds.has(annotation.sessionId) || !targets.has(annotation.blindTargetId)) issues.push("annotation-target-or-session-unknown");
    if (!RFC3339_DATE_TIME.test(annotation.createdAt) || annotation.rationale.trim().length < 8) issues.push("annotation-rationale-or-time-invalid");
    if (!(ANNOTATION_LABELS as readonly string[]).includes(annotation.label)) issues.push("annotation-label-invalid");
    if (targets.get(annotation.blindTargetId)?.ruleId !== annotation.ruleId) issues.push("annotation-rule-mismatch");
    const session = sessionsById.get(annotation.sessionId);
    if (session && RFC3339_DATE_TIME.test(annotation.createdAt) && !(Date.parse(session.startedAt) <= Date.parse(annotation.createdAt) && Date.parse(annotation.createdAt) <= Date.parse(session.completedAt))) issues.push("annotation-outside-session");
    const byTarget = annotationsBySession.get(annotation.sessionId) ?? new Map<string, BlindAnnotationRecord>();
    if (byTarget.has(annotation.blindTargetId)) issues.push("annotation-target-duplicated");
    byTarget.set(annotation.blindTargetId, annotation);
    annotationsBySession.set(annotation.sessionId, byTarget);
  }
  for (const session of input.sessions) if ((annotationsBySession.get(session.sessionId)?.size ?? 0) !== targets.size) issues.push("annotation-target-coverage-incomplete");

  let agreedTargets = 0;
  let comparableTargets = 0;
  const adjudicationRequired = new Set<string>();
  if (input.sessions.length === 2) {
    const [left, right] = input.sessions;
    for (const blindTargetId of targets.keys()) {
      const leftAnnotation = annotationsBySession.get(left!.sessionId)?.get(blindTargetId);
      const rightAnnotation = annotationsBySession.get(right!.sessionId)?.get(blindTargetId);
      if (!leftAnnotation || !rightAnnotation) continue;
      comparableTargets += 1;
      if (leftAnnotation.label === rightAnnotation.label) agreedTargets += 1;
      if (leftAnnotation.label !== rightAnnotation.label || !(["positive", "negative"] as string[]).includes(leftAnnotation.label) || !(["positive", "negative"] as string[]).includes(rightAnnotation.label)) adjudicationRequired.add(blindTargetId);
    }
  }
  const adjudicationTargets = new Set<string>();
  const adjudicationTargetCounts = new Map<string, number>();
  for (const adjudication of input.adjudications) adjudicationTargetCounts.set(adjudication.blindTargetId, (adjudicationTargetCounts.get(adjudication.blindTargetId) ?? 0) + 1);
  const finalLabelCounts = emptyLabelCounts();
  const annotatorIds = new Set(input.sessions.map((session) => session.annotatorOpaqueId));
  let rejectedInvalidAdjudications = 0;
  for (const adjudication of input.adjudications) {
    let adjudicationValid = true;
    const rejectAdjudication = (issue: string): void => {
      issues.push(issue);
      adjudicationValid = false;
    };
    if (!adjudicationRequired.has(adjudication.blindTargetId)) rejectAdjudication("adjudication-without-trigger");
    if ((adjudicationTargetCounts.get(adjudication.blindTargetId) ?? 0) > 1) rejectAdjudication("adjudication-duplicated");
    if (adjudication.adjudicatorOpaqueId.trim() !== adjudication.adjudicatorOpaqueId || !OPAQUE_IDENTITY.test(adjudication.adjudicatorOpaqueId)) rejectAdjudication("adjudicator-opaque-id-invalid");
    else if (annotatorIds.has(adjudication.adjudicatorOpaqueId)) rejectAdjudication("adjudicator-not-independent");
    if (adjudication.rationale.trim().length < 8) rejectAdjudication("adjudication-rationale-invalid");
    const adjudicationTimeValid = RFC3339_DATE_TIME.test(adjudication.createdAt);
    if (!adjudicationTimeValid) rejectAdjudication("adjudication-time-invalid");
    if (!adjudication.blinded) rejectAdjudication("adjudication-blinding-invalid");
    if (adjudication.breaklintResultExposed) rejectAdjudication("adjudication-result-exposed");
    const finalLabelValid = (ANNOTATION_LABELS as readonly string[]).includes(adjudication.finalLabel);
    if (!finalLabelValid) rejectAdjudication("adjudication-label-invalid");
    const sourceSessions = adjudication.sourceSessionIds.map((id) => sessionsById.get(id));
    if (new Set(adjudication.sourceSessionIds).size !== 2 || sourceSessions.some((session) => !session)) rejectAdjudication("adjudication-session-binding-invalid");
    if (adjudicationTimeValid && sourceSessions.some((session) => session && RFC3339_DATE_TIME.test(session.completedAt) && Date.parse(adjudication.createdAt) < Date.parse(session.completedAt))) rejectAdjudication("adjudication-before-source-session-completion");
    const sourceAnnotations = adjudication.sourceSessionIds.map((id) => annotationsBySession.get(id)?.get(adjudication.blindTargetId));
    if (sourceAnnotations.some((annotation) => !annotation) || (adjudicationTimeValid && sourceAnnotations.some((annotation) => annotation && Date.parse(annotation.createdAt) > Date.parse(adjudication.createdAt)))) rejectAdjudication("adjudication-annotation-binding-invalid");
    if (!adjudicationValid) {
      rejectedInvalidAdjudications += 1;
      continue;
    }
    adjudicationTargets.add(adjudication.blindTargetId);
    if (finalLabelValid) finalLabelCounts[adjudication.finalLabel] += 1;
  }
  for (const target of adjudicationRequired) if (!adjudicationTargets.has(target)) issues.push("required-adjudication-missing");
  const agreement = comparableTargets === targets.size && targets.size > 0
    ? { exactAgreement: agreedTargets / comparableTargets, agreedTargets, comparableTargets }
    : null;
  let statistics: AnnotationStatistics | null = null;
  if (agreement !== null && !issues.includes("custodial-origin-mapping-incomplete-or-invalid") && !issues.includes("annotation-statistics-plan-invalid") && input.sessions.length === 2) {
    const [leftSession, rightSession] = [...input.sessions].sort((left, right) => left.sessionId.localeCompare(right.sessionId, "en"));
    const pairsByOrigin = new Map<string, Array<[AnnotationLabel, AnnotationLabel]>>();
    const pairs: Array<[AnnotationLabel, AnnotationLabel]> = [];
    const confusionTable = Object.fromEntries(ANNOTATION_LABELS.map((left) => [left, emptyLabelCounts()])) as ConfusionTable;
    const annotatorACounts = emptyLabelCounts();
    const annotatorBCounts = emptyLabelCounts();
    const pooled = emptyLabelCounts();
    for (const blindTargetId of [...targets.keys()].sort()) {
      const left = annotationsBySession.get(leftSession!.sessionId)!.get(blindTargetId)!.label;
      const right = annotationsBySession.get(rightSession!.sessionId)!.get(blindTargetId)!.label;
      pairs.push([left, right]); confusionTable[left][right] += 1;
      annotatorACounts[left] += 1; annotatorBCounts[right] += 1;
      pooled[left] += 1; pooled[right] += 1;
      const origin = input.originGroupByBlindTargetId[blindTargetId]!;
      const groupPairs = pairsByOrigin.get(origin) ?? [];
      groupPairs.push([left, right]); pairsByOrigin.set(origin, groupPairs);
    }
    const metrics = agreementMetrics(pairs);
    const pooledN = pairs.length * 2;
    const annotatorPrevalence = {
      annotatorA: {
        sessionId: leftSession!.sessionId,
        prevalence: Object.fromEntries(ANNOTATION_LABELS.map((label) => [label, annotatorACounts[label] / pairs.length])) as Record<AnnotationLabel, number>,
      },
      annotatorB: {
        sessionId: rightSession!.sessionId,
        prevalence: Object.fromEntries(ANNOTATION_LABELS.map((label) => [label, annotatorBCounts[label] / pairs.length])) as Record<AnnotationLabel, number>,
      },
    };
    const pooledPrevalence = Object.fromEntries(ANNOTATION_LABELS.map((label) => [label, pooled[label] / pooledN])) as Record<AnnotationLabel, number>;
    statistics = {
      labels: ANNOTATION_LABELS,
      confusionTable,
      ...metrics,
      annotatorPrevalence,
      pooledPrevalence,
      nonbinaryRates: { ambiguous: pooled.ambiguous / pooledN, abstain: pooled.abstain / pooledN, invalid_target: pooled.invalid_target / pooledN, anyNonbinary: (pooled.ambiguous + pooled.abstain + pooled.invalid_target) / pooledN },
      adjudication: { required: adjudicationRequired.size, completed: adjudicationTargets.size, rejectedInvalid: rejectedInvalidAdjudications, completionRate: adjudicationRequired.size === 0 ? 1 : adjudicationTargets.size / adjudicationRequired.size, finalLabelCounts },
      originGroupCount: pairsByOrigin.size,
      originGroupBootstrap: bootstrapOriginGroups({ pairsByOrigin, iterations: input.statisticsPlan.bootstrapIterations, seed: input.statisticsPlan.bootstrapSeed }),
    };
  }
  return { valid: false, structurallyValid: issues.length === 0, agreement, statistics, issues: [...new Set([...issues, "external-human-identity-oracle-unavailable"])].sort() };
}

export interface SplitDocument {
  documentId: string;
  split: Split;
  artifactSha256: string;
  originGroupId: string;
  duplicateGroupId?: string;
  derivationGroupId?: string;
  templateGroupId?: string;
  versionGroupId?: string;
}

export interface LeakageIssue { code: string; group: string; firstDocumentId: string; secondDocumentId: string }

export function validateStrictSplits(documents: SplitDocument[]): { valid: boolean; issues: LeakageIssue[] } {
  const issues: LeakageIssue[] = [];
  const dimensions: Array<[keyof SplitDocument, string]> = [
    ["artifactSha256", "identical-hash"],
    ["originGroupId", "origin"],
    ["duplicateGroupId", "duplicate"],
    ["derivationGroupId", "derivation"],
    ["templateGroupId", "template"],
    ["versionGroupId", "version"],
  ];
  for (const [field, label] of dimensions) {
    const seen = new Map<string, SplitDocument>();
    for (const document of [...documents].sort((left, right) => left.documentId.localeCompare(right.documentId, "en"))) {
      const value = document[field];
      if (typeof value !== "string" || value.length === 0) continue;
      const previous = seen.get(value);
      if (previous && previous.split !== document.split) {
        issues.push({ code: `split-${label}-leakage`, group: value, firstDocumentId: previous.documentId, secondDocumentId: document.documentId });
      } else if (!previous) seen.set(value, document);
    }
  }
  issues.sort((left, right) => `${left.code}:${left.group}:${left.secondDocumentId}`.localeCompare(`${right.code}:${right.group}:${right.secondDocumentId}`, "en"));
  return { valid: issues.length === 0, issues };
}

const M3_1_PUBLIC_COMMIT_ALLOWLIST = Object.freeze([
  /^\.github\/workflows\/m3-1-attest\.ya?ml$/u,
  /^\.gitignore$/u,
  /^CHANGELOG\.md$/u,
  /^docs\/status\.md$/u,
  /^corpus\/public\/m3-1-(?:pilot|annotation-packet)-v1\/[A-Za-z0-9._/-]+$/u,
  /^docs\/validation\/m3-1-[A-Za-z0-9._/-]+$/u,
  /^docs\/validation\/evidence\/m3-1-public-pilot-v1\/[A-Za-z0-9._-]+\.json$/u,
  /^schemas\/calibration\/(?:annotation-session|attestor-trust-policy|blind-packet|external-attestation-proof|holdout-freeze-receipt|identity-binding|m3-1-pilot-report|public-intake-manifest|sampling-plan)-v1\.schema\.json$/u,
  /^tests\/(?:e2e|unit)\/m3-1-[A-Za-z0-9._-]+\.test\.ts$/u,
  /^tests\/tools\/calibration\/m3-1-[A-Za-z0-9._-]+\.ts$/u,
  /^tests\/fixtures\/calibration\/m3-1\/[A-Za-z0-9._-]+\.json$/u,
]);
const SENSITIVE_STAGED_CONTENT: ReadonlyArray<[string, RegExp]> = Object.freeze([
  ["absolute-private-path", /(?:\/Users\/|\/home\/)[A-Za-z0-9._-]+\//u],
  ["email-address", /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu],
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
  ["credential-assignment", /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?[^\s"']{8,}/iu],
  ["credential-url", /https?:\/\/[^\s/:]+:[^\s/@]+@/iu],
  ["query-secret", /[?&](?:token|secret|password|api[_-]?key)=/iu],
  ["sensitive-locator", /"sourceLocator"\s*:\s*"[^"]*(?:token|secret|password|credential|session|bearer|api.?key|@)[^"]*"/iu],
]);

export function scanStagedPublicArtifacts(repositoryRoot: string): {
  valid: boolean;
  stagedPaths: string[];
  disallowedPaths: string[];
  contentFindings: Array<{ path: string; code: string }>;
} {
  const staged = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).split("\0").filter(Boolean).sort();
  const disallowedPaths = staged.filter((path) => !M3_1_PUBLIC_COMMIT_ALLOWLIST.some((pattern) => pattern.test(path)));
  const contentFindings: Array<{ path: string; code: string }> = [];
  for (const path of staged) {
    if (!/^(?:corpus\/|docs\/validation\/)/u.test(path)) continue;
    let bytes: Buffer;
    try { bytes = execFileSync("git", ["show", `:${path}`], { cwd: repositoryRoot, encoding: "buffer", maxBuffer: 12 * 1024 * 1024 }); }
    catch { contentFindings.push({ path, code: "staged-bytes-unreadable" }); continue; }
    if (bytes.length > 10 * 1024 * 1024) { contentFindings.push({ path, code: "staged-file-too-large" }); continue; }
    if (bytes.includes(0)) { contentFindings.push({ path, code: "binary-staged-content-forbidden" }); continue; }
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { contentFindings.push({ path, code: "staged-content-invalid-utf8" }); continue; }
    for (const [code, pattern] of SENSITIVE_STAGED_CONTENT) if (pattern.test(text)) contentFindings.push({ path, code });
  }
  contentFindings.sort((left, right) => `${left.path}:${left.code}`.localeCompare(`${right.path}:${right.code}`, "en"));
  return { valid: disallowedPaths.length === 0 && contentFindings.length === 0, stagedPaths: staged, disallowedPaths, contentFindings };
}

export interface FreezeDocument {
  documentId: string;
  artifactSha256: string;
  split: "holdout";
  groups: { originGroupId: string; duplicateGroupId: string; derivationGroupId: string; templateGroupId: string; versionGroupId: string };
  source: {
    sourceLocator: string;
    sourceCapturedAt: string;
    sourceCaptureMode: PublicArtifactIntakeRequest["sourceCaptureMode"];
    firstPartySourceSnapshot: PublicArtifactIntakeRequest["firstPartySourceSnapshot"] | null;
    provenanceClass: ProvenanceClass;
    provenanceEvidenceSha256: string;
    rightsBasis: RightsBasis;
    rightsEvidenceSha256: string;
    privacyClass: PrivacyClass;
    privacyEvidenceSha256: string;
    founderAuthorizationSha256: string | null;
  };
  targets: Array<{ targetId: string; ruleId: RuleId }>;
}

export interface FreezeProjectionInput {
  contractVersion: "m3-1-freeze-projection-v1";
  holdoutId: string;
  purpose: "holdout-evaluation-preregistration";
  createdAt: string;
  frozenAt: string;
  sequence: number;
  previousFreezeSha256: string | null;
  blindPacketSha256: string;
  blindPacketBundle: { bundleId: string; bundleIndexSha256: string; indexedFileCount: number };
  samplingPlanSha256: string;
  analysisPlanSha256: string;
  guidelineSha256ByRule: Record<RuleId, string>;
  renderer: { status: "blocked-missing-renderer-asset-freeze"; rendererFreezeSha256: null; assetManifestSha256: null };
  documents: FreezeDocument[];
}

export function buildFreezeProjection(input: FreezeProjectionInput): { projection: Omit<FreezeProjectionInput, "documents"> & { documents: FreezeDocument[] }; freezeSha256: string } {
  if (!ISO_DATE_TIME.test(input.createdAt) || !ISO_DATE_TIME.test(input.frozenAt) || Date.parse(input.createdAt) > Date.parse(input.frozenAt)) throw new Error("freeze timestamps are invalid");
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) throw new Error("freeze sequence is invalid");
  if (input.sequence === 1 && input.previousFreezeSha256 !== null) throw new Error("initial freeze must not claim a predecessor");
  if (input.sequence > 1 && (input.previousFreezeSha256 === null || !SHA256.test(input.previousFreezeSha256))) throw new Error("replacement freeze must bind its predecessor");
  for (const digest of [input.blindPacketSha256, input.blindPacketBundle.bundleIndexSha256, input.samplingPlanSha256, input.analysisPlanSha256, ...Object.values(input.guidelineSha256ByRule)]) requireSha256(digest, "freeze-bound digest");
  if (!/^blind_bundle_[A-Za-z0-9._-]{8,80}$/u.test(input.blindPacketBundle.bundleId) || !Number.isSafeInteger(input.blindPacketBundle.indexedFileCount) || input.blindPacketBundle.indexedFileCount < 2) throw new Error("freeze blind packet bundle binding is invalid");
  if (Object.keys(input.guidelineSha256ByRule).sort().join("\0") !== [...RULE_IDS].sort().join("\0")) throw new Error("freeze must bind one guideline hash for every pilot rule");
  if (input.renderer.status !== "blocked-missing-renderer-asset-freeze" || input.renderer.rendererFreezeSha256 !== null || input.renderer.assetManifestSha256 !== null) throw new Error("unverified renderer material cannot enter the M3-1 freeze");
  const documents = input.documents
    .map((document) => ({
      ...document,
      groups: { ...document.groups },
      source: { ...document.source },
      targets: [...document.targets].sort((left, right) => left.targetId.localeCompare(right.targetId, "en")),
    }))
    .sort((left, right) => left.documentId.localeCompare(right.documentId, "en"));
  for (const document of documents) {
    if (document.split !== "holdout") throw new Error("freeze contains a non-holdout document");
    requireSha256(document.artifactSha256, "freeze artifactSha256");
    validateOpaqueLocator(document.source.sourceLocator);
    if (!RFC3339_DATE_TIME.test(document.source.sourceCapturedAt)) throw new Error("freeze source capture time is invalid");
    for (const digest of [document.source.provenanceEvidenceSha256, document.source.rightsEvidenceSha256, document.source.privacyEvidenceSha256]) requireSha256(digest, "freeze source evidence digest");
    for (const target of document.targets) if (!TARGET_ID.test(target.targetId) || !RULE_IDS.includes(target.ruleId)) throw new Error("freeze target identity is invalid");
  }
  const projection = { ...input, documents };
  return { projection, freezeSha256: sha256(canonicalJson(projection)) };
}

export const PINNED_M3_1_TRUST_POLICY_SHA256 = sha256(canonicalJson(PINNED_M3_1_TRUST_POLICY));

interface WorkflowIdentity {
  issuer: string;
  subject: string;
  repository: string;
  workflowPath: string;
  workflowRef: string;
  commitSha: string;
  runId: string;
  runAttempt: number;
}

interface TransparencyCheckpoint {
  logId: string;
  entryId: string;
  integratedAt: string;
  checkpointSha256: string;
  inclusionProofSha256: string;
}

export interface ExternalFreezeReceipt {
  contractVersion: "m3-1-holdout-freeze-receipt-v1";
  receiptId: string;
  purpose: "holdout-freeze";
  issuedAt: string;
  frozenAt: string;
  serialNumber: string;
  sequence: number;
  previousReceiptSha256: string | null;
  previousCheckpointSha256: string | null;
  subject: { subjectId: string; subjectSha256: string; subjectContractVersion: string; subjectMediaType: "application/json" };
  workflowIdentity: WorkflowIdentity;
  trustPolicyId: string;
  trustPolicySha256: string;
  externalAttestationProofId: string;
  externalAttestationProofSha256: string;
  transparencyCheckpoint: TransparencyCheckpoint;
  externalVerificationRequired: true;
  holdoutFreezeExternalValid: boolean;
  evidenceTrust: "untrusted" | "externally-verified";
}

export interface ExternalAttestationProof {
  contractVersion: "m3-1-external-attestation-proof-v1";
  proofId: string;
  proofType: "github-oidc-transparency-attestation";
  purpose: "holdout-freeze" | "capture-attestation" | "annotation-identity-separation";
  issuedAt: string;
  serialNumber: string;
  sequence: number;
  previousProofSha256: string | null;
  previousCheckpointSha256: string | null;
  subject: { subjectId: string; subjectSha256: string; subjectContractVersion: string; subjectPurpose: string; subjectMediaType: "application/json" };
  workflowIdentity: WorkflowIdentity & { oidcAudience: string };
  trustPolicyId: string;
  trustPolicySha256: string;
  verificationMaterial: { bundleSha256: string; certificateSha256: string; signatureSha256: string; publicKeyFingerprintSha256: string };
  transparencyCheckpoint: TransparencyCheckpoint;
  signatureCryptographicallyVerified: boolean;
  subjectBindingVerified: boolean;
  workflowIdentityVerified: boolean;
  trustPolicyMatched: boolean;
  lifecycleValid: boolean;
  replayCheckPassed: boolean;
  rollbackCheckPassed: boolean;
  externalVerificationRequired: true;
  evidenceTrust: "untrusted" | "externally-verified";
}

const trustAjv = new Ajv2020({ allErrors: true, strict: true, formats: { "date-time": ISO_DATE_TIME } });
const validateFreezeReceiptSchema = trustAjv.compile(JSON.parse(readFileSync(new URL("../../../schemas/calibration/holdout-freeze-receipt-v1.schema.json", import.meta.url), "utf8")) as object);
const validateAttestationProofSchema = trustAjv.compile(JSON.parse(readFileSync(new URL("../../../schemas/calibration/external-attestation-proof-v1.schema.json", import.meta.url), "utf8")) as object);

function hasProducerTrustMaterial(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasProducerTrustMaterial);
  if (value !== null && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).some(([key, entry]) => PRODUCER_TRUST_KEYS.test(key) || hasProducerTrustMaterial(entry));
  }
  return false;
}

function parseGithubVerificationOutput(output: string, expectedSubjectSha256: string): string[] {
  const issues: string[] = [];
  let entries: unknown;
  try { entries = JSON.parse(output); } catch { return ["github-attestation-output-invalid-json"]; }
  if (!Array.isArray(entries) || entries.length === 0) return ["github-attestation-empty"];
  const valid = entries.some((entry) => {
    if (entry === null || typeof entry !== "object") return false;
    const result = (entry as { verificationResult?: unknown }).verificationResult;
    if (result === null || typeof result !== "object") return false;
    const timestamps = (result as { verifiedTimestamps?: unknown }).verifiedTimestamps;
    const statement = (result as { statement?: unknown }).statement;
    if (!Array.isArray(timestamps) || timestamps.length === 0 || statement === null || typeof statement !== "object") return false;
    const subjects = (statement as { subject?: unknown }).subject;
    return Array.isArray(subjects) && subjects.some((subject) => {
      if (subject === null || typeof subject !== "object") return false;
      const digest = (subject as { digest?: unknown }).digest;
      return digest !== null && typeof digest === "object" && (digest as { sha256?: unknown }).sha256 === expectedSubjectSha256;
    });
  });
  if (!valid) issues.push("verified-transparency-timestamp-or-subject-missing");
  return issues;
}

export function verifyExternalTrust(input: {
  subjectPath: string;
  expectedSubjectSha256: string;
  receiptBytes: Buffer;
  proofBytes: Buffer;
  bundlePath?: string;
  previousAccepted: { receiptSha256: string; proofSha256: string; sequence: number; checkpointSha256: string; integratedAt: string } | null;
  evaluationStartedAt: string;
}, processBoundary: {
  runGithubAttestationVerification: (args: string[]) => string;
} = {
  runGithubAttestationVerification: (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
}): { trusted: false; cryptographicallyVerified: boolean; policySha256: string; issues: string[] } {
  const issues: string[] = [
    "external-trust-policy-not-independently-anchored",
    "verified-bundle-timestamp-independent-derivation-missing",
    "independent-replay-state-missing",
    "independent-rollback-state-missing",
  ];
  let cryptographicallyVerified = false;
  const previousAcceptedPresent = Object.prototype.hasOwnProperty.call(input, "previousAccepted");
  const evaluationStartedAtPresent = Object.prototype.hasOwnProperty.call(input, "evaluationStartedAt");
  if (!previousAcceptedPresent) issues.push("previous-accepted-baseline-omitted");
  if (!evaluationStartedAtPresent || !RFC3339_DATE_TIME.test(input.evaluationStartedAt)) issues.push("evaluation-started-at-required");
  let receipt: ExternalFreezeReceipt | null = null;
  let proof: ExternalAttestationProof | null = null;
  try { receipt = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input.receiptBytes)) as ExternalFreezeReceipt; } catch { issues.push("freeze-receipt-invalid-json"); }
  try { proof = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(input.proofBytes)) as ExternalAttestationProof; } catch { issues.push("attestation-proof-invalid-json"); }
  if (receipt !== null && hasProducerTrustMaterial(receipt)) issues.push("producer-supplied-trust-material");
  if (proof !== null && hasProducerTrustMaterial(proof)) issues.push("producer-supplied-trust-material");
  if (receipt !== null && !validateFreezeReceiptSchema(receipt)) issues.push("freeze-receipt-schema-invalid");
  if (proof !== null && !validateAttestationProofSchema(proof)) issues.push("attestation-proof-schema-invalid");
  if (receipt === null || proof === null || issues.includes("freeze-receipt-schema-invalid") || issues.includes("attestation-proof-schema-invalid")) {
    return { trusted: false, cryptographicallyVerified, policySha256: PINNED_M3_1_TRUST_POLICY_SHA256, issues: [...new Set(issues)].sort() };
  }

  if (!SHA256.test(input.expectedSubjectSha256) || receipt.subject.subjectSha256 !== input.expectedSubjectSha256 || proof.subject.subjectSha256 !== input.expectedSubjectSha256) issues.push("receipt-subject-mismatch");
  if (receipt.subject.subjectId !== proof.subject.subjectId || receipt.subject.subjectContractVersion !== proof.subject.subjectContractVersion || receipt.subject.subjectMediaType !== proof.subject.subjectMediaType || proof.subject.subjectPurpose !== receipt.purpose) issues.push("proof-subject-substitution");
  if (receipt.externalAttestationProofId !== proof.proofId || receipt.externalAttestationProofSha256 !== sha256(input.proofBytes)) issues.push("proof-artifact-substitution");
  if (receipt.trustPolicyId !== PINNED_M3_1_TRUST_POLICY.policyId || proof.trustPolicyId !== PINNED_M3_1_TRUST_POLICY.policyId || receipt.trustPolicySha256 !== PINNED_M3_1_TRUST_POLICY_SHA256 || proof.trustPolicySha256 !== PINNED_M3_1_TRUST_POLICY_SHA256) issues.push("unknown-trust-policy");
  if (!(PINNED_M3_1_TRUST_POLICY.purpose as readonly string[]).includes(receipt.purpose) || proof.purpose !== receipt.purpose) issues.push("purpose-not-allowed");
  if (receipt.sequence !== proof.sequence || receipt.serialNumber !== proof.serialNumber || receipt.sequence < PINNED_M3_1_TRUST_POLICY.minimumReceiptSequence) issues.push("receipt-sequence-invalid");
  if (receipt.sequence === 1 && (!previousAcceptedPresent || input.previousAccepted !== null)) issues.push("initial-receipt-baseline-must-be-explicit-null");
  if (receipt.sequence > 1 && (!previousAcceptedPresent || input.previousAccepted === null)) issues.push("previous-accepted-baseline-required");
  if (receipt.evidenceTrust !== "externally-verified" || receipt.holdoutFreezeExternalValid !== true) issues.push("freeze-receipt-not-externally-verified");
  // Proof key/certificate fingerprints are bound evidence metadata, never trust anchors.
  // Root and certificate-chain trust come only from gh's built-in GitHub/Sigstore verifier.
  const proofFlags = [proof.signatureCryptographicallyVerified, proof.subjectBindingVerified, proof.workflowIdentityVerified, proof.trustPolicyMatched, proof.lifecycleValid, proof.replayCheckPassed, proof.rollbackCheckPassed];
  if (proof.evidenceTrust !== "externally-verified" || !proofFlags.every(Boolean)) issues.push("attestation-proof-not-externally-verified");

  const receiptIdentity = receipt.workflowIdentity;
  const proofIdentity = proof.workflowIdentity;
  const identityShared = ["issuer", "subject", "repository", "workflowPath", "workflowRef", "commitSha", "runId", "runAttempt"] as const;
  if (identityShared.some((field) => receiptIdentity[field] !== proofIdentity[field])
    || proofIdentity.issuer !== PINNED_M3_1_WORKFLOW_IDENTITY.issuer
    || proofIdentity.subject !== PINNED_M3_1_WORKFLOW_IDENTITY.subject
    || proofIdentity.repository !== PINNED_M3_1_WORKFLOW_IDENTITY.repository
    || proofIdentity.workflowPath !== PINNED_M3_1_WORKFLOW_IDENTITY.workflowPath
    || proofIdentity.workflowRef !== PINNED_M3_1_WORKFLOW_IDENTITY.workflowRef
    || proofIdentity.oidcAudience !== PINNED_M3_1_WORKFLOW_IDENTITY.oidcAudience
    || !COMMIT.test(proofIdentity.commitSha)) issues.push("attestor-identity-substitution");
  if (receiptIdentity.commitSha !== proofIdentity.commitSha) issues.push("source-digest-substitution");
  if ((PINNED_M3_1_TRUST_POLICY.revocations as readonly { identityId: string }[]).some((revocation) => revocation.identityId === PINNED_M3_1_WORKFLOW_IDENTITY.identityId)) issues.push("revoked-attestor-identity");
  if (Date.parse(receipt.issuedAt) < Date.parse(PINNED_M3_1_TRUST_POLICY.effectiveFrom) || Date.parse(receipt.issuedAt) > Date.parse(PINNED_M3_1_TRUST_POLICY.expiresAt) || Date.parse(receipt.issuedAt) < Date.parse(PINNED_M3_1_WORKFLOW_IDENTITY.notBefore) || Date.parse(receipt.issuedAt) > Date.parse(PINNED_M3_1_WORKFLOW_IDENTITY.notAfter)) issues.push("attestor-policy-lifecycle-invalid");

  const checkpointsEqual = canonicalJson(receipt.transparencyCheckpoint) === canonicalJson(proof.transparencyCheckpoint);
  if (!checkpointsEqual) issues.push("transparency-checkpoint-substitution");
  if (Date.parse(receipt.frozenAt) > Date.parse(receipt.issuedAt) || Date.parse(receipt.issuedAt) > Date.parse(receipt.transparencyCheckpoint.integratedAt)) issues.push("receipt-time-invalid");
  if (evaluationStartedAtPresent && RFC3339_DATE_TIME.test(input.evaluationStartedAt) && Date.parse(receipt.transparencyCheckpoint.integratedAt) >= Date.parse(input.evaluationStartedAt)) issues.push("freeze-receipt-not-before-evaluation");
  if (input.previousAccepted !== null && input.previousAccepted !== undefined) {
    if (receipt.previousReceiptSha256 !== input.previousAccepted.receiptSha256 || proof.previousProofSha256 !== input.previousAccepted.proofSha256) issues.push("receipt-chain-rollback-or-substitution");
    if (receipt.previousCheckpointSha256 !== input.previousAccepted.checkpointSha256 || proof.previousCheckpointSha256 !== input.previousAccepted.checkpointSha256) issues.push("checkpoint-rollback");
    if (receipt.sequence <= input.previousAccepted.sequence || proof.sequence <= input.previousAccepted.sequence || sha256(input.receiptBytes) === input.previousAccepted.receiptSha256 || sha256(input.proofBytes) === input.previousAccepted.proofSha256) issues.push("receipt-replay-or-sequence-rollback");
    if (Date.parse(receipt.transparencyCheckpoint.integratedAt) <= Date.parse(input.previousAccepted.integratedAt)) issues.push("checkpoint-rollback");
  }
  if (!existsSync(input.subjectPath)) issues.push("subject-bytes-missing");
  else if (sha256(readFileSync(input.subjectPath)) !== input.expectedSubjectSha256) issues.push("subject-bytes-hash-mismatch");
  if (!input.bundlePath || !existsSync(input.bundlePath)) issues.push("external-attestation-bundle-missing");
  else if (sha256(readFileSync(input.bundlePath)) !== proof.verificationMaterial.bundleSha256) issues.push("external-attestation-bundle-hash-mismatch");

  const independentlyUnavailableIssues = new Set([
    "external-trust-policy-not-independently-anchored",
    "verified-bundle-timestamp-independent-derivation-missing",
    "independent-replay-state-missing",
    "independent-rollback-state-missing",
    // These are producer wrapper assertions. They neither establish nor prevent
    // the separate measurement of the bundle's GitHub/Sigstore cryptography.
    "freeze-receipt-not-externally-verified",
    "attestation-proof-not-externally-verified",
  ]);
  const cryptographicBlockers = issues.filter((issue) => !independentlyUnavailableIssues.has(issue));
  if (cryptographicBlockers.length === 0 && input.bundlePath) {
    const args = [
      "attestation", "verify", input.subjectPath,
      "--repo", PINNED_M3_1_WORKFLOW_IDENTITY.repository,
      "--signer-workflow", PINNED_M3_1_WORKFLOW_IDENTITY.workflowRef.split("@")[0]!,
      "--source-ref", PINNED_M3_1_WORKFLOW_IDENTITY.sourceRef,
      "--cert-oidc-issuer", PINNED_M3_1_WORKFLOW_IDENTITY.issuer,
      "--deny-self-hosted-runners",
      "--bundle", input.bundlePath,
      "--signer-digest", proofIdentity.commitSha,
      "--format", "json",
    ];
    args.push("--source-digest", proofIdentity.commitSha);
    try {
      const output = processBoundary.runGithubAttestationVerification(args);
      const cryptographicIssues = parseGithubVerificationOutput(output, input.expectedSubjectSha256);
      issues.push(...cryptographicIssues);
      cryptographicallyVerified = cryptographicIssues.length === 0;
    } catch {
      issues.push("github-attestation-cryptographic-verification-failed");
    }
  }
  return { trusted: false, cryptographicallyVerified, policySha256: PINNED_M3_1_TRUST_POLICY_SHA256, issues: [...new Set(issues)].sort() };
}

export interface PilotReportInput {
  pilotId: string;
  createdAt: string;
  manifestReference: { artifactId: string; artifactSha256: string; artifactContractVersion: "m3-1-public-intake-manifest-v1" | "m3-0-corpus-contract-v1" };
  samplingPlanId: string;
  samplingPlanSha256: string;
  artifactCount: number;
  realDocumentCount: number;
  originGroupCount: number;
  sourceGateValid: boolean;
  annotationGateValid: boolean;
  splitGateValid: boolean;
  externalFreezeValid: boolean;
  externalTrustValid: boolean;
  captureEvidenceValid: boolean;
}

export function buildPilotReport(input: PilotReportInput): {
  contractVersion: "m3-1-pilot-report-v1";
  reportId: string;
  createdAt: string;
  purpose: "public-corpus-process-feasibility";
  executionStatus: "infrastructure-complete-external-execution-blocked" | "pilot-complete-untrusted" | "pilot-complete-externally-attested";
  manifestReference: PilotReportInput["manifestReference"];
  samplingPlanId: string;
  samplingPlanSha256: string;
  annotationSessions: [];
  identityBindings: [];
  holdoutFreezeReceipt: null;
  externalAttestationProof: null;
  trustPolicy: null;
  documentCount: number;
  originGroupCount: number;
  annotatorCount: 0;
  adjudicatorCount: 0;
  claims: { realHumanAnnotationVerified: false; identitySeparationVerified: false; holdoutFreezeExternalValid: false; captureAttestorTrustValid: false; ruleReadyForCalibration: false; ruleReadyForCalibratedClaim: false; calibrated: false };
  evidenceTrust: "untrusted";
  limitations: string[];
} {
  if (!ISO_DATE_TIME.test(input.createdAt)) throw new Error("pilot report timestamp is invalid");
  requireSha256(input.manifestReference.artifactSha256, "manifestReference.artifactSha256");
  requireSha256(input.samplingPlanSha256, "samplingPlanSha256");
  const limitations = [
    ...(input.realDocumentCount > 0 ? [] : ["No rights-reviewed real document evidence is present."]),
    ...(input.annotationGateValid ? [] : ["Two externally identity-bound human blind annotations are not present."]),
    ...(input.splitGateValid ? [] : ["Origin-strict split validation did not pass."]),
    ...(input.externalFreezeValid ? [] : ["No externally verified holdout freeze receipt is present."]),
    ...(input.externalTrustValid ? [] : ["No externally governed attestor trust root has been verified."]),
    ...(input.captureEvidenceValid ? [] : ["No externally trusted capture evidence is present."]),
  ];
  const allProcessGates = input.realDocumentCount > 0
    && input.sourceGateValid
    && input.annotationGateValid
    && input.splitGateValid
    && input.externalFreezeValid
    && input.externalTrustValid
    && input.captureEvidenceValid;
  // This additive builder only produces untrusted or blocked infrastructure reports. A positive
  // externally-attested report must be assembled from verified schema artifacts, never booleans.
  const executionStatus = allProcessGates ? "pilot-complete-untrusted" : "infrastructure-complete-external-execution-blocked";
  return {
    contractVersion: "m3-1-pilot-report-v1" as const,
    reportId: `pilot_report_${input.pilotId}`,
    createdAt: input.createdAt,
    purpose: "public-corpus-process-feasibility" as const,
    executionStatus,
    manifestReference: input.manifestReference,
    samplingPlanId: input.samplingPlanId,
    samplingPlanSha256: input.samplingPlanSha256,
    annotationSessions: [],
    identityBindings: [],
    holdoutFreezeReceipt: null,
    externalAttestationProof: null,
    trustPolicy: null,
    documentCount: input.artifactCount,
    originGroupCount: input.originGroupCount,
    annotatorCount: 0,
    adjudicatorCount: 0,
    claims: {
      realHumanAnnotationVerified: false,
      identitySeparationVerified: false,
      holdoutFreezeExternalValid: false,
      captureAttestorTrustValid: false,
      ruleReadyForCalibration: false,
      ruleReadyForCalibratedClaim: false,
      calibrated: false,
    },
    evidenceTrust: "untrusted" as const,
    limitations: limitations.length > 0 ? limitations : ["This process-only report authorizes no calibration or calibrated claim."],
  };
}
