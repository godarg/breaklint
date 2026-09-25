/**
 * The text of a URL reference as the browser's URL parser reads it, and the document base it may
 * resolve against. Shared by the source collector (`src/measure/snapshot.ts`), local asset
 * discovery (`src/acquire/render-run.ts`) and `artifact/local-uri`, so that the three agree on
 * what a reference is.
 */

/**
 * The WHATWG URL parser's input preprocessing: leading and trailing C0 controls and spaces are
 * stripped, and every ASCII tab, LF and CR is removed wherever it occurs. `String.prototype.trim`
 * is not that: it keeps a leading U+0001 and a `\n` inside `fi\nle:`, and it removes U+00A0,
 * which the URL parser keeps (and percent-encodes into a relative path).
 */
export function urlInputText(raw: string): string {
  return raw.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/gu, "").replace(/[\t\n\r]/gu, "");
}

/** The authored scheme, lower-cased, or "" for a reference without one. */
export function authoredScheme(text: string): string {
  return /^([A-Za-z][A-Za-z0-9+.-]*):/u.exec(text)?.[1]?.toLowerCase() ?? "";
}

/**
 * A `<base href>` value as a published document base: an absolute http(s) URL, or null. A relative,
 * protocol-relative or file: base still resolves into the local tree, and the browser refuses a
 * data: or javascript: base, so none of those is applied.
 */
export function publishedBaseUrl(href: string): URL | null {
  try {
    const url = new URL(urlInputText(href));
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}
