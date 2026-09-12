/** The package root exports only public APIs; it does not expose internal acquisition paths. */
export { checkProducedDocuments } from "./api/produced-documents.ts";
export type {
  HostControlledProducer,
  ProducedCheckOptions,
  ProducedDocumentsResult,
  DataSourceManifest,
} from "./api/produced-documents.ts";
export type { ConfigFile, Report } from "./api/produced-documents.ts";
export { compareReports } from "./api/compare.ts";
export type { ComparisonStatus, ComparisonReason, ComparisonResult, ReportComparison, CompareReportsOptions } from "./api/compare.ts";
export type { HostGitRevisionOptions } from "./source/revision.ts";
export type { StableTargetIdentity, DocumentRevision, TargetInventory } from "./core/types.ts";
export { createContextPack } from "./api/context.ts";
export type { CreateContextPackOptions, ReportContextPack, ContextOperation } from "./api/context.ts";
export { renderReport, writeReportBundle } from "./api/bundle.ts";
export type { RenderReportOptions, WriteReportBundleOptions, ReportBundleResult } from "./api/bundle.ts";
export { checkPage } from "./api/check-page.ts";
export { SCREEN_OPTIONS_SCHEMA } from "./web/options.ts";
export type { StructuralPage, CheckPageOptions, PublicScreenReport, ScreenCheckResult, ScreenTargetEvaluation, ScreenFinding, ScreenInfrastructureEvent, ScreenArtifact, ScreenCoverage, NamedScreenException } from "./web/types.ts";
export type { DocumentFontIdentity } from "./core/types.ts";
