import type { DefaultTreeAdapterMap } from "parse5";
import type { TableIndex, TableRow, TableFragment, FigureBodyFragment } from "../core/types.ts";
type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
const element = (node: Node): node is Element => "tagName" in node;
const attrs = (node: Element) => Object.fromEntries(node.attrs.map(a => [a.name, a.value]));
const text = (node: Node): string => "value" in node ? node.value : ("childNodes" in node ? node.childNodes.map(text).join("") : "");
/** Preserve all authored rows, including hidden ones. A runtime membership mismatch declines. */
export function buildTableIndex(document: Node): TableIndex {
  const index: TableIndex = { complete: true, tables: [] };
  const walk = (node: Node, table: TableIndex["tables"][number] | null, row: TableRow | null, head: boolean): void => {
    if (!element(node)) return;
    const a = attrs(node);
    if (node.tagName === "table") {
      if (!a["data-bl-sid"]) index.complete = false;
      table = { sid: a["data-bl-sid"] ?? "", headerRowSids: [], rows: [], fragments: [] };
      index.tables.push(table); row = null; head = false;
    }
    if (table && node.tagName === "thead") head = true;
    if (table && node.tagName === "tr") {
      row = { sid: a["data-bl-sid"] ?? null, cells: [] }; table.rows.push(row);
      if (head && row.sid) table.headerRowSids.push(row.sid);
    }
    if (table && row && ["td", "th"].includes(node.tagName)) row.cells.push({
      sid: a["data-bl-sid"] ?? null, tag: node.tagName, text: text(node).replace(/\s+/gu, " ").trim(),
      colSpan: a.colspan === undefined ? 1 : Number(a.colspan), rowSpan: a.rowspan === undefined ? 1 : Number(a.rowspan),
    });
    for (const child of node.childNodes) walk(child, table, row, head);
  };
  for (const child of "childNodes" in document ? document.childNodes : []) walk(child, null, null, false);
  for (const table of index.tables) {
    // Older authored tables put an all-th header directly in tbody. Admit only the initial run.
    if (!table.headerRowSids.length) for (const row of table.rows) {
      if (!row.sid || !row.cells.length || !row.cells.every(cell => cell.tag === "th")) break;
      table.headerRowSids.push(row.sid);
    }
  }
  return index;
}

type Table = TableIndex["tables"][number];
/** Concrete cell boxes only: the table/figure wrapper is never the body witness. */
export function measuredTableBodyFragments(table: Pick<Table, "fragments">, identity: string): FigureBodyFragment[] {
  return table.fragments.filter(fragment => fragment.visible).flatMap(fragment => {
    const cells = fragment.rows.flatMap(row => row.cells).filter(cell => cell.visible && cell.box.width > 0 && cell.box.height > 0);
    if (!cells.length) return [];
    let x = Infinity, y = Infinity, right = -Infinity, bottom = -Infinity;
    for (const cell of cells) { x = Math.min(x, cell.box.x); y = Math.min(y, cell.box.y);
      right = Math.max(right, cell.box.x + cell.box.width); bottom = Math.max(bottom, cell.box.y + cell.box.height); }
    return [{ page: fragment.page, box: { x, y, width: right - x, height: bottom - y }, visible: true, identity }];
  });
}
const normal = (text: string) => text.replace(/\s+/gu, " ").trim();
function rowMatches(source: TableRow, rendered: TableFragment["rows"][number]): boolean {
  return source.sid === rendered.sid && source.cells.length === rendered.cells.length && source.cells.every((cell, i) => {
    const other = rendered.cells[i]!;
    return cell.sid === other.sid && cell.tag === other.tag && normal(cell.text) === normal(other.text)
      && cell.colSpan === 1 && cell.rowSpan === 1 && other.colSpan === 1 && other.rowSpan === 1;
  });
}
/** Membership/order are checked against source, not inferred from similar-looking wrapper boxes. */
export function sourceTableMatches(table: Table): boolean {
  if (!table.rows.length || table.rows.some(row => !row.sid || !row.cells.length || row.cells.some(cell => !cell.sid))) return false;
  const rows = new Map(table.rows.map(row => [row.sid, row]));
  if (rows.size !== table.rows.length) return false;
  const heads = new Set(table.headerRowSids);
  const seen = new Set<string>(); const order: string[] = [];
  for (const fragment of table.fragments) for (const row of fragment.rows) {
    if (!row.sid || !rows.has(row.sid) || !rowMatches(rows.get(row.sid)!, row)) return false;
    // Repeated headers may be cloned, data rows may not be duplicated or partially split.
    if (seen.has(row.sid) && !heads.has(row.sid)) return false;
    if (!seen.has(row.sid)) { seen.add(row.sid); order.push(row.sid); }
  }
  return order.length === table.rows.length && table.rows.every((row, i) => row.sid === order[i]);
}
