/**
 * The data model. Two shapes matter and they are deliberately separate:
 *
 *   Snapshot — everything measured from one paginated document, serialisable, no DOM.
 *   Report   — everything said about one run, serialisable, no Snapshot.
 *
 * The snapshot is the seam. Rules are pure functions over it, which is why the bulk of the
 * test suite runs in milliseconds and needs no browser: a snapshot can be checked in as a
 * fixture, and reproducing a defect then needs no environment at all.
 */

import type {
  BreakCauseCascadeHint,
  BreakCauseDeterminedBy,
  BreakCauseKind,
  EnvId,
  EvidenceOrigin,
  FailOn,
  InfraEventKind,
  KeyType,
  NetworkMode,
  NotMeasuredScope,
  ProofSource,
  Rasterizer,
  ReportMode,
  ReportSource,
  RunVerdict,
  Severity,
} from "./enums.ts";
import type { ConfigSource, EffectiveConfig, ProfileName } from "../config/contract.ts";

/** CSS pixels, rounded to 0.01, in the screen coordinate system of the measuring instance. */
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Where a node came from in the source. Absent means absent — never guessed. A node produced
 * by the paginator (a margin box, a continuation wrapper) has no source, and saying so is the
 * whole point of the field.
 */
export interface SourceRef {
  file: string;
  line: number;
  column: number;
  offset: number;
  endLine: number;
  endColumn: number;
  endOffset: number;
  coordinateSystem: "utf8-bytes-unicode-codepoints-v1";
}

/**
 * Why a page boundary is where it is.
 *
 * `kind` and `determinedBy` are normative. `cascadeHint` is explicitly not: it comes from
 * reading the browser cascade, and the paginator resolves CSS with its own parser that
 * diverges from the browser in both directions. A hint may stand next to a decision. It may
 * never suppress a rule or change a severity.
 */
export interface BreakCause {
  kind: BreakCauseKind;
  determinedBy: BreakCauseDeterminedBy;
  cascadeHint: BreakCauseCascadeHint | null;
}

/** The style properties a rule may read. Resolved after pagination unless noted otherwise. */
export interface EffectiveStyle {
  breakInside: string;
  breakBefore: string;
  breakAfter: string;
  columns: string;
  writingMode: string;
  visibility: string;
  widows: number;
  orphans: number;
  textAlign: string;
  wordSpacing: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  lang: string;
}

export interface WordBox extends Box {
  text: string;
}

export interface TextLine {
  blockKey: string;
  index: number;
  box: Box;
  visible: boolean;
  width: number;
  /** Always populated for justified blocks; measured at 4 221 bytes per page, so affordable. */
  wordBoxes: WordBox[] | null;
}

export interface TextRun {
  blockKey: string;
  text: string;
  nodeType: string;
  ancestorTags: string[];
  lang: string;
  excluded: boolean;
  excludeReason?: string;
}

export interface BlockRecord {
  nodeKey: string;
  sid: string | null;
  /**
   * The author's `id` on the SOURCE block, read from the source map — never from the paginated
   * DOM. Measured: the attribute does not survive the split (27 fragments, 24 ids), so reading
   * it after pagination loses exactly the continuation fragments the page rules care about.
   */
  authorId: string | null;
  /** Normalised text of the WHOLE source block, not of the fragment. A fragment is layout. */
  blockSignature: string;
  fragmentIndex: number;
  fragmentCount: number;
  page: number;
  box: Box;
  tag: string;
  classList: string[];
  lineHeight: number;
  spaceWidth: number;
  effectiveStyle: EffectiveStyle;
  /** Either populated, or `notMeasuredReason` says why not. Never silently empty. */
  lines: number[] | null;
  notMeasuredReason?: EnvId;
  /** Set when the source carried a forcing declaration the paginator did not act on. */
  inertBreak?: { side: "before" | "after"; cascadeHint: BreakCauseCascadeHint } | null;
}

export interface PageFill {
  /** Where the content sits. Measures position, not amount — kept because position matters. */
  vertical: number;
  topGap: number;
  /** Sum of semantic band heights over content height. The threshold quantity. */
  net: number;
  /** Diagnostic only: the naive area union reads 1.000 on every single page, even a bare one. */
  area: number;
}

