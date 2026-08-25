/**
 * Server-side helpers for the endpoint that receives a report.
 *
 * Nothing here touches the DOM, so it is safe in a route handler, a serverless
 * function or a worker. There is no storage adapter on purpose: where the
 * screenshot goes is your decision, and it is the one worth making carefully.
 *
 * One thing worth saying plainly: a screenshot of your application can contain
 * whatever the reporter could see — another person's record, an inbox, a
 * half-written document. Put it somewhere private and serve it back through an
 * authenticated route. Do not give it a public URL.
 */
export { decodeScreenshotDataUrl, InvalidScreenshotError, isReportType, normaliseMessage, normaliseContext, MAX_MESSAGE_LENGTH, MAX_SCREENSHOT_BYTES, MAX_SCREENSHOT_DATA_URL_LENGTH, REPORT_TYPES, type ReportType, type ReportContext, type BugReport, } from "../report-core.ts";
//# sourceMappingURL=index.d.ts.map