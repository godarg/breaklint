import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertSurfaceInventory } from "../tools/report-surface-contract.mjs";

/**
 * The report-surface inventory is judged by invariants, not by a last-measured tile total: every
 * screen row is covered by exactly one tile, no tile is listed twice, the 24 screen cells are
 * distinct, the physical totals equal what the artifacts list, and the printed page count of each
 * state is fixed. These are handwritten inventories run through the verifier's own function.
 */
const STATES = ["clean", "findings", "infrastructure", "insufficient-coverage"] as const;
const THEMES = ["light", "dark"] as const;
const VIEWPORTS = { desktop: { width: 1280, height: 800 }, tablet: { width: 768, height: 1024 }, mobile: { width: 390, height: 844 } } as const;
const PAGES = { clean: 3, findings: 8, infrastructure: 8, "insufficient-coverage": 8 } as const;
const hex = (seed: string) => [...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16).padStart(8, "0").repeat(8);

interface Tile { path: string; index: number; top: number; height: number; sha256: string }
interface Screen { cell: string; kind: "screen"; path: string; sha256: string; dimensions: { width: number; height: number }; tiles: Tile[] }
interface Pdf { cell: string; kind: "pdf"; path: string; sha256: string; pages: number }
interface RasterSet { cell: string; kind: "raster-set"; pages: { path: string; sha256: string }[] }
interface Inventory { artifacts: (Screen | Pdf | RasterSet)[]; physicalArtifacts: { screens: number; screenTiles: number; pdfs: number; rasterPages: number } }

function screen(state: string, theme: string, viewport: keyof typeof VIEWPORTS, tiles: number): Screen {
  const { width, height: step } = VIEWPORTS[viewport];
  const base = `${state}--${theme}--${viewport}`;
  const height = (tiles - 1) * step + 100;
  return {
    cell: `screen/${state}/${theme}/${viewport}`, kind: "screen", path: `${base}.png`, sha256: hex(base), dimensions: { width, height },
    tiles: Array.from({ length: tiles }, (_, i) => ({
      path: `${base}--tile-${String(i + 1).padStart(2, "0")}.png`, index: i + 1, top: i * step,
      height: i + 1 < tiles ? step : 100, sha256: hex(`${base}/${i}`),
    })),
  };
}

/** 24 screens, 20 with nine tiles and four with eight: the 212 tiles last measured on Linux. */
function inventory(tilesFor: (n: number) => number = (n) => (n < 20 ? 9 : 8)): Inventory {
  const artifacts: Inventory["artifacts"] = [];
  let n = 0;
  for (const state of STATES) {
    for (const theme of THEMES) for (const viewport of Object.keys(VIEWPORTS) as (keyof typeof VIEWPORTS)[]) artifacts.push(screen(state, theme, viewport, tilesFor(n++)));
    artifacts.push({ cell: `print/${state}/pdf`, kind: "pdf", path: `${state}--a4.pdf`, sha256: hex(`${state}.pdf`), pages: PAGES[state] });
    artifacts.push({ cell: `print/${state}/raster-set`, kind: "raster-set", pages: Array.from({ length: PAGES[state] }, (_, i) => ({ path: `${state}--a4-page-${i + 1}.png`, sha256: hex(`${state}/page/${i}`) })) });
  }
  return { artifacts, physicalArtifacts: recount(artifacts) };
}

function recount(artifacts: Inventory["artifacts"]): Inventory["physicalArtifacts"] {
  const screens = artifacts.filter((a): a is Screen => a.kind === "screen");
  return {
    screens: screens.length,
    screenTiles: screens.reduce((sum, a) => sum + a.tiles.length, 0),
    pdfs: artifacts.filter((a) => a.kind === "pdf").length,
    rasterPages: artifacts.filter((a): a is RasterSet => a.kind === "raster-set").reduce((sum, a) => sum + a.pages.length, 0),
  };
}

const screens = (i: Inventory) => i.artifacts.filter((a): a is Screen => a.kind === "screen");
const byCell = <T extends Inventory["artifacts"][number]>(i: Inventory, cell: string) => i.artifacts.find((a) => a.cell === cell) as T;