export interface PageRecord {
  /** Actual outer page rectangle in CSS screen coordinates, absent on legacy snapshots. */
  pageBox?: Box;
  pageNumber: number;
  nodeKey: string;
  epoch: number;
  blank: boolean;
  isLast: boolean;
  contentBox: Box;
  marginBoxes: Box[];
  incomingBreakCause: BreakCause;
  outgoingBreakCause: BreakCause;
  fill: PageFill;
  /** Fingerprint anchor for page findings: the page's first semantic block. */
  firstSemanticBlockKey: string | null;
  notMeasured: NotMeasured[];
}

/** Ink count plus a hash of the mask, never the raster itself. Images belong in `evidence/`. */
export interface InkPass {
  count: number;
  maskHash: string;
}

export interface SvgTextTarget {
  /** `btNNN`, run-local addressing for the isolation pass. NEVER part of a fingerprint. */
  targetKey: string;
  /** Source identity of the `<text>`. Stable across runs; this is the fingerprint key. */
  svgTextKey: string;
  /** Run-local injected address into source.map; never a fingerprint identity. */
  sourceAddressKey?: string | null;
  boxScreen: Box;
  clipState: "none" | "clip-path" | "mask" | "both";
  /**
   * How many targets in this SVG share this exact `svgTextKey`.
   *
   * Identity is content-derived where a `<text>` has no `id`, so two identical labels — the
   * repeated axis tick "0" of a generated chart — are one identity. Which of two identical
   * objects is meant is not a well-formed question; the answer is to key them together and let
   * the finding say the group is larger than one, the same treatment `svgRootKey` gives two
   * structurally identical SVGs.
   */
  ambiguityGroupSize: number;
  /**
   * Target quantities. `T` is this target's own glyph ink, `T0` the same with clipping
   * neutralised. The two bands hang off `T` because they are properties of THIS target: `S`
   * and `F` are shared per SVG, `T` is not, and under a shared mask a genuine 0.627 collapses
   * to 0.0435. A band on a dilutable quantity is not a band.
   */
  ink: {
    T: InkPass & {
      /** |T intersect S| — glyph ink sharing a device pixel with shape ink. */
      intersectShapes?: number;
      /** |T and not F| — glyph ink absent from the full run, i.e. covered by something opaque. */
      missingInFull?: number;
    };
    T0: InkPass;
  };
}

export interface SvgShape {
  boxScreen: Box;
  strokeWidth: number;
}

export interface SvgRecord {
  nodeKey: string;
  /**
   * The page this SVG was laid out on, 1-based.
   *
   * Carried on the record because it is a fact of the MEASUREMENT. Three rules used to derive it
   * instead — one by looking the SVG's nodeKey up among the BLOCK keys, which never match
   * (`svg:0:1` against `bl:…`), the other two by writing `page: 1` outright. Every finding of the
   * one gating SVG rule therefore claimed page 1, on a fixture that produces findings on pages 2
   * and 3. A page number is the first thing a reader uses to go and look, and it was wrong in
   * every case.
   */
  page: number;
  sourceKey: string | null;
  measurable: boolean;
  /**
   * null when the SVG as a whole was measurable. The collector always sets one or the other, so
   * the key survives a JSON round trip and the receipt schema can keep it required. It stays
   * OPTIONAL in the type because the snapshot validator's negative control removes it, to prove
   * that an unmeasurable SVG without a reason is rejected.
   */
  reason?: EnvId | null;
  viewportScreen: Box;
  /** Overflow on the SVG element itself; `visible` means the text is shown after all. */
  overflow: string;
  textTargetCount: number;
  textTargetsCapped: boolean;
  /**
   * Targets the browser laid out and this tool could not measure — a `<text>` with client rects
   * but no CTM. A real measurement failure: it counts against coverage.
   */
  unreadableTargets: number;
  /**
   * Laid-out text whose painted bounds cannot be proven by the geometry collector. This covers
   * instantiated `<use>` text and paint effects that `getBBox()` explicitly omits (stroke,
   * clipping, masking, filters and paint servers). These remain candidates and therefore make an
   * error rule fail closed through coverage instead of becoming a clean result or false finding.
   */
  unsupportedTargets: number;
  /**
   * Targets the browser never laid out: `<text>` inside `<defs>`, `<symbol>`, `<clipPath>` or
   * `<pattern>`, or under `display:none`. Not drawn, therefore not a target of any rule about
   * what the viewport clips — no candidate, no decline. The distinction is measured through
   * `getBoundingClientRect`, not assumed from the markup.
   */
  notRenderedTargets: number;
  texts: SvgTextTarget[];
  shapes: SvgShape[];
  paths: SvgShape[];
  /** SVG quantities: empty ground, shapes only, full run. */
  inkPasses: { E: InkPass; S: InkPass; F: InkPass };
  /**
   * Whether the ink passes were run at all. False and `inkStable: false` are not the same
   * statement: one says the passes do not exist in this build, the other says they were made and
   * disagreed with each other. A rule that cannot tell them apart reports the wrong reason, and
   * this build reports the first — the pixel oracle is M3 work and is not implemented.
   */
  inkCollected: boolean;
  inkStable: boolean;
}

