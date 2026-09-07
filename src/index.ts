/**
 * bugbottle — in-app bug reports that arrive with the evidence attached.
 *
 * Browser entry point. The server-side validators live in `bugbottle/server`,
 * the React hook in `bugbottle/react`, and the html-to-image screenshot
 * renderer in `bugbottle/html-to-image` — so a server bundle never pulls in
 * DOM code, and a client bundle only pays for what it imports.
 */

export {
  initConsoleBuffer,
  getConsoleBuffer,
  resetConsoleBuffer,
  type ConsoleBufferOptions,
} from "./console-buffer.ts";

export {
  captureScreenshot,
  collectContext,
  ScreenshotTooLargeError,
  type CaptureOptions,
  type ScreenshotRenderer,
} from "./capture.ts";

export {
  pickElement,
  describeElement,
  buildSelector,
  type PickOptions,
} from "./element-picker.ts";

export {
  buildReport,
  sendReport,
  SendFailedError,
  SendTimeoutError,
  DEFAULT_SEND_TIMEOUT_MS,
  type BuildReportInput,
  type SendOptions,
  type SendResult,
} from "./send.ts";

export { toMarkdown, type MarkdownOptions } from "./markdown.ts";

// Its own module, imported by nothing else here, so a bundler drops it whole
// when the integrator does not scrub. See src/scrub.ts.
export {
  scrubReport,
  BUILTIN_SCRUBBERS,
  DEFAULT_REPLACEMENT,
  type ScrubOptions,
  type Scrubber,
  type ScrubberName,
} from "./scrub.ts";

export { type Locale, type Messages, type UiTexts } from "./locales.ts";

export {
  REPORT_TYPES,
  isReportType,
  normaliseMessage,
  normaliseContext,
  normaliseConsole,
  normaliseElements,
  MAX_MESSAGE_LENGTH,
  MAX_SCREENSHOT_BYTES,
  MAX_SCREENSHOT_DATA_URL_LENGTH,
  MAX_CONSOLE_ENTRIES,
  MAX_CONSOLE_MESSAGE_LENGTH,
  MAX_ELEMENTS,
  MAX_ELEMENT_TEXT_LENGTH,
  type ReportType,
  type ReportContext,
  type BugReport,
  type ConsoleEntry,
  type ConsoleLevel,
  type ElementRef,
} from "./report-core.ts";
