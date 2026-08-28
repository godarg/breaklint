import { strict as assert } from "node:assert";
import { it } from "node:test";

import { SNAPSHOT_SOURCE } from "../../src/measure/snapshot.ts";

it("the injected SVG collector rejects transformed viewport ancestors", () => {
  assert.doesNotThrow(() => new Function(SNAPSHOT_SOURCE), "the emitted browser payload does not parse");
  for (const property of ["transform", "rotate", "scale", "translate", "perspective", "offsetPath"]) {
    assert.match(SNAPSHOT_SOURCE, new RegExp(`effect\\(style\\.${property}\\)`, "u"));
  }
  assert.match(SNAPSHOT_SOURCE, /let viewportAncestor = P\.parent\(el\)/u);
  assert.match(
    SNAPSHOT_SOURCE,
    /while \(!viewportUnsupported && viewportAncestor && P\.nodeType\(viewportAncestor\) === 1\)[\s\S]*transformedGeometry\(P\.style\(viewportAncestor, null\)\)/u,
  );
  assert.match(SNAPSHOT_SOURCE, /P\.nodeType\(ancestor\) === 1/u);
  assert.doesNotMatch(SNAPSHOT_SOURCE, /(?:viewportAncestor|ancestor)\.nodeType/u);
});