export interface UriRef {
  nodeKey: string;
  attribute: string;
  rawValue: string;
  resolvedUri: string;
  scheme: string;
  origin: string;
  /** False for candidates the browser never fetched — a `srcset` entry, an unapplied rule. */
  requested: boolean;
  insideDistributionRoot: boolean;
}

export interface ResourceRecord {
  requestedUri: string;
  resolvedUri: string;
  scheme: string;
  origin: string;
  status: number | null;
  bytes: number | null;
  sha256: string | null;
  outcome: "loaded" | "blocked" | "failed";
}

export interface NotMeasured {
  scope: NotMeasuredScope;
  ruleId: string | null;
  reason: EnvId;
  target: { keyType: KeyType; nodeKey: string; sid: string | null } | null;
  /** At least 1. Aggregated: a 2 000-page multi-column document must not produce 10 000 rows. */
  count: number;
}

export interface InputIdentity {
  html: string;
  resources: {
    resolvedUri: string;
    status: number | null;
    bytes: number | null;
    sha256: string | null;
    outcome: "loaded" | "blocked" | "failed";
  }[];
  resourcesHash: string;
  browserVersion: string;
  platform: string;
  fontFamilies: string[];
  systemFontIds: string[];
  redirects: { from: string; to: string; status: number }[];
}

export interface SnapshotMeta {
  renderer: string | null;
  browserVersion: string;
  pagedjsVersion: string;
  platform: string;
  locale: string;
  inputIdentity: InputIdentity | null;
  freezeSignature: string;
  freezeRetries: number;
  epochCount: number;
  interventions: string[];
}

export interface Snapshot {
  schemaVersion: number;
  meta: SnapshotMeta;
  source: {
    map: Record<string, SourceRef>;
    parser: string;
    complete: boolean;
    injectedAttribute: "data-bl-sid";
    collisionChecked: boolean;
    /**
     * Exact original-source leaves from a verified producer, keyed by the injected input
     * address. `map` above always remains the inspected input artefact's map.
     */
    originalMap?: Record<string, SourceRef>;
    /** Multiple original leaves for one output address are kept explicit, never selected. */
    originalAmbiguity?: Record<string, SourceRef[]>;
    input?: {
      identityStatus: "verified" | "declared" | "unknown";
      rawBytesSha256: string | null;
      byteLength: number | null;
      encoding: "utf-8" | null;
      complete: boolean;
    };
    /** Digest inventory for original producer inputs. It contains no source bytes. */
    files?: readonly {
      file: string;
      sha256: string;
      byteLength: number;
      role: "authoring" | "dependency" | "asset";
    }[];
    provenance?: {
      binding: "producer-bound" | "declared" | "unavailable";
      copyIntegrity: "verified" | "unavailable";
      sourceRole?: "exact-original-range" | "verified-container-only" | "declared-matching-bytes" | "unknown";
      producerId?: string | null;
      receiptHash?: string | null;
      /** Bound executable and canonical producer-option digests, never code or options bytes. */
      codeSha256?: string | null;
      optionsSha256?: string | null;
      diagnostics: string[];
    };
  };
  pages: PageRecord[];
  blocks: BlockRecord[];
  textLines: TextLine[];
  textRuns: TextRun[];
  svg: SvgRecord[];
  uriRefs: UriRef[];
  resources: ResourceRecord[];
  notMeasured: NotMeasured[];
}

