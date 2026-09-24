import { strict as assert } from "node:assert";
import { it } from "node:test";

import { PRIMITIVES_CHECK, PRIMITIVES_SOURCE } from "../../src/measure/primitives.ts";
import { SNAPSHOT_SOURCE } from "../../src/measure/snapshot.ts";

/**
 * The in-page half of the SVG frame ships facts and decides nothing. Up to 0.6.0 it decided in the
 * page — any border, padding, clip margin or ancestor transform declined the SVG, and the clip
 * margin was read with parseFloat, which is NaN for every keyword form. The decisions now live in
 * `svg-viewport.ts`, where `svg-viewport.test.ts` reaches them without a browser; this pins that
 * they did not drift back into the payload, and that the facts are read through captured
 * primitives rather than through prototypes a document can replace.
 */
it("the injected SVG collector ships raw frame facts through captured primitives", () => {
  assert.doesNotThrow(() => new Function(SNAPSHOT_SOURCE), "the emitted browser payload does not parse");
  // No in-page verdict about the viewport, and no numeric read of a keyword-bearing property.
  assert.doesNotMatch(SNAPSHOT_SOURCE, /viewportUnsupported|transformedGeometry/u);
  assert.doesNotMatch(SNAPSHOT_SOURCE, /(?:parseFloat|nonzeroLength|number)\([^)]*overflowClipMargin/u);
  // Every CTM, bbox and viewport length goes through the pristine references.
  assert.match(SNAPSHOT_SOURCE, /P\.svgGeometry\(textEl\)/u);
  assert.match(SNAPSHOT_SOURCE, /P\.svgViewportLengths\(el\)/u);
  assert.match(SNAPSHOT_SOURCE, /P\.svgCtm\(parentEl\)/u);
  assert.match(SNAPSHOT_SOURCE, /P\.svgScreenCtm\(el\)/u);
  assert.doesNotMatch(SNAPSHOT_SOURCE, /\.(?:getCTM|getScreenCTM|getBBox)\(/u, "a direct SVG geometry call bypasses the captured primitives");
  assert.doesNotMatch(SNAPSHOT_SOURCE, /\.(?:animVal|baseVal)\b/u);
  // The ancestor walk uses the captured nodeType getter, never the author-replaceable property.
  assert.match(SNAPSHOT_SOURCE, /for \(let at = el; at && P\.nodeType\(at\) === 1; at = P\.parent\(at\)\)/u);
  assert.match(SNAPSHOT_SOURCE, /P\.nodeType\(ancestor\) === 1/u);
  assert.doesNotMatch(SNAPSHOT_SOURCE, /(?:viewportAncestor|ancestor|\bat)\.nodeType/u);
  // The facts for the 3D decline and the CDP oracle are collected at all.
  for (const key of ["transform", "rotate", "scale", "translate", "perspective", "offsetPath"]) {
    assert.match(SNAPSHOT_SOURCE, new RegExp(`SVG_TRANSFORM_KEYS = \\[[^\\]]*"${key}"`, "u"));
  }
  assert.match(SNAPSHOT_SOURCE, /svgRendered: renderedSvgs\.length/u);
});

it("captures the SVG matrix, rect and length getters before any document script", () => {
  for (const capture of [
    "SVGGraphicsElement.prototype.getCTM",
    "getter(svgMatrixProto, name)",
    "getter(svgRectProto, name)",
    "getter(SVGSVGElement.prototype, name)",
    'getter(SVGAnimatedLength.prototype, "animVal")',
    'getter(SVGLength.prototype, "value")',
  ]) assert.ok(PRIMITIVES_SOURCE.includes(capture), `not captured: ${capture}`);
  for (const name of ["svgGeometry", "svgCtm", "svgScreenCtm", "svgViewportLengths"]) {
    assert.ok(PRIMITIVES_CHECK.includes(`"${name}"`), `the integrity check does not require ${name}`);
  }
});
