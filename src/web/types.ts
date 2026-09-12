/**
 * Public, browser-driver-neutral screen contract.  The API deliberately names only the
 * methods checkPage uses, so installing breaklint never imports or requires Playwright.
 */

import type { RunVerdict, Severity } from "../core/enums.ts";
import type { Box, StableTargetIdentity } from "../core/types.ts";

export interface StructuralPage {
  /** Matches Playwright's callable evaluate surface without naming its optional package types. */
  evaluate<R>(fn: (...args: any[]) => R | Promise<R>, ...args: any[]): Promise<R>;
  screenshot(options?: { fullPage?: boolean }): Promise<Uint8Array>;
  url(): string;
  viewportSize(): { width: number; height: number } | null;
  context(): { browser(): { version(): string } | null };
}

export interface NamedScreenException { selector: string; reason: string; }

export interface HostBuildContainer { selector: string; file: string; }

/** A host may supply ingredients for verification, never a claimed verification result. */
export interface HostBuildContainerBinding {
  kind: "host-build-container";
  root: string;
  receiptPath: string;
  /** Optional for generic hosts; without it no completed compiled-output binding is asserted. */
  buildOutputReceiptPath?: string;
  compiledBuildSelector: string;
  compiledBuildAttribute: string;
  containers: readonly HostBuildContainer[];
}

export interface CheckPageOptions {
  trust: "host-controlled-page";
  networkPolicy: "host-owned";
  scenario: string;
  projectId?: string;
  documentId?: string;
  runId?: string;
  output: { dir: string; screenshot: "viewport" | "full-page" };
  geometry?: {
    allowedScrollContainers?: readonly NamedScreenException[];
    intentionalOverlays?: readonly NamedScreenException[];
    maxTargets?: number;
    stabilizationTimeoutMs?: number;
  };
  sourceBinding?: HostBuildContainerBinding;
}

export interface ScreenTargetRef {
  selector: string;
  domPath: string;
  tag: string;
  box: Box | null;
  coordinateSystem: "css-viewport-pixels";
  scroll: { x: number; y: number };
}

export interface ScreenMeasurement {
  name: string;
  value: number | boolean | string | null;
  unit: "css-px" | "count" | null;
  operator: ">" | "=" | null;
  threshold: number | boolean | string | null;
}

export interface ScreenTargetEvaluation {
  id: string;
  ruleId: "web/unexpected-horizontal-overflow" | "web/content-clipped";
  target: ScreenTargetRef;
  status: "measured" | "excluded" | "not-measured";
  reason: string | null;
  measurements: ScreenMeasurement[];
  predicate: { connective: "single"; violated: boolean | null };
  evidenceBound: boolean;
  source: {
    status: "verified-container-only" | "declared" | "unknown";
    method: "build-bound-component-container" | null;
    file: string | null;
  };
  stableIdentity: StableTargetIdentity;
}

export interface ScreenFinding {
  id: string;
  ruleId: ScreenTargetEvaluation["ruleId"];
  severity: Severity;
  target: ScreenTargetRef;
  measurement: ScreenMeasurement;
  evaluationId: string;
  evidence: { bindsFinding: boolean; screenshot: string | null };
  repair: { nextCheck: "rerun-same-scenario-and-viewport" };
}

export interface ScreenInfrastructureEvent { kind: string; detail: string; fatal: boolean; }

export interface ScreenArtifact {
  kind: "png";
  relativePath: string | null;
  sha256: string | null;
  byteLength: number | null;
  widthPx: number | null;
  heightPx: number | null;
  capture: "viewport" | "full-page";
  coordinateSystem: "css-viewport-pixels-with-scroll";
}

export interface ScreenCoverage {
  candidates: number;
  measured: number;
  excluded: number;
  notMeasured: number;
  allowedScrollContainers: { selector: string; reason: string; count: number }[];
  intentionalOverlays: { selector: string; reason: string; count: number }[];
}

export interface PublicScreenReport {
  schemaVersion: 1;
  profileKind: "screen";
  runId: string;
  runVerdict: RunVerdict;
  exitCode: 0 | 1 | 2 | 3 | 4;
  scope: {
    projectId: string | null;
    documentId: string | null;
    scenario: string;
    url: string;
    viewport: { width: number; height: number; deviceScaleFactor: number };
    browserVersion: string | null;
  };
  trust: "host-controlled-page";
  networkPolicy: "host-owned";
  targetInventory: { complete: boolean; omittedCount: number; reason: string | null };
  coverage: ScreenCoverage;
  capture: {
    before: string;
    stable: string;
    after: string;
    fontsReady: boolean;
    timedOut: boolean;
    drifted: boolean;
  };
  artifact: ScreenArtifact;
  evaluations: ScreenTargetEvaluation[];
  findings: ScreenFinding[];
  infrastructure: ScreenInfrastructureEvent[];
  events: { kind: string; detail: string }[];
}

export type ScreenCheckResult =
  | { ok: true; report: PublicScreenReport }
  | { ok: false; report: PublicScreenReport };
