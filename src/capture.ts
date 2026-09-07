import { applyMask, type MaskOptions } from "./mask.ts";
import { MAX_SCREENSHOT_DATA_URL_LENGTH, type ReportContext } from "./report-core.ts";

/**
 * Taking the picture, and describing where it was taken.
 *
 * The screenshot is rendered from the DOM, not from the screen. That is a
 * deliberate limit: it can only ever show the page the reporter is on — never
 * another tab, another window, or the desktop behind it. In an application
 * handling anything confidential that distinction matters, because a
 * screen-capture API cannot make the same promise.
 *
 * The renderer is passed in rather than imported. A bundler resolves every
 * import it can see, optional or not, so importing `html-to-image` here would
 * make it a hard dependency for everyone — including the applications that
 * never take a picture. `bugbottle/html-to-image` exports a ready-made
 * renderer; import it only where you want screenshots.
 */

/**
 * Renders an element to a PNG data URL. `filter` returns false for nodes to
 * leave out; `pixelRatio` is the scale to render at — 1 for a full-scale
 * capture and 0.5 for the reduced one.
 */
export type ScreenshotRenderer = (
  root: HTMLElement,
  options: { filter: (node: Node) => boolean; pixelRatio: number },
) => Promise<string>;

/** What one call to `captureScreenshot` cost, and what it settled on. */
export type CaptureInfo = {
  /** The scale the returned picture was rendered at. */
  pixelRatio: number;
  /** Length of the resulting data URL, in characters. */
  length: number;
  /** Renders performed: 1 when the scale was right the first time, 2 after a retry. */
  attempts: number;
  /** Wall-clock milliseconds spent rendering. */
  ms: number;
};

export type CaptureOptions = {
  /**
   * Elements to leave out of the picture. Defaults to anything carrying
   * `data-bugbottle`, so the report panel does not photograph itself.
   */
  exclude?: (node: Node) => boolean;
  /**
   * What to hide before the picture is taken. On by default: input and
   * textarea values, `contenteditable` text, the text of anything marked
   * `data-bugbottle-mask`, and a solid overlay over anything marked
   * `data-bugbottle-block`. The elements stay where they are, so the layout of
   * the screenshot is unchanged — unlike `exclude`, which removes the node.
   *
   * Pass an object to narrow it, or `false` to photograph the page as it is.
   * Everything is restored the moment the renderer returns, including when it
   * throws.
   */
  mask?: MaskOptions | false;
  /** Longest data URL to produce. Larger captures are retried at half scale. */
  maxDataUrlLength?: number;
  /** Root to render. Defaults to `document.body`. */
  root?: HTMLElement;
  /**
   * Force a scale instead of estimating one. A value above the reduced scale
   * still gets the one retry; anything at or below it is taken as final.
   * Ignored unless it is a finite number greater than zero.
   */
  pixelRatio?: number;
  /**
   * Bytes of PNG assumed per CSS pixel when estimating whether a full-scale
   * capture would fit. See `DEFAULT_BYTES_PER_PIXEL_ESTIMATE`.
   */
  bytesPerPixelEstimate?: number;
  /**
   * Called once per capture with the scale used, the size produced, how many
   * renders it took and how long they took. Called for a rejected capture too,
   * just before `ScreenshotTooLargeError` is thrown, so a caller measuring
   * capture time sees the expensive cases as well as the cheap ones. Anything
   * it throws is ignored: reporting must never break the picture.
   */
  onCapture?: (info: CaptureInfo) => void;
};

export class ScreenshotTooLargeError extends Error {
  constructor() {
    super("Screenshot is too large even at reduced scale");
    this.name = "ScreenshotTooLargeError";
  }
}

/**
 * Bytes of encoded PNG assumed per CSS pixel of capture area.
 *
 * A typical application UI is flat colour, straight edges and text, which is
 * exactly what PNG's filtering and DEFLATE compress well: measured captures of
 * ordinary pages land well under half a byte per pixel, and only pages that are
 * mostly photographs approach one. Half a byte is therefore a deliberately
 * pessimistic first guess — it over-estimates the common case, so the estimate
 * errs towards the reduced scale rather than towards a wasted full-scale
 * render. The retry still exists for when it guesses low; this only decides
 * which scale we try first. Applications that know their own pages can pass
 * `bytesPerPixelEstimate`.
 */
export const DEFAULT_BYTES_PER_PIXEL_ESTIMATE = 0.5;