export interface Measurement {
  value: number;
  threshold: number;
  unit: string;
  /** Always false in v1: no rule has a corpus of >= 30 real documents behind its threshold. */
  calibrated: false;
  proofSource: ProofSource | null;
}

export interface StableTargetIdentity {
  status: "unique" | "ambiguous" | "unavailable";
  value: string | null;
  candidates: string[];
  identityContract?: "logical-source-value-v1";
  canonicalization?: "canonical-node-v1";
  authorAnchorSha256?: string;
  semanticSha256?: string;
}
export interface TargetInventory { complete: boolean; omittedCount: number; reason: string | null; }
export interface DocumentFontIdentity {
  diagnostic?: "css-source" | "source-inventory" | "cdp-readback" | "system-or-fallback";
  status: "verified" | "unavailable";
  complete: boolean;
  fonts: { resource: string; sha256: string }[];
  actualFamilies?: string[];
  method?: "captured-css-fonts-and-cdp-custom-glyphs-v1";
  reason: "fonts/actual-byte-identity-unavailable" | null;
}
export interface DocumentRevision {
  status: "verified";
  adapter: "host-local-git-v1";
  repositoryId: string;
  projectId: string;
  head: string;
  tree: string;
  workingTreeSha256: string;
  capturedSourcesSha256: string;
  codeSha256: string;
  optionsSha256: string;
  observedAt: string;
}
export interface Finding {
  /** Canonical run-local identifier; `fingerprint` remains the cross-run stable projection. */
  runFindingId: string;
  fingerprint: string;
  stableIdentity: StableTargetIdentity;
  recheck?: { status: "required"; reason: "repair-requires-compatible-positive-measurement"; identityContract: "logical-source-value-v1" };
  ruleId: string;
  severity: Severity;
  /** `layout/half-empty-page` only. An experimental threshold never moves an exit code. */
  experimental: boolean;
  message: string;
  document: string;
  /** Presentation only. NEVER part of the fingerprint — a page number is a layout product. */
  page: number;
  target: {
    keyType: KeyType;
    nodeKey: string;
    sid: string | null;
    fragmentIndex: number;
    boxScreen: Box | null;
    renderBox?: Box & { pageWidth: number; pageHeight: number; coordinateSystem: "css-page-top-left" };
  };
  source: SourceRef | null;
  measurement: Measurement;
  ambiguity: { groupSize: number; resolvable: false } | null;
  evidence: { ref: string | null; bindsFinding: boolean };
  /** Report4's source/actionability truth; scalar `source` remains the legacy projection. */
  originalSource: {
    status: "verified" | "declared" | "ambiguous" | "unavailable";
    role: "exact-original-range" | "verified-container-only" | "declared-matching-bytes" | "unknown";
    location: SourceRef | null;
    /** Digest for `location.file`, present only when the exact original leaf is inventory-bound. */
    integrity: { sha256: string; byteLength: number; role: "authoring" | "dependency" | "asset" } | null;
    candidates: SourceRef[];
  };
  actionability: "actionable" | "recheck-required" | "unknown-source";
}

export interface EvaluationMeasurement {
  name: string;
  value: number | boolean | string | null;
  unit: string | null;
  operator: "<" | "<=" | ">" | ">=" | "=" | null;
  threshold: number | boolean | string | null;
}

