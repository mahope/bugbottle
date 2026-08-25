/**
 * bugbottle — in-app bug reports that arrive with the evidence attached.
 *
 * Browser entry point. The server-side validators live in `bugbottle/server`
 * and the React hook in `bugbottle/react`, so a server bundle never pulls in
 * DOM code and a client bundle never pulls in Node code.
 */

export {
  initConsoleBuffer,
  getConsoleBuffer,
  resetConsoleBuffer,
  type ConsoleEntry,
  type ConsoleLevel,
  type ConsoleBufferOptions,
} from "./console-buffer.ts";

export {
  captureScreenshot,
  collectContext,
  ScreenshotTooLargeError,
  type CaptureOptions,
} from "./capture.ts";

export {
  REPORT_TYPES,
  isReportType,
  normaliseMessage,
  normaliseContext,
  MAX_MESSAGE_LENGTH,
  MAX_SCREENSHOT_BYTES,
  MAX_SCREENSHOT_DATA_URL_LENGTH,
  type ReportType,
  type ReportContext,
  type BugReport,
} from "./report-core.ts";
