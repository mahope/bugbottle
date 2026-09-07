/**
 * bugbottle — in-app bug reports that arrive with the evidence attached.
 *
 * Browser entry point. The server-side validators live in `bugbottle/server`,
 * the React hook in `bugbottle/react`, and the html-to-image screenshot
 * renderer in `bugbottle/html-to-image` — so a server bundle never pulls in
 * DOM code, and a client bundle only pays for what it imports.
 */
export { initConsoleBuffer, getConsoleBuffer, resetConsoleBuffer, } from "./console-buffer.js";
export { captureScreenshot, collectContext, DEFAULT_BYTES_PER_PIXEL_ESTIMATE, ScreenshotTooLargeError, } from "./capture.js";
export { DEFAULT_BLOCK_SELECTOR, DEFAULT_MASK_COLOUR, DEFAULT_MASK_SELECTOR, } from "./mask.js";
export { pickElement, describeElement, buildSelector, } from "./element-picker.js";
export { buildReport, sendReport, SendFailedError, SendTimeoutError, DEFAULT_SEND_TIMEOUT_MS, } from "./send.js";
export { toMarkdown } from "./markdown.js";
// Imported by nothing else here, like the scrubber, so a bundler drops it whole
// when nobody deduplicates. `bugbottle/server` re-exports the same function, so
// both sides of a deduplicated report agree on what "the same report" means.
export { fingerprint, stableHash } from "./fingerprint.js";
// Its own module, imported by nothing else here, so a bundler drops it whole
// when the integrator does not scrub. See src/scrub.ts.
export { scrubReport, scrubUrl, BUILTIN_SCRUBBERS, DEFAULT_REPLACEMENT, } from "./scrub.js";
export {} from "./locales.js";
export { REPORT_TYPES, isReportType, normaliseMessage, normaliseContext, normaliseConsole, normaliseElements, normaliseBreadcrumbs, normaliseNetwork, MAX_MESSAGE_LENGTH, MAX_SCREENSHOT_BYTES, MAX_SCREENSHOT_DATA_URL_LENGTH, MAX_CONSOLE_ENTRIES, MAX_CONSOLE_MESSAGE_LENGTH, MAX_ELEMENTS, MAX_ELEMENT_TEXT_LENGTH, MAX_BREADCRUMBS, MAX_BREADCRUMB_TEXT_LENGTH, MAX_NETWORK_ENTRIES, MAX_STACK_FRAMES, MAX_STACK_STRING_LENGTH, MAX_CONTEXT_LENGTHS, } from "./report-core.js";
//# sourceMappingURL=index.js.map