/** An actual per-target rule decision, including healthy and declined targets. */
export interface TargetEvaluation {
  stableIdentity?: StableTargetIdentity;
  evidenceBound?: boolean;
  ruleId: string;
  semanticsVersion: "rule-decision-v1";
  targetRef: Finding["target"];
  /** Distinguishes multiple independently judged occurrences at one concrete target address. */
  occurrenceKey?: string;
  /** Count carried by one explicitly unaddressable aggregate, otherwise exactly one. */
  targetCount?: number;
  status: "measured" | "not-measured" | "excluded" | "not-applicable";
  /** False for a real target inventory row outside this rule's historic coverage candidates. */
  countsTowardCoverage?: boolean;
  reason: string | null;
  measurements: EvaluationMeasurement[];
  predicate: { connective: "all" | "any" | "single"; violated: boolean | null };
}

export interface InfraEvent {
  kind: InfraEventKind;
  detail: string;
  measured: Record<string, unknown> | null;
}

export interface Evidence {
  key: string;
  page: number;
  path: string;
  origin: EvidenceOrigin;
  pdfConformance: "verified" | "unverified";
  conformance: {
    marksMatched: number;
    marksTotal: number;
    maxDxMm: number;
    maxDyMm: number;
    sdDyMm: number;
    /**
     * The value `maxDyMm` is a residual around. Reported because the residual alone cannot
     * distinguish "the marks sit where the DOM says" from "the marks all sit in the same wrong
     * place": under a uniform vertical displacement the residual is 0 for any displacement.
     */
    referenceDyMm: number;
  } | null;
  overlayCheck: { styleViolations: number; rasterDiffPx: number; removed: boolean };
  bindsFinding: boolean;
  unplacedMarks?: { sid: string; side: "start" | "end"; reason: "fragment-outside-page" }[];
  /** Bytes actually written by this run. Absent on legacy/imported evidence. */
  integrity?: {
    sha256: string;
    byteLength: number;
    widthPx: number;
    heightPx: number;
    coordinateSystem: "raster-pixels-top-left";
    dpi: number;
  };
}

/** The selected PDF from the same acquisition; never an address in a separately shipped PDF. */
export interface DocumentRenderArtifact {
  kind: "diagnostic-pdf";
  path: string;
  sha256: string;
  byteLength: number;
  inputHtmlSha256: string | null;
  withEvidenceOverlay: boolean;
  relation: "same-acquisition";
  delivery: "not-asserted";
}

export interface DocumentEvidenceCoverage {
  required: boolean;
  status: "complete" | "partial" | "unavailable" | "not-requested";
  expectedPages: number;
  writtenPages: number;
  boundPages: number;
  reason: "evidence/required-page-binding-incomplete" | null;
}

/** Host consumer's measured binding to an archive and, separately, a delivery readback. */
export interface DocumentDeliveryBinding {
  schemaVersion: 1;
  scope: "document-and-loaded-resources";
  status: "available" | "unavailable";
  level: "local-package-bound" | "delivery-verified" | null;
  archive: { sha256: string; bytes: number; memberCount: number } | null;
  coveredMembers: { logicalPath: string; role: "document" | "resource"; member: string; sha256: string; bytes: number }[];
  omittedMembers: { member: string; sha256: string; bytes: number }[];
  reasons: string[];
  witness: {
    channel: "gumroad-seller-attachment";
    productId: string;
    fileId: string;
    observedAt: string;
    archiveSha256: string;
    kind: "seller-attachment-readback";
  } | null;
}

export interface RuleCoverage {
  candidates: number;
  measured: number;
  notMeasured: NotMeasured[];
  /** Sum of `notMeasured[].count`. The invariant uses this, never `notMeasured.length`. */
  notMeasuredCount: number;
  coverage: number | null;
  floor: number;
  ok: boolean;
}

export interface DocumentSourceBinding {
  /** Input-artifact identity. Raw source bytes are deliberately never projected. */
  input: NonNullable<Snapshot["source"]["input"]>;
  /** Current producer capability and integrity metadata, without the private receipt or source. */
  provenance: NonNullable<Snapshot["source"]["provenance"]>;
  /** Digest inventory of original source leaves; only entries here can support verified originals. */
  files: readonly { file: string; sha256: string; byteLength: number; role: "authoring" | "dependency" | "asset" }[];
}

