/**
 * One ownership order for the renderer pair.
 *
 * The rasterizer owns a page inside the browser. Starting `Browser.close()` in the same tick as
 * `Page.close()` races the browser-wide shutdown against CDP's `Target.closeTarget` request. Give
 * the child target an orderly head start, while still allowing a hung child close to fall through
 * to the independently bounded browser cleanup.
 */

export const RASTERIZER_CLOSE_HEAD_START_MS = 250;

export interface RendererCleanupResult {
  rasterizerError: string | null;
  browserError: string | null;
}

export async function closeRendererOwnedResourcesBounded(
  closeRasterizer: () => Promise<string | null>,
  closeBrowser: () => Promise<string | null>,
  headStartMs = RASTERIZER_CLOSE_HEAD_START_MS,
): Promise<RendererCleanupResult> {
  const rasterizerClose = closeRasterizer();
  const browserClose = (async () => {
    await Promise.race([
      rasterizerClose.then(() => undefined, () => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, headStartMs)),
    ]);
    return closeBrowser();
  })();
  const [rasterizerError, browserError] = await Promise.all([rasterizerClose, browserClose]);
  return { rasterizerError, browserError };
}
