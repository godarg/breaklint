/**
 * Synthetic SVG fixtures for M3-0.
 *
 * Ground truth is a literal property of the authored construction. It is deliberately not
 * computed from breaklint output, a production threshold, or any of the ink measurements made by
 * the lab. The seven clip fixture names and SVG structures are carried forward verbatim from the
 * normative v1 contract's S19 evidence source.
 */

export type BinaryTruth = "positive" | "negative";

export interface ClipFixture {
  id: string;
  targets: Record<string, BinaryTruth>;
  clipBoundary: {
    elementId: string;
    targetIds: string[];
    authoredRight: number;
    expectedApplicationTranslateXDevicePixels?: number;
    expectation: "cuts-target" | "contains-target";
  } | null;
  rationale: string;
  svg: string;
}

export interface CollisionFixture {
  id: string;
  targetId: string;
  truth: "collision" | "occlusion" | "negative";
  expectedDecision: "finding" | "clean";
  expectedCollisionInk?: number;
  rationale: string;
  svg: string;
}

export interface ViewportFixture {
  id: string;
  targetId: string;
  truth: BinaryTruth;
  rationale: string;
  svgAttributes: string;
  svg: string;
}

export interface SamplingCounterexampleFixture {
  id: string;
  targetId: string;
  shapeId: string;
  rationale: string;
  svg: string;
}

export const CLIP_FIXTURES: readonly ClipFixture[] = Object.freeze([
  {
    id: "G1_textInGruppe",
    targets: { t1: "positive" },
    clipBoundary: { elementId: "c1-boundary", targetIds: ["t1"], authoredRight: 110, expectation: "cuts-target" },
    rationale: "The breaking case: clipped text is inside a direct group.",
    svg: `<defs><clipPath id="c1"><rect id="c1-boundary" x="20" y="20" width="90" height="80"/></clipPath></defs>
          <g id="g1"><text id="t1" x="20" y="60" font-size="40" clip-path="url(#c1)">HHHHHHHH</text></g>`,
  },
  {
    id: "G2_textInVerschachtelterGruppe",
    targets: { t1: "positive" },
    clipBoundary: { elementId: "c1-boundary", targetIds: ["t1"], authoredRight: 110, expectedApplicationTranslateXDevicePixels: 20, expectation: "cuts-target" },
    rationale: "Clipped text is inside two nested groups and a transform.",
    svg: `<defs><clipPath id="c1"><rect id="c1-boundary" x="20" y="20" width="90" height="80"/></clipPath></defs>
          <g id="g1" transform="translate(10,0)"><g id="g2">
            <text id="t1" x="20" y="60" font-size="40" clip-path="url(#c1)">HHHHHHHH</text>
          </g></g>`,
  },
  {
    id: "G3_zweiZieleEinesGeclippt",
    targets: { t1: "positive", t2: "negative" },
    clipBoundary: { elementId: "c1-boundary", targetIds: ["t1"], authoredRight: 110, expectation: "cuts-target" },
    rationale: "One of two text targets is clipped, so target attribution is observable.",
    svg: `<defs><clipPath id="c1"><rect id="c1-boundary" x="20" y="20" width="90" height="80"/></clipPath></defs>
          <text id="t1" x="20" y="60" font-size="40" clip-path="url(#c1)">HHHHHHHH</text>
          <text id="t2" x="20" y="120" font-size="40">HHHHHHHH</text>`,
  },
  {
    id: "G4_ueberlappendeTexte",
    targets: { t1: "positive", t2: "negative" },
    clipBoundary: { elementId: "c1-boundary", targetIds: ["t1"], authoredRight: 110, expectation: "cuts-target" },
    rationale: "A clean overlapping target fills pixels hidden from the clipped target.",
    svg: `<defs><clipPath id="c1"><rect id="c1-boundary" x="20" y="20" width="90" height="80"/></clipPath></defs>
          <text id="t1" x="20" y="60" font-size="40" clip-path="url(#c1)">HHHHHHHH</text>
          <text id="t2" x="20" y="62" font-size="40" fill="#333">HHHHHHHH</text>`,
  },
  {
    id: "V_verduennung",
    targets: { tg: "negative", tg2: "negative", tk: "positive" },
    clipBoundary: { elementId: "ck-boundary", targetIds: ["tk"], authoredRight: 46, expectation: "cuts-target" },
    rationale: "A small clipped target sits next to much more clean text and exposes dilution.",
    svg: `<defs><clipPath id="ck"><rect id="ck-boundary" x="20" y="98" width="26" height="30"/></clipPath></defs>
          <text id="tg" x="20" y="60" font-size="44">HHHHHHHHHHHHHHHH</text>
          <text id="tg2" x="20" y="92" font-size="20">HHHHHHHHHHHHHHHHHHHHHHHHHHHHHH</text>
          <text id="tk" x="20" y="120" font-size="24" clip-path="url(#ck)">HHHH</text>`,
  },
  {
    id: "N_keinClip",
    targets: { t1: "negative", t2: "negative" },
    clipBoundary: null,
    rationale: "Neither target has a clip or mask.",
    svg: `<g id="g1"><text id="t1" x="20" y="60" font-size="40">HHHHHHHH</text></g>
          <text id="t2" x="20" y="120" font-size="40">HHHHHHHH</text>`,
  },
  {
    id: "N_clipEnthaeltGanz",
    targets: { t1: "negative" },
    clipBoundary: { elementId: "c1-boundary", targetIds: ["t1"], authoredRight: 400, expectation: "contains-target" },
    rationale: "The clip path fully contains the text; a clip alone is not a defect.",
    svg: `<defs><clipPath id="c1"><rect id="c1-boundary" x="0" y="0" width="400" height="140"/></clipPath></defs>
          <g id="g1"><text id="t1" x="20" y="60" font-size="40" clip-path="url(#c1)">HHHHHHHH</text></g>`,
  },
]);