/** The scale an oversized capture falls back to. */
const REDUCED_PIXEL_RATIO = 0.5;

/** `data:image/png;base64,` — the part of the data URL that is not payload. */
const DATA_URL_PREFIX_LENGTH = 22;

const defaultExclude = (node: Node): boolean =>
  node instanceof HTMLElement && node.dataset.bugbottle !== undefined;

const now = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

/**
 * Estimated length of the data URL a full-scale capture of `root` would
 * produce, or `undefined` when the root does not report a usable size.
 *
 * Base64 turns three bytes into four characters, so the encoded length is the
 * byte estimate times 4/3 plus the `data:` prefix.
 */
function estimateDataUrlLength(root: HTMLElement, bytesPerPixel: number): number | undefined {
  const width = root.scrollWidth;
  const height = root.scrollHeight;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  return Math.ceil((width * height * bytesPerPixel * 4) / 3) + DATA_URL_PREFIX_LENGTH;
}

/**
 * Renders the current page to a PNG data URL using the given renderer.
 *
 * Rendering is expensive and the cost is almost all in walking the live DOM and
 * inlining its styles; the scale only affects the final raster step, so a retry
 * costs about as much as the first attempt did. On a page that was never going
 * to fit, that doubles the reporter's wait for nothing. So the scale is chosen
 * up front from the capture area — cheap to read, and roughly what decides the
 * size — and the retry is kept only as the safety net for when that guess is
 * wrong.
 */
export async function captureScreenshot(
  render: ScreenshotRenderer,
  options: CaptureOptions = {},
): Promise<string> {
  if (typeof document === "undefined") {
    throw new Error("captureScreenshot requires a browser environment");
  }
  const maxLength = options.maxDataUrlLength ?? MAX_SCREENSHOT_DATA_URL_LENGTH;
  const exclude = options.exclude ?? defaultExclude;
  const root = options.root ?? document.body;
  const filter = (node: Node) => !exclude(node);

  const forced = options.pixelRatio;
  const bytesPerPixel =
    typeof options.bytesPerPixelEstimate === "number" &&
    Number.isFinite(options.bytesPerPixelEstimate) &&
    options.bytesPerPixelEstimate > 0
      ? options.bytesPerPixelEstimate
      : DEFAULT_BYTES_PER_PIXEL_ESTIMATE;

  let pixelRatio: number;
  if (typeof forced === "number" && Number.isFinite(forced) && forced > 0) {
    pixelRatio = forced;
  } else {
    const estimate = estimateDataUrlLength(root, bytesPerPixel);
    // An unknown size is treated as small: full scale is the better picture,
    // and the retry covers us if it turns out not to fit.
    pixelRatio = estimate !== undefined && estimate > maxLength ? REDUCED_PIXEL_RATIO : 1;
  }

  const started = now();
  let attempts = 1;
  let dataUrl: string;
  // Masking is applied once and covers the retry too: the second render is the
  // same picture at a different scale, and unmasking between the two would put
  // the reporter's data in the very capture we keep.
  const restore = options.mask === false ? undefined : applyMask(root, options.mask ?? {});
  try {
    dataUrl = await render(root, { filter, pixelRatio });
    if (dataUrl.length > maxLength && pixelRatio > REDUCED_PIXEL_RATIO) {
      pixelRatio = REDUCED_PIXEL_RATIO;
      attempts += 1;
      dataUrl = await render(root, { filter, pixelRatio });
    }
  } finally {
    // A renderer that throws leaves the page masked otherwise, and a form full
    // of bullets is worse than a missing screenshot.
    restore?.();
  }
  const ms = now() - started;

  if (options.onCapture) {
    try {
      options.onCapture({ pixelRatio, length: dataUrl.length, attempts, ms });
    } catch {
      // A misbehaving callback is not a reason to lose the screenshot.
    }
  }

  if (dataUrl.length > maxLength) {
    throw new ScreenshotTooLargeError();
  }
  return dataUrl;
}

/** Where the reporter is, and in what. Safe to call outside a browser. */
export function collectContext(): ReportContext {
  if (typeof window === "undefined") {
    return { url: "", viewport: "", userAgent: "" };
  }
  return {
    url: window.location.pathname + window.location.search,
    viewport: `${window.innerWidth}x${window.innerHeight}`,
    userAgent: navigator.userAgent,
  };
}
