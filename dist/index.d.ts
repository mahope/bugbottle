/**
 * bugbottle — in-app bug reports that arrive with the evidence attached.
 *
 * Browser entry point. The server-side validators live in `bugbottle/server`,
 * the React hook in `bugbottle/react`, and the html-to-image screenshot
 * renderer in `bugbottle/html-to-image` — so a server bundle never pulls in
 * DOM code, and a client bundle only pays for what it imports.
 */
export { initConsoleBuffer, getConsoleBuffer, resetConsoleBuffer, type ConsoleBufferOptions, } from "./console-buffer.ts";
export { captureScreenshot, collectContext, DEFAULT_BYTES_PER_PIXEL_ESTIMATE, ScreenshotTooLargeError, type CaptureInfo, type CaptureOptions, type ScreenshotRenderer, } from "./capture.ts";
export { DEFAULT_BLOCK_SELECTOR, DEFAULT_MASK_COLOUR, DEFAULT_MASK_SELECTOR, type MaskOptions, } from "./mask.ts";
export { pickElement, describeElement, buildSelector, type PickOptions, } from "./element-picker.ts";
export { buildReport, sendReport, SendFailedError, SendTimeoutError, DEFAULT_SEND_TIMEOUT_MS, type BuildReportInput, type SendOptions, type SendResult, } from "./send.ts";
export { toMarkdown, type MarkdownOptions } from "./markdown.ts";
export { fingerprint, stableHash, type FingerprintInput } from "./fingerprint.ts";
export { scrubReport, scrubUrl, BUILTIN_SCRUBBERS, DEFAULT_REPLACEMENT, type ScrubOptions, type Scrubber, type ScrubberName, } from "./scrub.ts";
export { type Locale, type Messages, type UiTexts, type EmailTexts } from "./locales.ts";
export { REPORT_TYPES, isReportType, normaliseMessage, normaliseContact, normaliseContext, normaliseConsole, normaliseElements, normaliseBreadcrumbs, normaliseNetwork, normalisePerf, normaliseReplay, normaliseStorage, MAX_MESSAGE_LENGTH, MAX_CONTACT_LENGTH, MAX_SCREENSHOT_BYTES, MAX_SCREENSHOT_DATA_URL_LENGTH, MAX_CONSOLE_ENTRIES, MAX_CONSOLE_MESSAGE_LENGTH, MAX_ELEMENTS, MAX_ELEMENT_TEXT_LENGTH, MAX_BREADCRUMBS, MAX_BREADCRUMB_TEXT_LENGTH, MAX_NETWORK_ENTRIES, MAX_STORAGE_KEYS, MAX_STORAGE_KEY_LENGTH, MAX_STORAGE_VALUE_LENGTH, MAX_STORAGE_VALUES, MAX_COOKIE_NAMES, MAX_PERF_MS, MAX_REPLAY_BYTES, MAX_REPLAY_EVENTS, MAX_STACK_FRAMES, MAX_STACK_STRING_LENGTH, MAX_CONTEXT_LENGTHS, type ReportType, type ReportContext, type BugReport, type ConsoleEntry, type ConsoleLevel, type StackFrame, type ElementRef, type Breadcrumb, type BreadcrumbKind, type NetworkEntry, type PerfSnapshot, type StorageKeyRef, type StorageSnapshot, type ReplayEvent, type ReplayCapture, } from "./report-core.ts";
//# sourceMappingURL=index.d.ts.map