export const COLLISION_FIXTURES: readonly CollisionFixture[] = Object.freeze([
  {
    id: "collision_crossing_2px",
    targetId: "t1",
    truth: "collision",
    expectedDecision: "finding",
    rationale: "A two-pixel line crosses the glyph bodies.",
    svg: `<text id="t1" x="20" y="60" font-size="40">HHHHHHHHHH</text>
          <line x1="20" y1="48" x2="380" y2="48" stroke="#000" stroke-width="2"/>`,
  },
  {
    id: "collision_crossing_under_text",
    targetId: "t1",
    truth: "collision",
    expectedDecision: "finding",
    rationale: "The same line precedes the text in source order; z-order must not hide contact.",
    svg: `<line x1="20" y1="48" x2="380" y2="48" stroke="#000" stroke-width="2"/>
          <text id="t1" x="20" y="60" font-size="40">HHHHHHHHHH</text>`,
  },
  {
    id: "collision_hairline_0_4px",
    targetId: "t1",
    truth: "collision",
    expectedDecision: "finding",
    rationale: "A 0.4-pixel line is the fixed-grid grazing boundary.",
    svg: `<text id="t1" x="20" y="60" font-size="40">HHHHHHHHHH</text>
          <line x1="20" y1="48" x2="380" y2="48" stroke="#000" stroke-width="0.4"/>`,
  },
  {
    id: "collision_pale_yellow",
    targetId: "t1",
    truth: "collision",
    expectedDecision: "finding",
    rationale: "A pale line catches the former luminance-based false negative.",
    svg: `<text id="t1" x="20" y="60" font-size="40">HHHHHHHHHH</text>
          <line x1="20" y1="48" x2="380" y2="48" stroke="#ffe000" stroke-width="6"/>`,
  },
  {
    id: "occlusion_opaque_white",
    targetId: "t1",
    truth: "occlusion",
    expectedDecision: "finding",
    rationale: "An opaque white rectangle removes visible text while carrying no shape ink.",
    svg: `<text id="t1" x="20" y="60" font-size="40">HHHHHHHHHH</text>
          <rect x="20" y="30" width="180" height="36" fill="#fff"/>`,
  },
  {
    id: "collision_line_below_baseline",
    targetId: "t1",
    truth: "negative",
    expectedDecision: "clean",
    rationale: "The line is well below the glyphs.",
    svg: `<text id="t1" x="20" y="60" font-size="40">HHHHHHHHHH</text>
          <line x1="20" y1="95" x2="380" y2="95" stroke="#000" stroke-width="2"/>`,
  },
  {
    id: "collision_line_in_text_gap",
    targetId: "t1",
    truth: "negative",
    expectedDecision: "clean",
    rationale: "The line crosses the union bounding box but runs through the glyph-free line gap.",
    svg: `<text id="t1" x="20" y="55" font-size="30">HHHHHHHHHH</text>
          <text id="t2" x="20" y="105" font-size="30">HHHHHHHHHH</text>
          <line x1="20" y1="72" x2="380" y2="72" stroke="#000" stroke-width="2"/>`,
  },
  {
    id: "collision_pixel_boundary_7",
    targetId: "t1",
    truth: "collision",
    expectedDecision: "clean",
    expectedCollisionInk: 7,
    rationale: "Exactly seven shared device pixels are one below the production boundary.",
    svg: `<text id="t1" x="20" y="60" font-size="40">H</text>
          <rect x="24" y="40" width="0.5" height="3.5" fill="#000"/>`,
  },
  {
    id: "collision_pixel_boundary_8",
    targetId: "t1",
    truth: "collision",
    expectedDecision: "finding",
    expectedCollisionInk: 8,
    rationale: "Exactly eight shared device pixels are at the inclusive production boundary.",
    svg: `<text id="t1" x="20" y="60" font-size="40">H</text>
          <rect x="24" y="40" width="0.5" height="4" fill="#000"/>`,
  },
]);

