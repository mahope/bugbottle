/**
 * An optional, ready-made report panel: a floating button and a small dialog,
 * rendered in a shadow root so your styles and its styles never meet.
 *
 * The headless core stays headless. This is a separate entry point
 * (`bugbottle/ui`) for the applications that want something on the page in
 * five minutes and are happy to brand it with a handful of CSS variables and
 * a locale, rather than build a form.
 *
 * Everything the reporter reads comes from a `Locale`; everything they see
 * comes from `Theme` and `Brand`. Custom properties (`--bb-primary` and
 * friends) pierce the shadow root, so a stylesheet can also restyle it from
 * outside without touching JavaScript.
 */
import { type CaptureOptions, type ScreenshotRenderer } from "../capture.ts";
import { type Locale, type Messages, type UiTexts } from "../locales.ts";
import { type ReportType } from "../report-core.ts";
import type { Queue } from "../queue.ts";
import { type BuildReportInput, type SendOptions } from "../send.ts";
export type Theme = {
    /** Accent: trigger button, primary action, focus ring. */
    primary?: string;
    /** Text on the accent colour. */
    onPrimary?: string;
    background?: string;
    text?: string;
    /** Secondary text: intro, notes, status. */
    muted?: string;
    border?: string;
    /** Border radius of the panel and controls, e.g. `"12px"`. */
    radius?: string;
    /** Font stack. Defaults to the system UI font. */
    font?: string;
    shadow?: string;
    zIndex?: number;
    position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
    /** `"auto"` follows `prefers-color-scheme`. Default `"auto"`. */
    scheme?: "light" | "dark" | "auto";
};
export type Brand = {
    /** Shown in the panel header. Defaults to the locale's title. */
    name?: string;
    /** An image URL, or an inline `<svg>…</svg>` string. Shown before the title and on the trigger. */
    logo?: string;
};
type DeepPartial<T> = {
    [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};
export type MountOptions = {
    /** Endpoint that receives the report. Required. */
    endpoint: string;
    /** How to take the picture. Without it the screenshot row is not rendered. */
    screenshot?: ScreenshotRenderer;
    /** A bundled locale from `bugbottle/locales`, or your own. Default English. */
    locale?: Locale;
    /** Override individual labels of the locale. */
    texts?: DeepPartial<UiTexts>;
    /** Override individual status messages of the locale. */
    messages?: Partial<Messages>;
    theme?: Theme;
    brand?: Brand;
    /** Which report types to offer. Default all three. */
    types?: readonly ReportType[];
    initialType?: ReportType;
    /** Attach the console buffer. Default: for bugs only. */
    consoleFor?: (type: ReportType) => boolean;
    /** Tick the screenshot box by default. Default: for bugs only. */
    screenshotFor?: (type: ReportType) => boolean;
    /**
     * What to hide in the screenshot. Field values, `contenteditable` text and
     * the `data-bugbottle-mask` / `data-bugbottle-block` regions are masked by
     * default; pass an object to narrow it, or `false` to photograph the page as
     * the reporter sees it. See `CaptureOptions["mask"]`.
     */
    mask?: CaptureOptions["mask"];
    /** Offer the element picker. Default true. */
    elementPicker?: boolean;
    /**
     * `false` renders no floating button — call `open()` from your own control.
     * An element or selector makes that element the trigger instead.
     */
    trigger?: false | HTMLElement | string;
    /** Where to mount. Default `document.body`. */
    container?: HTMLElement;
    /** Extra fields merged into every report — app version, tenant id. */
    extra?: Record<string, unknown>;
    headers?: SendOptions["headers"];
    credentials?: SendOptions["credentials"];
    timeoutMs?: SendOptions["timeoutMs"];
    /**
     * Replace the global `fetch`. Mostly for tests and for demonstrations that
     * have no endpoint to talk to.
     */
    fetch?: SendOptions["fetch"];
    parseError?: SendOptions["parseError"];
    /**
     * Redact the assembled report before it is sent. Pass the scrubber:
     * `import { scrubReport } from "bugbottle"; scrub: scrubReport`.
     */
    scrub?: BuildReportInput["scrub"];
    /**
     * Last look at the report. Return it, a changed copy, or `null` to drop it.
     * A dropped report still shows the reporter the ordinary thank-you panel.
     */
    beforeSend?: SendOptions["beforeSend"];
    /**
     * Where a report goes when the send fails. Pass a queue from
     * `bugbottle/queue` and the reporter is thanked with the `queued` message
     * rather than shown an error; the report is delivered when the browser is
     * online again. A 4xx is never queued — the server has already refused it.
     */
    queue?: Queue;
    onSent?: (id: string | undefined) => void;
    onError?: (error: unknown) => void;
};
export type BugbottleWidget = {
    open(): void;
    close(): void;
    toggle(): void;
    /** Removes the widget and its listeners. */
    destroy(): void;
    /** The element carrying the shadow root. Set `--bb-*` custom properties here. */
    host: HTMLElement;
    /** Swap language at runtime. */
    setLocale(locale: Locale): void;
};
/** Mounts the panel and returns a handle. Call once per page. */
export declare function mountBugbottle(options: MountOptions): BugbottleWidget;
export {};
//# sourceMappingURL=index.d.ts.map