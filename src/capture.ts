import { MAX_SCREENSHOT_DATA_URL_LENGTH, type ReportContext } from "./report-core.ts";

/**
 * Taking the picture, and describing where it was taken.
 *
 * The screenshot is rendered from the DOM, not from the screen. That is a
 * deliberate limit: it can only ever show the page the reporter is on — never
 * another tab, another window, or the desktop behind it. In an application
 * handling anything confidential that distinction matters, because a
 * screen-capture API cannot make the same promise.
 */

export type CaptureOptions = {
  /**
   * Elements to leave out of the picture. Defaults to anything carrying
   * `data-bugbottle`, so the report panel does not photograph itself.
   */
  exclude?: (node: Node) => boolean;
  /** Longest data URL to produce. Larger captures are retried at half scale. */
  maxDataUrlLength?: number;
  /** Root to render. Defaults to `document.body`. */
  root?: HTMLElement;
};

export class ScreenshotTooLargeError extends Error {
  constructor() {
    super("Screenshot is too large even at reduced scale");
    this.name = "ScreenshotTooLargeError";
  }
}

const defaultExclude = (node: Node): boolean =>
  node instanceof HTMLElement && node.dataset.bugbottle !== undefined;

/**
 * Renders the current page to a PNG data URL.
 *
 * Requires `html-to-image` to be installed; it is loaded on demand, so it stays
 * out of your bundle until someone actually reports something.
 *
 * A high-DPI screen can produce more than a server will accept, so an oversized
 * capture is retried at half scale before giving up — the size of someone's
 * monitor should not decide whether their report goes through.
 */
export async function captureScreenshot(options: CaptureOptions = {}): Promise<string> {
  if (typeof document === "undefined") {
    throw new Error("captureScreenshot requires a browser environment");
  }
  const maxLength = options.maxDataUrlLength ?? MAX_SCREENSHOT_DATA_URL_LENGTH;
  const exclude = options.exclude ?? defaultExclude;
  const root = options.root ?? document.body;

  const { toPng } = await import("html-to-image");
  const filter = (node: Node) => !exclude(node);

  let dataUrl = await toPng(root, { filter, pixelRatio: 1 });
  if (dataUrl.length > maxLength) {
    dataUrl = await toPng(root, { filter, pixelRatio: 0.5 });
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
