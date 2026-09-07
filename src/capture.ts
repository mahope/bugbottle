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
 * leave out; `pixelRatio` is 1 for a first attempt and 0.5 for the retry.
 */
export type ScreenshotRenderer = (
  root: HTMLElement,
  options: { filter: (node: Node) => boolean; pixelRatio: number },
) => Promise<string>;

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
 * Renders the current page to a PNG data URL using the given renderer.
 *
 * A high-DPI screen can produce more than a server will accept, so an oversized
 * capture is retried at half scale before giving up — the size of someone's
 * monitor should not decide whether their report goes through.
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

  let dataUrl = await render(root, { filter, pixelRatio: 1 });
  if (dataUrl.length > maxLength) {
    dataUrl = await render(root, { filter, pixelRatio: 0.5 });
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
