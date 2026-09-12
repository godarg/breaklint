/** Closed embedded-font continuity witness; system/fallback fonts remain unavailable. */
import type { PageLike, CdpSessionLike } from "../acquire/browser.ts";
import type { DocumentFontIdentity, ResourceRecord } from "../core/types.ts";
import { createHash } from "node:crypto";
/** Closed inline-font syntax; no broad data-URL or command interpretation. */
export function inlineFontDigest(value: string): string | null {
  const match = /^data:(?:font\/(?:ttf|otf|woff|woff2)|application\/(?:x-font-ttf|font-woff));base64,([A-Za-z0-9+/]+={0,2})$/u.exec(value);
  if (!match || match[1]!.length > 14 * 1024 * 1024) return null;
  const bytes = Buffer.from(match[1]!, "base64");
  if (bytes.toString("base64") !== match[1]) return null;
  return createHash("sha256").update(bytes).digest("hex");
}
const SESSIONS = new WeakMap<PageLike, CdpSessionLike>();
export async function prepareCapturedFontIdentity(page: PageLike): Promise<void> {
  if (!page.createCDPSession) return;
  const session = await page.createCDPSession();
  try { await session.send("DOM.enable"); await session.send("CSS.enable"); SESSIONS.set(page, session); }
  catch { await session.detach(); }
}
export async function releaseCapturedFontIdentity(page: PageLike): Promise<void> {
  const session = SESSIONS.get(page); SESSIONS.delete(page);
  if (session) await session.detach();
}
export async function measureCapturedFontIdentity(page: PageLike, original: string, resources: readonly ResourceRecord[], sourceFiles: readonly { sha256: string; role: string }[]): Promise<DocumentFontIdentity> {
  const unavailable: DocumentFontIdentity = { status: "unavailable", complete: false, fonts: [], reason: "fonts/actual-byte-identity-unavailable" };
  if (!page.createCDPSession || /<(?:script|iframe|object|embed)\b|\son[a-z]+\s*=/iu.test(original)) return unavailable;
  let diagnostic: NonNullable<DocumentFontIdentity["diagnostic"]> = "css-source";
  try {
    const faces = await page.evaluate<string[]>(`(() => {
      const urls = []; const seen = new Set();
      const walk = sheet => {
        if (seen.has(sheet)) return; seen.add(sheet);
        for (const rule of sheet.cssRules) {
          if (rule.type === 3) { walk(rule.styleSheet); continue; }
          if (rule.type !== 5) continue;
          const src = rule.style.getPropertyValue('src');
          const matches = [...src.matchAll(/url\\(\\s*['"]?([^'"()\\s]+)['"]?\\s*\\)/g)];
          if (!matches.length || /local\\(|blob:/i.test(src)) throw new Error('unsupported font source');
          for (const match of matches) { const url = new URL(match[1], sheet.href || document.baseURI); urls.push(url.protocol === 'data:' ? url.href : url.pathname); }
        }
      };
      for (const sheet of document.styleSheets) walk(sheet);
      return [...new Set(urls)].sort();
    })()`);
    if (faces.length === 0 || faces.length > 128) return unavailable;
    diagnostic = "source-inventory";
    const fonts = faces.map(path => {
      const sha256 = inlineFontDigest(path);
      if (sha256 && sourceFiles.some(f => f.role !== "authoring" && f.sha256 === sha256)) return { resolvedUri: `inline-font:${sha256}`, sha256 };
      return resources.find(r => r.resolvedUri === `artifact:${path}` && r.outcome === "loaded" && r.sha256 && sourceFiles.some(f => f.role !== "authoring" && f.sha256 === r.sha256));
    });
    if (fonts.some(font => !font)) return { ...unavailable, diagnostic };
    diagnostic = "cdp-readback";
    const session = SESSIONS.get(page);
    if (!session) return { ...unavailable, diagnostic };
    try {
      const { root } = await session.send<{ root: { nodeId: number } }>("DOM.getDocument", { depth: -1 });
      const { nodeIds } = await session.send<{ nodeIds: number[] }>("DOM.querySelectorAll", { nodeId: root.nodeId, selector: ".pagedjs_page_content, .pagedjs_page_content *" });
      if (nodeIds.length === 0 || nodeIds.length > 2_000) return unavailable;
      const used: { familyName: string; isCustomFont: boolean; glyphCount: number }[] = [];
      // The CDP call accounts for this element's text, not a sampled descendant inventory.
      for (const nodeId of nodeIds) {
        const result = await session.send<{ fonts: { familyName: string; isCustomFont: boolean; glyphCount: number }[] }>("CSS.getPlatformFontsForNode", { nodeId });
        used.push(...result.fonts.filter(font => font.glyphCount > 0));
      }
      if (used.length === 0 || used.some(font => !font.isCustomFont)) return { ...unavailable, diagnostic: "system-or-fallback" };
      return { status: "verified", complete: true, reason: null,
        fonts: fonts.map(font => ({ resource: font!.resolvedUri, sha256: font!.sha256! })),
        actualFamilies: [...new Set(used.map(font => font.familyName))].sort(), method: "captured-css-fonts-and-cdp-custom-glyphs-v1" };
    } finally { await releaseCapturedFontIdentity(page); }
  } catch { return { ...unavailable, diagnostic }; }
}
