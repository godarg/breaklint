/**
 * Independent literal pins for the seven normative clipping fixtures.
 *
 * This file deliberately imports neither `fixtures.ts` nor the lab. IDs, order, construction
 * bytes and target/boundary semantics are a second source against which the executable fixture
 * list is checked. Updating a fixture therefore requires an explicit contract-version review;
 * renaming or swapping G1/G2 in the fixture array cannot silently update its own oracle.
 */
export const NORMATIVE_CLIP_FIXTURE_CONTRACT_V1 = Object.freeze([
  { id: "G1_textInGruppe", svgSha256: "b7a95e851a8fe2a4a8ac9054709173a25115c7b7d86d2fc171d3f5093965b146", targets: { t1: "positive" }, boundary: { elementId: "c1-boundary", targetIds: ["t1"], authoredRight: 110, expectedTranslateDevicePixels: 0, expectation: "cuts-target" } },
  { id: "G2_textInVerschachtelterGruppe", svgSha256: "d21d84790714eaa1bcc9243110d99185df1ba1e999039edaf917499f70d1ac16", targets: { t1: "positive" }, boundary: { elementId: "c1-boundary", targetIds: ["t1"], authoredRight: 110, expectedTranslateDevicePixels: 20, expectation: "cuts-target" } },
  { id: "G3_zweiZieleEinesGeclippt", svgSha256: "3bd64021f23389393c0dfaef818a248bc13762375983a1341c91c32cb6be3af0", targets: { t1: "positive", t2: "negative" }, boundary: { elementId: "c1-boundary", targetIds: ["t1"], authoredRight: 110, expectedTranslateDevicePixels: 0, expectation: "cuts-target" } },
  { id: "G4_ueberlappendeTexte", svgSha256: "53423bd8e3a5951d21a301bbc60c57afba238d6d316886d75f0a1dd9037ffec5", targets: { t1: "positive", t2: "negative" }, boundary: { elementId: "c1-boundary", targetIds: ["t1"], authoredRight: 110, expectedTranslateDevicePixels: 0, expectation: "cuts-target" } },
  { id: "V_verduennung", svgSha256: "d12ffeb998069b97d82fb0d5c5f044294ff0696b9a3c44349452eac162d4fe5d", targets: { tg: "negative", tg2: "negative", tk: "positive" }, boundary: { elementId: "ck-boundary", targetIds: ["tk"], authoredRight: 46, expectedTranslateDevicePixels: 0, expectation: "cuts-target" } },
  { id: "N_keinClip", svgSha256: "dbeea549dfeacc4c80f0ade6e9cc881b42860a0d50abd585a5bb971ee375a39b", targets: { t1: "negative", t2: "negative" }, boundary: null },
  { id: "N_clipEnthaeltGanz", svgSha256: "95b9135526414bfa9fac4d4757803e8d8adc05c2a76c6f27035572cd3fc4df15", targets: { t1: "negative" }, boundary: { elementId: "c1-boundary", targetIds: ["t1"], authoredRight: 400, expectedTranslateDevicePixels: 0, expectation: "contains-target" } },
] as const);

export const NORMATIVE_CLIP_FIXTURE_IDS_V1 = Object.freeze(NORMATIVE_CLIP_FIXTURE_CONTRACT_V1.map((fixture) => fixture.id));
