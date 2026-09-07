/**
 * Every string a reporter can see, in one shape, in several languages.
 *
 * `messages` are the status lines the hook and `bugbottle/ui` show after
 * something happens. `ui` are the labels the optional widget renders. Both are
 * plain objects: spread one and override what you like, or write your own
 * from scratch — the types tell you what is required.
 *
 *     import { da } from "bugbottle/locales";
 *     useBugReport({ endpoint, messages: da.messages });
 *     mountBugbottle({ endpoint, locale: { ...da, ui: { ...da.ui, title: "Hjælp os" } } });
 */
export type Messages = {
    empty: string;
    screenshotTooLarge: string;
    screenshotFailed: string;
    sendFailed: string;
    sent: string;
    /** After a failed send that an offline queue caught. See `bugbottle/queue`. */
    queued: string;
};
export type UiTexts = {
    /** Text on the floating trigger button, and its accessible name. */
    trigger: string;
    /** Heading of the panel. */
    title: string;
    /** Short line under the heading. Empty string hides it. */
    intro: string;
    types: {
        bug: string;
        idea: string;
        other: string;
    };
    messageLabel: string;
    messagePlaceholder: string;
    screenshot: string;
    /** Shown next to the screenshot checkbox; say what the picture may contain. */
    screenshotNote: string;
    pickElement: string;
    picking: string;
    attached: string;
    remove: string;
    send: string;
    sending: string;
    close: string;
    /** Shown after a successful send, with a button to close. */
    thanks: string;
    /**
     * Replaces `intro` when the panel was opened by an uncaught error rather
     * than by the reporter. It has to explain itself: nobody asked for a panel.
     */
    openedByError: string;
};
/**
 * The wording of a report sent on by email — read by whoever receives it, not
 * by the reporter, but written in the same language so a Danish team is not
 * handed an English subject line.
 */
export type EmailTexts = {
    /** Subject line. `{title}` is replaced with the report's title. */
    subject: string;
    /** One line above the rendered report. */
    intro: string;
};
export type Locale = {
    /** BCP 47 tag, set on the panel's `lang` attribute. */
    code: string;
    /** `rtl` for Arabic, Hebrew and the like. Default `ltr`. */
    dir?: "ltr" | "rtl";
    messages: Messages;
    ui: UiTexts;
    email: EmailTexts;
};
/**
 * The English status messages on their own, so the React hook can fall back
 * to them without carrying the widget labels of every locale in its bundle.
 */
export declare const enMessages: Messages;
export declare const en: Locale;
export declare const da: Locale;
export declare const sv: Locale;
export declare const nb: Locale;
export declare const de: Locale;
export declare const nl: Locale;
export declare const fr: Locale;
export declare const es: Locale;
/** Every bundled locale, keyed by code. */
export declare const locales: Record<string, Locale>;
/**
 * Picks a bundled locale for a language tag — `"da-DK"` gives Danish,
 * `"pt-BR"` falls back to English. Pass `navigator.language` to follow the
 * browser.
 */
export declare function resolveLocale(tag: string | undefined | null, fallback?: Locale): Locale;
//# sourceMappingURL=locales.d.ts.map