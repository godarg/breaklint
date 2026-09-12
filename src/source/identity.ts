/** Conservative logical author identity; byte positions only locate the parsed original. */
import { createHash } from "node:crypto";
import { parse, type DefaultTreeAdapterMap } from "parse5";
import { decodeUtf8Strict, utf16OffsetToUtf8Byte } from "./bytes.ts";
import { injectSourceIds } from "./inject.ts";
import type { StableTargetIdentity, TargetInventory } from "../core/types.ts";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
const IGNORED = new Set(["class", "style", "x", "y", "dx", "dy", "width", "height", "transform", "textLength", "lengthAdjust"]);
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export const unavailableIdentity = (): StableTargetIdentity => ({ status: "unavailable", value: null, candidates: [], identityContract: "logical-source-value-v1", canonicalization: "canonical-node-v1" });
function canonical(node: Node): unknown {
  if ("tagName" in node) {
    const element = node as Element;
    return [element.namespaceURI, element.tagName,
      element.attrs.filter(a => !IGNORED.has(a.name)).map(a => [a.namespace ?? "", a.prefix ?? "", a.name, a.value]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b), "en")),
      (element.childNodes ?? []).map(canonical),
      "content" in element ? canonical((element as DefaultTreeAdapterMap["template"]).content) : null];
  }
  if ("value" in node) return [node.nodeName, node.value];
  if ("data" in node) return [node.nodeName, node.data];
  if ("name" in node) return [node.nodeName, node.name, node.publicId, node.systemId];
  return [node.nodeName, ("childNodes" in node ? node.childNodes : []).map(canonical)];
}
interface OriginalNode { start: number; end: number; anchor: string; anchorTokens: string[]; semantic: string; value: string; }
export function identitiesForProducedOutput(input: {
  outputPath: string; output: Buffer; inputs: ReadonlyMap<string, Buffer>;
  inputRoles: ReadonlyMap<string, string>;
  sourceOrigin: (path: string, start: number, end: number) => { status: string; path?: string; start?: number; end?: number };
}): { bySid: Record<string, StableTargetIdentity>; inventory: TargetInventory } {
  const originals = new Map<string, OriginalNode[]>();
  let complete = true;
  // Enumeration is bounded by the already checked producer inventory and byte limits.
  for (const [file, bytes] of input.inputs) {
    if (input.inputRoles.get(file) !== "authoring") continue;
    try {
      const text = decodeUtf8Strict(bytes, file);
      const document = parse(text, { sourceCodeLocationInfo: true });
      const nodes: OriginalNode[] = [];
      const walk = (node: Node): void => {
        if ("tagName" in node) {
          const element = node as Element; const loc = element.sourceCodeLocation;
          const anchors = element.attrs.filter(a => a.name === "id" || a.name === "data-source-id").filter(a => a.value.length > 0);
          if (loc && anchors.length > 0) {
            const anchor = JSON.stringify(anchors.map(a => [a.name, a.value]).sort());
            const semantic = hash(JSON.stringify(canonical(node)));
            nodes.push({ start: utf16OffsetToUtf8Byte(text, loc.startOffset), end: utf16OffsetToUtf8Byte(text, loc.endOffset), anchor, anchorTokens: anchors.map(a => JSON.stringify([a.name, a.value])), semantic,
              value: hash(JSON.stringify([file, anchor, element.namespaceURI, element.tagName, semantic])) });
          }
          if ("content" in element) walk((element as DefaultTreeAdapterMap["template"]).content);
        }
        for (const child of "childNodes" in node ? node.childNodes : []) walk(child);
      };
      walk(document); originals.set(file, nodes);
    } catch { complete = false; }
  }
  const bySid: Record<string, StableTargetIdentity> = Object.create(null) as Record<string, StableTargetIdentity>;
  const outputMap = injectSourceIds(decodeUtf8Strict(input.output, input.outputPath), input.outputPath).map;
  const raw = new Map<string, { node: OriginalNode; duplicates: number }>();
  for (const [sid, ref] of Object.entries(outputMap)) {
    bySid[sid] = unavailableIdentity();
    const origin = input.sourceOrigin(input.outputPath, ref.offset, ref.endOffset);
    if (!complete || origin.status !== "exact-original-range" || !origin.path) continue;
    const nodes = originals.get(origin.path) ?? [];
    const exact = nodes.filter(n => n.start === origin.start && n.end === origin.end);
    if (exact.length !== 1) continue;
    const node = exact[0]!;
    // A duplicate author anchor cannot become unique by changing its text or by truncating matches.
    raw.set(sid, { node, duplicates: nodes.filter(n => n.anchorTokens.some(token => node.anchorTokens.includes(token))).length });
  }
  for (const [sid, { node, duplicates }] of raw) {
    const copies = [...raw.values()].filter(n => n.node.value === node.value).length;
    const ambiguous = duplicates !== 1 || copies !== 1;
    bySid[sid] = {
      status: ambiguous ? "ambiguous" : "unique", value: ambiguous ? null : node.value,
      candidates: [node.value], identityContract: "logical-source-value-v1", canonicalization: "canonical-node-v1",
      authorAnchorSha256: hash(node.anchor), semanticSha256: node.semantic,
    };
  }
  return { bySid, inventory: { complete, omittedCount: 0, reason: complete ? null : "identity/original-enumeration-incomplete" } };
}
