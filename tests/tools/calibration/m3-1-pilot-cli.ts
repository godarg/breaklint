#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildBlindPacket,
  buildFreezeProjection,
  buildPilotReport,
  buildPublicIntakeManifest,
  canonicalJson,
  enumerateSvgTextTargets,
  ingestPublicArtifact,
  scanStagedPublicArtifacts,
  validateAnnotationWorkflow,
  validateStrictSplits,
  verifyExternalTrust,
  type BlindTarget,
  type FreezeProjectionInput,
  type IdentityBinding,
  type PilotReportInput,
  type PublicArtifactIntakeRequest,
  type PublicIntakeManifestDocument,
  type SplitDocument,
} from "./m3-1-pilot.ts";
import {
  createPublicPipelineBundle,
  verifyPublicPipelineBundle,
  type PublicPipelineSpec,
} from "./m3-1-public-pipeline.ts";

const decoder = new TextDecoder("utf-8", { fatal: true });

function readJson(path: string): unknown {
  return JSON.parse(decoder.decode(readFileSync(path))) as unknown;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be a JSON object`);
  return value as Record<string, unknown>;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`);
  return value;
}

async function main(): Promise<void> {
  const [mode, inputPath] = process.argv.slice(2);
  if (!mode || !inputPath || process.argv.length !== 4) {
    process.stderr.write("usage: m3-1-pilot-cli.ts <intake|targets|manifest|blind-packet|annotation-check|split-check|freeze|trust-check|staged-check|report|pipeline-create|pipeline-verify> <input.json>\n");
    process.exitCode = 2;
    return;
  }
  const input = record(readJson(inputPath), "input");
  let output: unknown;
  let gateValid: boolean | null = null;

  switch (mode) {
    case "intake":
      output = ingestPublicArtifact(input as unknown as PublicArtifactIntakeRequest);
      break;
    case "targets": {
      const request = record(input.request, "request") as unknown as PublicArtifactIntakeRequest;
      const intake = ingestPublicArtifact(request);
      const bytes = readFileSync(resolve(request.artifactRoot, request.artifactPath));
      output = { intake, targets: enumerateSvgTextTargets(bytes, input.ruleIds as never) };
      break;
    }
    case "manifest":
      output = buildPublicIntakeManifest({
        manifestId: string(input.manifestId, "manifestId"),
        createdAt: string(input.createdAt, "createdAt"),
        documents: input.documents as PublicIntakeManifestDocument[],
      });
      break;
    case "blind-packet":
      output = buildBlindPacket({
        packetId: string(input.packetId, "packetId"),
        orderSeed: string(input.orderSeed, "orderSeed"),
        targets: input.targets as BlindTarget[],
        contextsByTargetId: record(input.contextsByTargetId, "contextsByTargetId") as never,
      });
      break;
    case "annotation-check": {
      const result = validateAnnotationWorkflow(input as never);
      output = result;
      gateValid = result.valid;
      break;
    }
    case "split-check": {
      const result = validateStrictSplits(input.documents as SplitDocument[]);
      output = result;
      gateValid = result.valid;
      break;
    }
    case "freeze":
      output = buildFreezeProjection(input as unknown as FreezeProjectionInput);
      break;
    case "trust-check": {
      if (!Object.prototype.hasOwnProperty.call(input, "previousAccepted")) throw new Error("previousAccepted must be present and explicitly null for sequence 1");
      if (typeof input.evaluationStartedAt !== "string") throw new Error("evaluationStartedAt is required");
      const receiptPath = resolve(string(input.receiptPath, "receiptPath"));
      const proofPath = resolve(string(input.proofPath, "proofPath"));
      const result = verifyExternalTrust({
        subjectPath: string(input.subjectPath, "subjectPath"),
        expectedSubjectSha256: string(input.expectedSubjectSha256, "expectedSubjectSha256"),
        receiptBytes: readFileSync(receiptPath),
        proofBytes: readFileSync(proofPath),
        ...(typeof input.bundlePath === "string" ? { bundlePath: input.bundlePath } : {}),
        previousAccepted: input.previousAccepted as never,
        evaluationStartedAt: input.evaluationStartedAt,
      });
      output = result;
      gateValid = result.trusted;
      break;
    }
    case "staged-check": {
      const result = scanStagedPublicArtifacts(string(input.repositoryRoot, "repositoryRoot"));
      output = result;
      gateValid = result.valid;
      break;
    }
    case "report":
      output = buildPilotReport(input as unknown as PilotReportInput);
      break;
    case "pipeline-create":
      output = await createPublicPipelineBundle(input as unknown as PublicPipelineSpec);
      break;
    case "pipeline-verify": {
      const result = verifyPublicPipelineBundle(input as unknown as PublicPipelineSpec);
      output = result;
      gateValid = result.valid;
      break;
    }
    default:
      throw new Error(`unknown mode: ${mode}`);
  }

  process.stdout.write(canonicalJson(output));
  if (gateValid === false) process.exitCode = 1;
}

try {
  if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