export interface DocumentReport {
  fontIdentity?: DocumentFontIdentity;
  path: string;
  revision?: DocumentRevision;
  comparisonScope?: { projectId: string; documentId: string; scenario: "document-print" };
  targetInventory?: TargetInventory;
  renderArtifact?: DocumentRenderArtifact;
  deliveryBinding?: DocumentDeliveryBinding;
  evidenceCoverage?: DocumentEvidenceCoverage;
  inputIdentity: InputIdentity | null;
  /** Full typed request outcomes retained when acquisition withdraws an invalid snapshot. */
  resources?: ResourceRecord[];
  /** Public canonical source-binding projection for report consumers. */
  sourceBinding: DocumentSourceBinding;
  verdict: RunVerdict;
  exitReason: string | null;
  pages: number;
  coverage: Record<string, RuleCoverage>;
  findings: Finding[];
  notMeasured: NotMeasured[];
  infrastructure: InfraEvent[];
  evidence: Evidence[];
  evaluations: TargetEvaluation[];
}

export interface ReportEnvironment {
  browserVersion: string;
  platform: string;
  rendererPath: string | null;
  rendererPresent: boolean;
  pagedjsVersion: string;
  rasterizer: Rasterizer | null;
  /** Mandatory once `rasterizer` is set. Read from what the loaded rasteriser reports. */
  rasterizerVersion: string | null;
  textPositionExtractor: { name: string; version: string; license: string } | null;
  fontFamiliesResolved: string[];
  locale: string;
}

export interface ReportConfig {
  contractVersion: 1;
  fingerprint: string;
  profile: ProfileName;
  profileSource: ConfigSource;
  failOn: FailOn;
  activeRules: string[];
  disabledRules: string[];
  coverageFloors: { ruleId: string; default: number; effective: number; source: ConfigSource }[];
  effective: EffectiveConfig;
  sources: Record<string, ConfigSource>;
  interventions: string[];
  sourceMapInjection: boolean;
  evidenceBinding: boolean;
  network: { mode: NetworkMode; allowed: string[]; blocked: number };
}

export interface ReportSummary {
  error: number;
  warn: number;
  info: number;
  experimental: number;
  suppressed: number;
  ambiguousGroups: number;
  /** What moved the verdict — not what findings existed. Null when coverage or infra decided. */
  gateTriggeredBy: "error" | "warn" | null;
  /** What the finding gate *would* have said, had it been the deciding factor. */
  gateCandidate: "error" | "warn" | null;
}

export interface Report {
  schemaVersion: number;
  profileKind: "document";
  /** Caller-supplied current-run identity; legacy callers receive the explicit unbound sentinel. */
  runId: string;
  mode: ReportMode;
  source: ReportSource;
  /** Both paths run through one rule module and one reporter module. This says which. */
  chain: "v1-rule-and-reporter-chain";
  tool: { name: string; version: string; commit: string | null };
  runVerdict: RunVerdict;
  exitCode: 0 | 1 | 2 | 3 | 4;
  startedAt: string;
  durationMs: number;
  inputsFound: number;
  pagesAnalysed: number;
  rulesRun: number;
  measuredRules: number;
  environment: ReportEnvironment;
  config: ReportConfig;
  documents: DocumentReport[];
  findings: Finding[];
  /** Canonical, flattened positive/negative target decisions from documents. */
  evaluations: TargetEvaluation[];
  summary: ReportSummary;
}

/**
 * Reserved P4 contract. It deliberately cannot masquerade as `Report`: a screen capture has a
 * route, viewport and DOM artifact instead of Paged.js/PDF/page counters. `checkPage` supplies
 * the concrete producer in P4.
 */
export interface ScreenReport {
  schemaVersion: 4;
  profileKind: "screen";
  runId: string;
  runVerdict: RunVerdict;
  exitCode: 0 | 1 | 2 | 3 | 4;
  scope: { projectId: string | null; documentId: string | null; scenario: string; viewport: { width: number; height: number; deviceScaleFactor: number } };
  artifact: { kind: "dom-capture"; domSha256: string | null; url: string; buildStatus: "bound" | "declared" | "unknown" };
  targetInventory: { complete: boolean; omittedCount: number; reason: string | null };
  evaluations: TargetEvaluation[];
  findings: Finding[];
  infrastructure: InfraEvent[];
}
