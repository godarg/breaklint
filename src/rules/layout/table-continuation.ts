import { sourceTableMatches, tableGridColumns } from "../../source/table-index.ts";
import { defineRule } from "../../core/rule.ts";
import { blockKey } from "../../core/fingerprint.ts";
import type { Snapshot, TableFragment, TableIndex } from "../../core/types.ts";
import { declined, isNotRendered, layoutOutOfScope, makeFinding, renderedBox, sourceOf, targetEvaluation } from "../shared.ts";

type Table = TableIndex["tables"][number];
const HEADER = "layout/table-header-not-repeated";
const COLUMNS = "layout/table-column-drift";
function visibleHeader(table: Table, fragment: TableFragment): boolean {
  return table.headerRowSids.length > 0 && table.headerRowSids.every(sid => fragment.rows.some(row => row.sid === sid
    && row.cells.length > 0 && row.cells.every(cell => cell.visible && cell.box.width > 0 && cell.box.height > 0)));
}
function check(snapshot: Snapshot, ctx: Parameters<typeof makeFinding>[0]["ctx"], id: string) {
  const findings = []; const notMeasured = []; const evaluations = [];
  let candidates = 0; let measured = 0;
  const index = snapshot.tableIndex;
  if (!index?.complete) {
    const reason = "env/table-index-unavailable" as const;
    return { findings: [], candidates: 1, measured: 0, notMeasured: [declined({ scope: "document", ruleId: id, reason })],
      evaluations: [targetEvaluation({ ruleId: id, keyType: "generated", nodeKey: "table-inventory", sid: null,
        occurrenceKey: "unaddressable-rest:table-inventory", status: "not-measured", reason })] };
  }
  const blocks = new Map(snapshot.blocks.map(block => [`${block.sid}:${block.page}`, block]));
  for (const table of index.tables) {
    const fragments = [...table.fragments].filter(fragment => fragment.visible).sort((a, b) => a.page - b.page);
    const lead = fragments[0];
    if (!fragments.length) {
      const authored = snapshot.blocks.filter(block => block.sid === table.sid);
      const hidden = authored.length > 0 && authored.every(block => isNotRendered(snapshot, block));
      const reason = "env/table-structure-unsupported" as const;
      const target = { ruleId: id, keyType: "generated" as const, nodeKey: `table-inventory:${table.sid}`, sid: table.sid };
      evaluations.push(targetEvaluation({ ...target, status: hidden ? "excluded" : "not-measured",
        countsTowardCoverage: !hidden, reason: hidden ? "rule/target-not-visible" : reason }));
      if (!hidden) { candidates += 1; notMeasured.push(declined({ scope: "block", ruleId: id, reason })); }
      continue;
    }
    const gridColumns = tableGridColumns(table);
    const leadDataRows = lead?.rows.filter(row => !table.headerRowSids.includes(row.sid!)).length ?? 0;
    const firstDataPage = fragments.find(f => f.rows.some(row => !table.headerRowSids.includes(row.sid!)))?.page;
    const leadHeaderRows = lead ? lead.rows.filter(row => table.headerRowSids.includes(row.sid!)) : [];
    const unspannedHeader = gridColumns !== null
      ? [...leadHeaderRows].reverse().find(row => row.cells.length === gridColumns && row.cells.every(cell => cell.colSpan === 1))
      : undefined;
    const simpleSpanLayoutMatches = leadHeaderRows.length > 0 && gridColumns !== null && (() => {
      const ref = leadHeaderRows[leadHeaderRows.length - 1]!;
      const refSpans = ref.cells.map(c => c.colSpan);
      return fragments.every(f => f.rows.filter(row => !table.headerRowSids.includes(row.sid!)).every(row =>
        (row.cells.length === 1 && row.cells[0]!.colSpan === gridColumns) ||
        (row.cells.length === refSpans.length && row.cells.every((c, idx) => c.colSpan === refSpans[idx]))
      ));
    })();
    const columnTracksUnavailable = id === COLUMNS && !unspannedHeader && !simpleSpanLayoutMatches;
    const unsupported = !sourceTableMatches(table) || gridColumns === null || !lead || !table.headerRowSids.length
      || !visibleHeader(table, lead) || columnTracksUnavailable
      || fragments.some(f => f.rows.filter(row => !table.headerRowSids.includes(row.sid!))
        .some(row => row.cells.some(cell => !cell.visible || cell.box.width <= 0 || cell.box.height <= 0)));
    for (const [at, fragment] of fragments.entries()) {
      const block = blocks.get(`${table.sid}:${fragment.page}`);
      const target = { ruleId: id, keyType: "block" as const, nodeKey: block?.nodeKey ?? `table:${table.sid}:${fragment.page}`,
        sid: table.sid, fragmentIndex: block?.fragmentIndex ?? at, boxScreen: block ? renderedBox(snapshot, block) : fragment.box };
      candidates += 1;
      const reason = fragment.flowReason || (block ? layoutOutOfScope(block.effectiveStyle) : null)
        || (!block || unsupported ? "env/table-structure-unsupported" as const : null);
      if (reason) {
        notMeasured.push(declined({ scope: "block", ruleId: id, reason, target: { keyType: "block", nodeKey: target.nodeKey, sid: table.sid } }));
        evaluations.push(targetEvaluation({ ...target, status: "not-measured", reason })); continue;
      }
      measured += 1;
      const dataRows = fragment.rows.filter(row => !table.headerRowSids.includes(row.sid!));
      const headPresent = visibleHeader(table, fragment);
      // Local tracks survive page stacking. Compare both edges, never font or wrapper width.
      let maxDelta = 0;
      if (id === COLUMNS) {
        const refRow = unspannedHeader ?? leadHeaderRows[leadHeaderRows.length - 1]!;
        const refLefts = refRow.cells.map(c => c.box.x - lead!.box.x);
        const refRights = refRow.cells.map(c => c.box.x + c.box.width - lead!.box.x);
        const refSpanLeft = (start: number, end: number): number => Math.min(refLefts[start]!, refLefts[end]!);
        const refSpanRight = (start: number, end: number): number => Math.max(refRights[start]!, refRights[end]!);
        for (const row of dataRows) {
          if (unspannedHeader) {
            let colStart = 0;
            for (const cell of row.cells) {
              const colEnd = colStart + cell.colSpan - 1;
              const left = (cell.box.x - fragment.box.x) - refSpanLeft(colStart, colEnd);
              const right = (cell.box.x + cell.box.width - fragment.box.x) - refSpanRight(colStart, colEnd);
              maxDelta = Math.max(maxDelta, Math.abs(left), Math.abs(right));
              colStart += cell.colSpan;
            }
          } else if (row.cells.length === 1 && row.cells[0]!.colSpan === gridColumns) {
            const cell = row.cells[0]!;
            const left = (cell.box.x - fragment.box.x) - refSpanLeft(0, refLefts.length - 1);
            const right = (cell.box.x + cell.box.width - fragment.box.x) - refSpanRight(0, refRights.length - 1);
            maxDelta = Math.max(maxDelta, Math.abs(left), Math.abs(right));
          } else {
            for (const [i, cell] of row.cells.entries()) {
              const left = (cell.box.x - fragment.box.x) - refLefts[i]!;
              const right = (cell.box.x + cell.box.width - fragment.box.x) - refRights[i]!;
              maxDelta = Math.max(maxDelta, Math.abs(left), Math.abs(right));
            }
          }
        }
      }
      const threshold = id === COLUMNS ? Number(ctx.options.maxColumnDriftPx ?? 2) : 0;
      const violated = at > 0 && dataRows.length > 0 && (id === HEADER ? !headPresent : maxDelta > threshold);
      evaluations.push(targetEvaluation({ ...target, status: "measured", violated, measurements: [
        { name: "continuation-fragment", value: at > 0, unit: null, operator: "=", threshold: true },
        { name: "visible-data-rows", value: dataRows.length, unit: "rows", operator: ">", threshold: 0 },
        id === HEADER ? { name: "visible-existing-header", value: headPresent, unit: null, operator: "=", threshold: false }
          : { name: "maximum-column-edge-displacement", value: maxDelta, unit: "CSS px", operator: ">", threshold },
      ], connective: "all" }));
      if (!violated) continue;
      findings.push(makeFinding({ ctx, ruleId: id, severity: "warn", page: fragment.page,
        keyType: "block", key: blockKey(block!), nodeKey: target.nodeKey, sid: table.sid, fragmentIndex: block!.fragmentIndex,
        boxScreen: target.boxScreen, source: sourceOf(snapshot, table.sid), value: id === HEADER ? table.headerRowSids.length : maxDelta,
        threshold, unit: id === HEADER ? "missing header rows" : "CSS px",
        message: id === HEADER
          ? `Table continues on page ${fragment.page} with ${dataRows.length} visible data row(s), but its existing ${table.headerRowSids.length} header row(s), visible on page ${lead!.page}, are absent here.${leadDataRows === 0 ? ` The first fragment on page ${lead!.page} contains only the header; the first data row appears on page ${firstDataPage}. Check keeping the header with that row before considering repeated headers.` : ""} Source row membership and cell content match. This establishes lost column context; pagination cause and author intent are unknown.`
          : `Table continues on page ${fragment.page}; its column edges differ by up to ${maxDelta.toFixed(2)} CSS px from the visible header on page ${lead!.page} (threshold ${threshold} CSS px). Source cell membership and content match. This measures changed tracks; the displacement alone does not establish material reader impact. Compare both pages before trying explicit column widths; cause and author intent are unknown.`,
      }));
    }
  }
  return { findings, candidates, measured, notMeasured, evaluations };
}
const declines = ["env/table-index-unavailable", "env/table-structure-unsupported", "env/multicolumn", "env/vertical-writing"] as const;
export const tableHeaderNotRepeated = defineRule({ id: HEADER, severity: "warn", proofSource: null, calibrated: false,
  experimental: false, unit: "missing header rows", defaultOptions: {}, declines,
  summary: "An existing visible table header is absent from a measured continuation with data rows.",
  remediation: { advice: "Compare the named header and continuation pages. If the first fragment contains only the header, first try keeping that header with the first data row. Preserve the existing header and try a producer/Paged.js repeated-header handler or appropriate table-header-group styling for later fragments. Confirm that every data row remains exactly once, column edges stay aligned and page fill remains acceptable. A whole-table keep is unsuitable when the table cannot fit. This is an untested suggestion, not proof of the break cause.", tested: false },
}, (snapshot, ctx) => check(snapshot, ctx, HEADER));
export const tableColumnDrift = defineRule({ id: COLUMNS, severity: "warn", proofSource: null, calibrated: false,
  experimental: false, unit: "CSS px", defaultOptions: { maxColumnDriftPx: 2 }, declines,
  summary: "Continuation data-cell edges differ from the first visible header's measured column tracks.",
  remediation: { advice: "Compare column boundaries on the named pages. Try an explicit colgroup or shared column-width constraints across fragments, then rerender and check every cell for wrapping and overflow. The measured displacement establishes changed tracks, not an incorrect author intention. The suggested repair has not been tested on this table.", tested: false },
}, (snapshot, ctx) => check(snapshot, ctx, COLUMNS));
