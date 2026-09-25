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
  for (const key of ["transform", "rotate", "scale", "translate", "perspective", "offset-path"]) {
    assert.match(SNAPSHOT_SOURCE, new RegExp(`SVG_TRANSFORM_PROPS = \\[[^;]*"${key}"\\]`, "u"));
  }
  assert.match(SNAPSHOT_SOURCE, /svgRendered: renderedSvgs\.length/u);
});

it("reads every computed value of the SVG section through the captured getPropertyValue", () => {
  // A CSSStyleDeclaration property getter lives on the prototype: a document that shadowed
  // overflowClipMargin (or overflowX) turned 570 clipped ink pixels into a clean run. The whole
  // SVG section reads by CSS name through P.css, and no style object is dereferenced by property.
  const start = SNAPSHOT_SOURCE.indexOf("const svg = [];");
  const end = SNAPSHOT_SOURCE.indexOf("return { pages, blocks, textLines, svg");
  assert.ok(start > 0 && end > start, "the SVG section moved");
  const section = SNAPSHOT_SOURCE.slice(start, end);
  assert.doesNotMatch(section, /\b(?:style|svgStyle|ancestorStyle|textStyle)\.[A-Za-z]/u, "a computed value read through a replaceable getter");
  assert.match(section, /const pick = \(style, props\) => \{ const out = \{\}; for \(const \[key, name\] of props\) out\[key\] = P\.css\(style, name\); return out; \};/u);
  for (const name of ["overflow-x", "overflow-y", "overflow-clip-margin", "contain", "content-visibility", "clip-path", "mask-image", "box-sizing"]) {
    assert.match(section, new RegExp(`SVG_BOX_PROPS = \\[[^;]*"${name}"\\]`, "u"), name);
  }
  for (const name of ["fill", "stroke", "stroke-width", "fill-opacity", "text-shadow", "text-decoration-line", "clip-path", "filter"]) {
    assert.ok(section.includes(`P.css(style, "${name}")`) || section.includes(`P.css(ancestorStyle, "${name}")`), name);
  }
  assert.ok(PRIMITIVES_SOURCE.includes("const getPropertyValueFn = CSSStyleDeclaration.prototype.getPropertyValue;"));
  assert.ok(PRIMITIVES_SOURCE.includes("css: (style, name) => call.call(getPropertyValueFn, style, name),"));
  assert.ok(PRIMITIVES_CHECK.includes('"css"'), "the integrity check does not require css");
});

it("ships the HTML ancestors that may clip, up to the page area, and declines per-glyph rotation", () => {
  const start = SNAPSHOT_SOURCE.indexOf("const svg = [];");
  const section = SNAPSHOT_SOURCE.slice(start);
  assert.match(section, /for \(let at = parentEl; at && at !== flowArea && P\.nodeType\(at\) === 1; at = P\.parent\(at\), up \+= 1\)/u);
  assert.match(section, /const flowArea = P\.closest\(el, SVG_FLOW_AREA_SELECTOR\);/u);
  assert.match(section, /ancestors\.push\(\{ up, \.\.\.facts, radii: SVG_RADIUS_PROPS\.map/u);
  assert.match(section, /style: pick\(svgStyle, SVG_BOX_PROPS\), transforms, ancestors,/u);
  assert.match(section, /P\.hasAttr\(textEl, "rotate"\) \|\| P\.all\(textEl, "\[rotate\]"\)\.length > 0/u);
});

it("collects SVG only from the page content area, never from margin-box clones", () => {
  // Up to 0.6.0 the SVG collector read the whole page, so a running element's SVG was collected
  // once per page under one target id and the viewport rule stopped the run (exit 3). The area
  // is the one the block collection keeps (PAGE_AREA_SELECTOR in the paginator's collector).
  assert.match(SNAPSHOT_SOURCE, /const SVG_FLOW_AREA_SELECTOR = "\.pagedjs_pagebox > \.pagedjs_area";/u);
  assert.match(SNAPSHOT_SOURCE, /const svgInFlow = \(el\) => P\.closest\(el, SVG_FLOW_AREA_SELECTOR\) !== null;/u);
  assert.match(SNAPSHOT_SOURCE, /P\.all\(page, "svg"\)\.filter\(svgInFlow\)\.forEach/u);
  assert.doesNotMatch(SNAPSHOT_SOURCE, /P\.all\(page, "svg"\)\.forEach/u, "an unfiltered page-wide SVG query is back");
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
