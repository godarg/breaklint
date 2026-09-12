/** Public, host-authorised producer API. See ../source/producer.ts for the security boundary. */
export {
  checkProducedDocuments,
  type HostControlledProducer,
  type ProducedCheckOptions,
  type ProducedDocumentsResult,
} from "../source/producer.ts";
/** A declaration is data for comparison only; it never creates producer authority. */
export type { SourceManifestV1 as DataSourceManifest } from "../source/provenance.ts";
export type { ConfigFile } from "../config/contract.ts";
export type { Report } from "../core/types.ts";
