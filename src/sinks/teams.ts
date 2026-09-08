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

import { messageFromBody, readBody, SinkError, type FetchLike } from "./error.ts";
import {
  clip,
  readReport,
  resolveUrl,
  type ChatSink,
  type ChatSinkContext,
  type UrlFrom,
} from "./chat.ts";

/** The schema an Adaptive Card names, and the version Teams is told to read it as. */
export const TEAMS_CARD_SCHEMA = "http://adaptivecards.io/schemas/adaptive-card.json";
export const TEAMS_CARD_VERSION = "1.5";
/** The attachment type a Bot Framework message uses for an Adaptive Card. */
export const TEAMS_CARD_CONTENT_TYPE = "application/vnd.microsoft.card.adaptive";

/**
 * Everything a Workflows webhook accepts in one request, in bytes of UTF-8.
 * Teams refuses a larger message; it does not clip it for you.
 */
export const MAX_TEAMS_MESSAGE_BYTES = 28 * 1024;

/**
 * Per-part clips. Adaptive Cards has no limit of its own on a `TextBlock` — the
 * 28 kB above is the only ceiling — but a card is a thing somebody reads in a
 * channel, so the parts are kept to a readable size before the budget is even
 * consulted.
 */
export const MAX_TEAMS_TITLE = 256;
export const MAX_TEAMS_MESSAGE = 4000;
export const MAX_TEAMS_FACTS = 20;
export const MAX_TEAMS_FACT_TITLE = 256;
export const MAX_TEAMS_FACT_VALUE = 1024;
export const MAX_TEAMS_CONSOLE = 3000;
/** An `Action.OpenUrl` title is a button, and a button is one short line. */
export const MAX_TEAMS_BUTTON_TEXT = 75;

/**
 * How a retired Office 365 connector webhook opens a refusal it answered 200
 * to. Workflows webhooks answer 202 and say nothing, so this only ever matches
 * the old kind — which are still in use, and still worth telling apart from a
 * delivery.
 */
