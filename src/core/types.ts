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

export interface Finding {
  fingerprint: string;
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
  };
  source: SourceRef | null;
  measurement: Measurement;
  ambiguity: { groupSize: number; resolvable: false } | null;
  evidence: { ref: string | null; bindsFinding: boolean };
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

export interface DocumentReport {
  path: string;
  inputIdentity: InputIdentity | null;
  verdict: RunVerdict;
  exitReason: string | null;
  pages: number;
  coverage: Record<string, RuleCoverage>;
  findings: Finding[];
  notMeasured: NotMeasured[];
  infrastructure: InfraEvent[];
  evidence: Evidence[];
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
  summary: ReportSummary;
}