describe("report-surface inventory invariants", () => {
  it("accepts a complete inventory", () => {
    const i = inventory();
    assert.equal(i.physicalArtifacts.screenTiles, 212);
    assert.doesNotThrow(() => assertSurfaceInventory(i, "linux"));
    assert.doesNotThrow(() => assertSurfaceInventory(i, "darwin"));
  });

  it("accepts a tile total other than the last measured one when every row is covered exactly once", () => {
    // One phone page grew by one viewport: 213 tiles, each screen row still covered by one tile.
    const i = inventory((n) => (n === 0 ? 10 : n < 20 ? 9 : 8));
    assert.equal(i.physicalArtifacts.screenTiles, 213);
    assert.doesNotThrow(() => assertSurfaceInventory(i, "linux"));
  });

  it("rejects a tile listed twice, even when the total is unchanged", () => {
    const i = inventory();
    const [a, b] = screens(i);
    b!.tiles[1]!.path = a!.tiles[1]!.path;
    assert.equal(i.physicalArtifacts.screenTiles, 212);
    assert.throws(() => assertSurfaceInventory(i, "linux"), /listed more than once/u);
  });

  it("rejects screen rows that no tile covers, even when the total is unchanged", () => {
    const i = inventory();
    const [a, b] = screens(i);
    // Drop a's middle tile and renumber; b grows by one tile so the total stays at 212.
    a!.tiles.splice(4, 1);
    a!.tiles.forEach((tile, index) => { tile.index = index + 1; });
    const grown = screen(...(b!.cell.split("/").slice(1) as [string, string, keyof typeof VIEWPORTS]), b!.tiles.length + 1);
    Object.assign(b!, grown);
    i.physicalArtifacts = recount(i.artifacts);
    assert.equal(i.physicalArtifacts.screenTiles, 212);
    assert.throws(() => assertSurfaceInventory(i, "linux"), /covered by exactly one tile/u);
  });

  it("rejects overlapping tiles and tiles that stop short of the page end", () => {
    const overlap = inventory();
    screens(overlap)[0]!.tiles[2]!.top -= 10;
    assert.throws(() => assertSurfaceInventory(overlap, "linux"), /covered by exactly one tile/u);
    const short = inventory();
    screens(short)[0]!.dimensions.height += 1;
    assert.throws(() => assertSurfaceInventory(short, "linux"), /covered by exactly one tile/u);
  });

  it("requires 24 distinct screen cells", () => {
    const i = inventory();
    screens(i)[1]!.cell = screens(i)[0]!.cell;
    assert.throws(() => assertSurfaceInventory(i, "linux"), /24 distinct screen cells|listed more than once/u);
  });

  it("rejects physical totals that differ from the artifacts listed", () => {
    const i = inventory();
    i.physicalArtifacts.screenTiles += 1;
    assert.throws(() => assertSurfaceInventory(i, "linux"), /physical|inventory/u);
  });

  it("keeps the printed page count of every state fixed", () => {
    const longer = inventory();
    byCell<Pdf>(longer, "print/findings/pdf").pages += 1;
    byCell<RasterSet>(longer, "print/findings/raster-set").pages.push({ path: "findings--a4-page-9.png", sha256: hex("findings/page/8") });
    longer.physicalArtifacts = recount(longer.artifacts);
    assert.throws(() => assertSurfaceInventory(longer, "linux"), /print page inventory/u);
  });

  it("rejects a raster set whose page count differs from its PDF, even when the raster total is unchanged", () => {
    const i = inventory();
    const moved = byCell<RasterSet>(i, "print/findings/raster-set").pages.pop()!;
    byCell<RasterSet>(i, "print/infrastructure/raster-set").pages.push({ ...moved, path: "infrastructure--a4-page-9.png" });
    assert.equal(recount(i.artifacts).rasterPages, 27);
    assert.throws(() => assertSurfaceInventory(i, "linux"), /raster set/u);
  });

  it("refuses an unregistered platform", () => {
    assert.throws(() => assertSurfaceInventory(inventory(), "unsupported-control"), /unsupported report-surface platform/u);
  });
});