const LEGACY_TEAMS_FAILURE = "Webhook message delivery failed";

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
  screenshotUrl?: UrlFrom;
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
export function escapeTeams(text: string): string {
  return text
    .replace(/[\\*_`[\]~]/g, (c) => `\\${c}`)
    .replace(/^(\s*)([#>+-])/gm, "$1\\$2")
    .replace(/^(\s*\d+)\./gm, "$1\\.");
}

type CardElement = Record<string, unknown>;

/** The parts of a card, so the budget below can rebuild it with fewer of them. */
type CardParts = {
  title: string;
  message: string;
  facts: { title: string; value: string }[];
  consoleText: string | undefined;
  screenshot: string | undefined;
  link: string | undefined;
  buttonText: string;
  footnote: string | undefined;
};

function buildCard(parts: CardParts): Record<string, unknown> {
  const body: CardElement[] = [
    {
      type: "TextBlock",
      text: escapeTeams(parts.title),
      weight: "bolder",
      size: "large",
      wrap: true,
    },
  ];

  if (parts.message) {
    body.push({ type: "TextBlock", text: escapeTeams(parts.message), wrap: true });
  }

  if (parts.facts.length > 0) {
    body.push({
      type: "FactSet",
      facts: parts.facts.map((f) => ({
        title: escapeTeams(f.title),
        value: escapeTeams(f.value),
      })),
    });
  }

  if (parts.consoleText) {
    // No fence: a monospace `TextBlock` is the card's own code block, and a
    // fence inside one would be shown as three backticks.
    body.push({
      type: "TextBlock",
      text: escapeTeams(parts.consoleText),
      fontType: "monospace",
      wrap: true,
    });
  }

  if (parts.screenshot) {
    body.push({
      type: "Image",
      url: parts.screenshot,
      altText: parts.title,
      size: "stretch",
    });
  }

  if (parts.footnote) {
    body.push({
      type: "TextBlock",
      text: escapeTeams(parts.footnote),
      isSubtle: true,
      size: "small",
      wrap: true,
    });
  }

  const card: Record<string, unknown> = {
    $schema: TEAMS_CARD_SCHEMA,
    type: "AdaptiveCard",
    version: TEAMS_CARD_VERSION,
    body,
  };

  if (parts.link) {
    card.actions = [
      { type: "Action.OpenUrl", title: clip(parts.buttonText, MAX_TEAMS_BUTTON_TEXT), url: parts.link },
    ];
  }

  return card;
}

/** Wraps a card in the Bot Framework message a Workflows webhook expects. */
function envelope(card: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "message",
    attachments: [{ contentType: TEAMS_CARD_CONTENT_TYPE, content: card }],
  };
}

const encoder = new TextEncoder();

/** What the request body will actually weigh, which is bytes and not characters. */
export function jsonByteLength(payload: unknown): number {
  return encoder.encode(JSON.stringify(payload)).length;
}

/**
 * Builds the message body. Exported for the tests, which assert the shape
 * rather than a snapshot of it, and useful if you want to post it through a
 * bot rather than a Workflows webhook — the envelope is the same one.
 */
export function buildTeamsMessage(
  report: unknown,
  options: TeamsSinkOptions,
  ctx: ChatSinkContext = {},
): Record<string, unknown> {
  const r = readReport(report);
  const screenshot = resolveUrl(options.screenshotUrl, report, ctx.screenshotUrl);
  const link = resolveUrl(options.reportUrl, report);

  const footnoteParts: string[] = [];
  if (r.timestamp) footnoteParts.push(r.timestamp);
  if (r.selector) footnoteParts.push(r.selector);

  const parts: CardParts = {
    title: clip(r.title, MAX_TEAMS_TITLE),
    message: clip(r.message, MAX_TEAMS_MESSAGE),
    facts: r.facts
      .slice(0, MAX_TEAMS_FACTS)
      .map(([title, value]) => ({
        title: clip(title, MAX_TEAMS_FACT_TITLE),
        value: clip(value, MAX_TEAMS_FACT_VALUE),
      })),
    consoleText: r.consoleText ? clip(r.consoleText, MAX_TEAMS_CONSOLE) : undefined,
    screenshot,
    link,
    buttonText: options.buttonText ?? "Open report",
    footnote: footnoteParts.length > 0 ? footnoteParts.join(" · ") : undefined,
  };

  let payload = envelope(buildCard(parts));
  if (jsonByteLength(payload) <= MAX_TEAMS_MESSAGE_BYTES) return payload;

  // Over budget, and something has to go. The console goes first: it is the
  // longest part and the one the stored report still holds in full. Then the
  // facts from the back, which is the order `readReport` put them in — contact
  // and page before the connection type. The reporter's own words are last,
  // because a truncated sentence still says what went wrong and an absent one
  // says nothing at all.
  if (parts.consoleText) {
    parts.consoleText = undefined;
    payload = envelope(buildCard(parts));
  }

  while (jsonByteLength(payload) > MAX_TEAMS_MESSAGE_BYTES && parts.facts.length > 0) {
    parts.facts = parts.facts.slice(0, -1);
    payload = envelope(buildCard(parts));
  }

  // Then, only if it has to be, an address. Neither can be clipped — half a
  // signed URL is a broken link, not a shorter one — so the question is not
  // whether the card is over the cap now but whether it could ever get under
  // it: the floor is the same card with no console, no facts and no message,
  // and a floor over the budget is an address that has to go. Without this the
  // reporter's words are spent first and the card is refused anyway, which
  // loses the report to keep a link to it.
  const floor = (): number =>
    jsonByteLength(
      envelope(buildCard({ ...parts, facts: [], consoleText: undefined, message: "" })),
    );

  if (floor() > MAX_TEAMS_MESSAGE_BYTES && parts.screenshot) {
    parts.screenshot = undefined;
    payload = envelope(buildCard(parts));
  }

  if (floor() > MAX_TEAMS_MESSAGE_BYTES && parts.link) {
    parts.link = undefined;
    payload = envelope(buildCard(parts));
  }

  while (jsonByteLength(payload) > MAX_TEAMS_MESSAGE_BYTES && parts.message.length > 0) {
    // Every character dropped is at least one byte dropped, so subtracting the
    // overspend in characters always makes progress and usually ends it here.
    // The count has to be `clip`'s own — characters, not UTF-16 units — or a
    // message of emoji would ask for a limit it is already under and the loop
    // would never end.
    const over = jsonByteLength(payload) - MAX_TEAMS_MESSAGE_BYTES;
    const characters = Array.from(parts.message).length;
    parts.message = clip(parts.message, Math.max(0, characters - over - 1));
    payload = envelope(buildCard(parts));
  }

  return payload;
}

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
export function teamsSink(options: TeamsSinkOptions): ChatSink {
  // A webhook address that is not an address is a configuration mistake, and
  // the place to say so is where it was configured — not on the first report,
  // half an hour later, inside a `fetch` failure whose message would quote the
  // value back into a log. `new URL` is the whole check: what it accepts is
  // what `fetch` will accept.
  try {
    new URL(options.webhookUrl);
  } catch {
    throw new SinkError("teamsSink was given a webhookUrl that is not a URL", 0, null);
  }

  return async (report, ctx = {}) => {
    const doFetch = options.fetch ?? globalThis.fetch;
    const response = await doFetch(options.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildTeamsMessage(report, options, ctx)),
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });

    const body = await readBody(response);
    if (!response.ok) {
      const fallback = `Microsoft Teams refused the report with status ${response.status}`;
      throw new SinkError(messageFromBody(body, fallback), response.status, body);
    }
    // The retired Office 365 connector webhooks answer 200 for a refusal and
    // put the reason in the body, so a status check alone reads a lost report
    // as a delivered one. Only the start of the body counts: the phrase is how
    // that endpoint opens its failures, and matching it anywhere would turn a
    // report that merely quotes it into a delivery failure.
    if (typeof body === "string" && body.startsWith(LEGACY_TEAMS_FAILURE)) {
      throw new SinkError(body.trim().slice(0, 200), response.status, body);
    }
  };
}
