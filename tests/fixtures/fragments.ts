/**
 * Test-only snapshot transforms about fragmentation: what a paginator does to one block, and what
 * a rule that only ever looks at the first piece would see.
 *
 * `splitSnapshot` is the generic splitter the fragment contract runs every element-scope rule
 * through (tests/unit/fragment-contract.test.ts, and the `first-fragment-only` mutant in
 * tests/tools/mutants.ts). It moves a block's own text lines onto consecutive pages the way
 * Paged.js does for ordinary flow content — each piece is a new record on a new page with the same
 * source id, its lines keep their order and their spacing, the first piece stays where the block
 * started and every later one begins at the top of its page — and it adds nothing else: no
 * repeated border, no overflow column. A block split this way is exactly as tall as before, so a
 * rule whose quantity belongs to the element must say the same thing about it.
 */

import type { BlockRecord, PageRecord, Snapshot, TextLine } from "../../src/core/types.ts";

export interface SplitOptions {
  /**
   * How many of the block's lines each fragment carries, in order. Defaults to an even split, the
   * first fragments taking the remainder.
   */
  readonly lineCounts?: readonly number[];
}

/**
 * Splits the unsplit block `nodeKey` into `k` fragments on `k` consecutive pages, starting on the
 * page the block is on. Pages after it are renumbered, and any block below it on its page moves
 * onto the page of the last fragment, under it, as a paginator would push it.
 */
export function splitSnapshot(snapshot: Snapshot, nodeKey: string, k: number, options: SplitOptions = {}): Snapshot {
  const out = structuredClone(snapshot);
  const block = out.blocks.find((candidate) => candidate.nodeKey === nodeKey);
  if (!block) throw new Error(`splitSnapshot: no block ${nodeKey}`);
  if (block.fragmentCount !== 1) throw new Error(`splitSnapshot: ${nodeKey} is already split (${block.fragmentCount} fragments)`);
  if (!Number.isInteger(k) || k < 2) throw new Error(`splitSnapshot: k must be an integer >= 2, got ${k}`);
  const page = out.pages.find((candidate) => candidate.pageNumber === block.page);
  if (!page) throw new Error(`splitSnapshot: ${nodeKey} is on page ${block.page}, which the snapshot does not have`);

  const lines = out.textLines
    .filter((line) => line.blockKey === nodeKey)
    .sort((a, b) => a.box.y - b.box.y || a.index - b.index);
  if (lines.length < k) {
    throw new Error(`splitSnapshot: ${nodeKey} carries ${lines.length} text lines and cannot be split into ${k} fragments`);
  }
  const counts = options.lineCounts ?? evenly(lines.length, k);
  if (counts.length !== k || counts.some((count) => !Number.isInteger(count) || count < 1) ||
    counts.reduce((sum, count) => sum + count, 0) !== lines.length) {
    throw new Error(`splitSnapshot: line counts ${JSON.stringify(counts)} do not partition ${lines.length} lines into ${k}`);
  }

  const shift = k - 1;
  const blockBottom = block.box.y + block.box.height;
  // Records nested inside the block would have to be split with it, and which of them go where is
  // exactly the paginator's decision this splitter does not model. Refuse rather than guess.
  const nested = out.blocks.filter((other) => other !== block && other.page === block.page &&
    other.box.y >= block.box.y - 0.5 && other.box.y < blockBottom - 0.5);
  if (nested.length > 0) {
    throw new Error(`splitSnapshot: ${nodeKey} contains other records (${nested.map((other) => other.nodeKey).join(", ")}); split a leaf block`);
  }
  const top = page.contentBox.y;
  // Later pages first, so the new ones can take their numbers.
  for (const other of out.pages) if (other.pageNumber > page.pageNumber) other.pageNumber += shift;
  for (const other of out.blocks) if (other !== block && other.page > page.pageNumber) other.page += shift;
  const newPages: PageRecord[] = [];
  for (let index = 1; index < k; index += 1) {
    const copy = structuredClone(page);
    copy.pageNumber = page.pageNumber + index;
    copy.nodeKey = `${page.nodeKey}+split${index}`;
    copy.firstSemanticBlockKey = page.firstSemanticBlockKey === null ? null : `${page.firstSemanticBlockKey}+split${index}`;
    copy.incomingBreakCause = { kind: "overflow", determinedBy: "break-token", cascadeHint: null };
    copy.outgoingBreakCause = index === k - 1
      ? page.outgoingBreakCause
      : { kind: "overflow", determinedBy: "break-token", cascadeHint: null };
    copy.isLast = index === k - 1 ? page.isLast : false;
    newPages.push(copy);
  }
  page.outgoingBreakCause = { kind: "overflow", determinedBy: "break-token", cascadeHint: null };
  page.isLast = false;
  out.pages.splice(out.pages.indexOf(page) + 1, 0, ...newPages);

  const fragments: BlockRecord[] = [];
  let start = 0;
  let lastOffset = 0;
  for (let index = 0; index < k; index += 1) {
    const own = lines.slice(start, start + counts[index]!);
    start += counts[index]!;
    const first = own[0]!;
    const last = own[own.length - 1]!;
    // Fragment 0 stays where the block was; every later one starts at the top of its page.
    const offset = index === 0 ? 0 : top - first.box.y;
    const key = index === 0 ? block.nodeKey : `${block.nodeKey}#${index}`;
    for (const line of own) moveLine(line, key, offset);
    const boxTop = index === 0 ? block.box.y : top;
    const boxBottom = index === k - 1 ? blockBottom + offset : last.box.y + last.box.height;
    const fragment: BlockRecord = {
      ...structuredClone(block),
      nodeKey: key,
      fragmentIndex: index,
      fragmentCount: k,
      page: page.pageNumber + index,
      box: { ...block.box, y: boxTop, height: boxBottom - boxTop },
      lines: own.map((line) => line.index),
    };
    fragments.push(fragment);
    lastOffset = offset;
  }

  // Whatever followed the block on its page follows its last fragment now.
  for (const other of out.blocks) {
    if (other === block || other.page !== page.pageNumber || other.box.y < blockBottom - 0.5) continue;
    other.page = page.pageNumber + shift;
    other.box = { ...other.box, y: other.box.y + lastOffset };
    for (const line of out.textLines) if (line.blockKey === other.nodeKey) moveLine(line, line.blockKey, lastOffset);
  }
  out.blocks.splice(out.blocks.indexOf(block), 1, ...fragments);
  return out;
}

/**
 * What a rule sees if it only ever reads the first fragment of every element: the later
 * fragments and their lines are gone and the first one claims to be the whole block.
 */
export function firstFragmentOnly(snapshot: Snapshot): Snapshot {
  const kept = snapshot.blocks.filter((block) => block.fragmentIndex === 0);
  const keptKeys = new Set(kept.map((block) => block.nodeKey));
  return {
    ...snapshot,
    blocks: kept.map((block) => ({ ...block, fragmentCount: 1 })),
    textLines: snapshot.textLines.filter((line) => keptKeys.has(line.blockKey)),
  };
}

function evenly(total: number, k: number): number[] {
  const base = Math.floor(total / k);
  return Array.from({ length: k }, (_, index) => base + (index < total % k ? 1 : 0));
}

function moveLine(line: TextLine, blockKey: string, offset: number): void {
  line.blockKey = blockKey;
  line.box = { ...line.box, y: line.box.y + offset };
  if (line.wordBoxes) line.wordBoxes = line.wordBoxes.map((word) => ({ ...word, y: word.y + offset }));
}
