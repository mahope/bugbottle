/**
 * Posting a report to Microsoft Teams as an Adaptive Card.
 *
 * The Office 365 connector webhooks that used to take a `MessageCard` are
 * retired, so the way into a channel now is a Workflows webhook — "post to a
 * channel when a webhook request is received" — which takes a Bot Framework
 * message with the card as an attachment rather than the card on its own:
 *
 * ```json
 * { "type": "message",
 *   "attachments": [{ "contentType": "application/vnd.microsoft.card.adaptive",
 *                     "content": { "type": "AdaptiveCard", "version": "1.5", … } }] }
 * ```
 *
 * Workflows answers a good post with `202 Accepted` and an empty body, which
 * only says the flow was queued; a card the renderer dislikes fails silently
 * afterwards. So everything below is built to be accepted rather than to be
 * argued with: one card, no inputs, no `Action.Submit`.
 *
 * Schema checked on 2026-09-08 against the Adaptive Cards documentation hub
 * (adaptivecards.io redirects to adaptivecards.microsoft.com) and Microsoft
 * Learn's card reference: Teams renders schema 1.6 or earlier, this card
 * declares 1.5 because that is what the Workflows path is documented for, and
 * an Incoming Webhook or Workflows message is capped at 28 kB — bots get
 * 100 kB, webhooks do not. Over that the request is refused outright, so the
 * cap here is a budget rather than a hope.
 *
 * The webhook URL is the credential. Anyone holding it can post to that
 * channel, so it belongs on the server and nowhere else.
 */
import { type FetchLike } from "./error.ts";
import { type ChatSink, type ChatSinkContext, type UrlFrom } from "./chat.ts";
/** The schema an Adaptive Card names, and the version Teams is told to read it as. */
export declare const TEAMS_CARD_SCHEMA = "http://adaptivecards.io/schemas/adaptive-card.json";
export declare const TEAMS_CARD_VERSION = "1.5";
/** The attachment type a Bot Framework message uses for an Adaptive Card. */
export declare const TEAMS_CARD_CONTENT_TYPE = "application/vnd.microsoft.card.adaptive";
/**
 * Everything a Workflows webhook accepts in one request, in bytes of UTF-8.
 * Teams refuses a larger message; it does not clip it for you.
 */
export declare const MAX_TEAMS_MESSAGE_BYTES: number;
/**
 * Per-part clips. Adaptive Cards has no limit of its own on a `TextBlock` — the
 * 28 kB above is the only ceiling — but a card is a thing somebody reads in a
 * channel, so the parts are kept to a readable size before the budget is even
 * consulted.
 */
export declare const MAX_TEAMS_TITLE = 256;
export declare const MAX_TEAMS_MESSAGE = 4000;
export declare const MAX_TEAMS_FACTS = 20;
export declare const MAX_TEAMS_FACT_TITLE = 256;
export declare const MAX_TEAMS_FACT_VALUE = 1024;
export declare const MAX_TEAMS_CONSOLE = 3000;
/** An `Action.OpenUrl` title is a button, and a button is one short line. */
export declare const MAX_TEAMS_BUTTON_TEXT = 75;
export type TeamsSinkOptions = {
    /**
     * The Workflows webhook URL, from "post to a channel when a webhook request
     * is received". Treat it as a secret.
     */
    webhookUrl: string;
    /**
     * Where the screenshot can be fetched. Teams fetches the URL itself, so a
     * data URL is no use and is ignored; store the picture first and return its
     * address. Read the privacy note in the README before that address becomes
     * a public one.
     */
    screenshotUrl?: string;
    /** Picks the screenshot address out of the report, when it travels there. */
    screenshotUrlFrom?: UrlFrom;
    /** A link to the full report in your own tool, shown as an `Action.OpenUrl`. */
    reportUrl?: UrlFrom;
    /** The text on that button. Default "Open report". */
    buttonText?: string;
    /** Injected `fetch`, for tests or a runtime with its own client. */
    fetch?: FetchLike;
};
/**
 * A `TextBlock` renders a subset of Markdown — emphasis, code, links, lists —
 * so a report that mentions `*.tsx` or a `[bracket]` would come out as markup.
 * Every character that can start something is backslash-escaped, which is what
 * the Markdown parser behind a card understands, and the line-start forms are
 * escaped separately because a leading `-` or `#` only means a list or a
 * heading where a line begins.
 *
 * Escaping happens after the clipping, never before: a clip through the middle
 * of `\*` would leave a stray backslash on screen.
 */
export declare function escapeTeams(text: string): string;
/** What the request body will actually weigh, which is bytes and not characters. */
export declare function jsonByteLength(payload: unknown): number;
/**
 * Builds the message body. Exported for the tests, which assert the shape
 * rather than a snapshot of it, and useful if you want to post it through a
 * bot rather than a Workflows webhook — the envelope is the same one.
 */
export declare function buildTeamsMessage(report: unknown, options: TeamsSinkOptions, ctx?: ChatSinkContext): Record<string, unknown>;
/**
 * A sink that posts one Adaptive Card per report to a Microsoft Teams
 * Workflows webhook. Resolves on any 2xx — Workflows answers 202 with an empty
 * body — throws `SinkError` carrying the status and the response body on
 * anything else, and lets network failures from `fetch` propagate as they are.
 * A 200 whose body opens with a legacy connector's delivery failure is a
 * refusal too, whatever the status says. `webhookUrl` is checked with
 * `new URL` here, so a mistyped address fails at wiring time rather than on
 * the first report.
 *
 * ```ts
 * handleReport(req, { sinks: [teamsSink({ webhookUrl: process.env.TEAMS_URL! })] });
 * ```
 */
export declare function teamsSink(options: TeamsSinkOptions): ChatSink;
//# sourceMappingURL=teams.d.ts.map