/**
 * Exact S9-D corner construction from the v1 contract. This is deliberately a sampling
 * counterexample, not a binary collision label: the independent claim is that the authored short
 * stroke grazes the text box while a fixed 4 px point grid misses that geometric contact. The lab
 * measures both grids in the real rendered SVG and does not promote box contact to glyph truth.
 */
export const GRAZING_SAMPLING_FIXTURE: Readonly<SamplingCounterexampleFixture> = Object.freeze({
  id: "collision_grazing_corner_sampling",
  targetId: "t1",
  shapeId: "s1",
  rationale: "The short 0.3 px stroke grazes a text-box corner; the historical 4 px grid misses it.",
  svg: `<text id="t1" x="240" y="120" font-size="12" font-family="Georgia,serif">Kreuzung</text>
        <line id="s1" x1="238" y1="122" x2="246" y2="108" stroke="#000" stroke-width="0.3"/>`,
});

export const VIEWPORT_FIXTURES: readonly ViewportFixture[] = Object.freeze([
  {
    id: "viewport_text_outside",
    targetId: "t1",
    truth: "positive",
    rationale: "The target begins beyond the 200-unit viewBox width.",
    svgAttributes: `width="400" height="140" viewBox="0 0 200 140" overflow="hidden"`,
    svg: `<text id="t1" x="220" y="60" font-size="30">outside</text>`,
  },
  {
    id: "viewport_enlarged_viewbox",
    targetId: "t1",
    truth: "negative",
    rationale: "The enlarged viewBox contains the same target.",
    svgAttributes: `width="400" height="140" viewBox="0 0 400 140" overflow="hidden"`,
    svg: `<text id="t1" x="220" y="60" font-size="30">inside</text>`,
  },
  {
    id: "viewport_overflow_visible",
    targetId: "t1",
    truth: "negative",
    rationale: "Overflow visible paints the same outlying target and is an explicit exclusion.",
    svgAttributes: `width="400" height="140" viewBox="0 0 200 140" overflow="visible"`,
    svg: `<text id="t1" x="220" y="60" font-size="30">visible</text>`,
  },
]);
