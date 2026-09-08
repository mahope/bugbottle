/**
 * Posting a report to a Discord incoming webhook as an embed.
 *
 * `sendReportWebhook(..., { format: "discord" })` sends the Markdown as plain
 * `content`, which Discord clips at 2000 characters and renders as a wall.
 * An embed has four times the room, a colour by report type, the facts in
 * columns and a picture — which is the difference between a channel people
 * skim and one they act on.
 *
 * The webhook URL is the credential; keep it on the server.
 *
 * Discord answers a good post with 204 and no body, and a bad one with a JSON
 * error. Every limit below is a clip rather than a failure, and the total
 * 6000-character budget is spent on the description last, because the facts
 * are what somebody triages from.
 */
import { messageFromBody, readBody, SinkError } from "./error.js";
import { clip, readReport, resolveUrl, } from "./chat.js";
/** Per-part limits Discord enforces on an embed. */
export const MAX_DISCORD_EMBED_TITLE = 256;
export const MAX_DISCORD_EMBED_DESCRIPTION = 4096;
export const MAX_DISCORD_EMBED_FIELDS = 25;
export const MAX_DISCORD_FIELD_NAME = 256;
export const MAX_DISCORD_FIELD_VALUE = 1024;
export const MAX_DISCORD_FOOTER_TEXT = 2048;
/** And the one across all of them at once. */
export const MAX_DISCORD_EMBED_TOTAL = 6000;
/**
 * Colour down the left edge of the embed, so the type is legible before a
 * word is read. Red for a bug, green for an idea, grey for anything else.
 */
export const DISCORD_COLOURS = {
    bug: 0xd7263d,
    idea: 0x2fa84f,
    other: 0x8a8f98,
};
/** The characters Discord counts towards the 6000, minus the description. */
function fixedCost(title, fields, footer) {
    let total = title.length + (footer?.length ?? 0);
    for (const f of fields)
        total += f.name.length + f.value.length;
    return total;
}
/**
 * Builds the message body. Exported for the tests, which assert the shape
 * rather than a snapshot of it, and useful if you post it through a bot token
 * rather than a webhook.
 */
export function buildDiscordMessage(report, options, ctx = {}) {
    const r = readReport(report);
    const screenshot = resolveUrl(options.screenshotUrl, report, ctx.screenshotUrl);
    const link = resolveUrl(options.reportUrl, report);
    const title = clip(r.title, MAX_DISCORD_EMBED_TITLE);
    const fields = r.facts
        .slice(0, MAX_DISCORD_EMBED_FIELDS)
        .map(([name, value]) => ({
        name: clip(name, MAX_DISCORD_FIELD_NAME),
        value: clip(value, MAX_DISCORD_FIELD_VALUE),
        inline: true,
    }));
    if (r.consoleText && fields.length < MAX_DISCORD_EMBED_FIELDS) {
        // The fence counts towards the 1024, so the entries are clipped to what is
        // left once it is paid for.
        const fence = "```";
        const body = clip(r.consoleText, MAX_DISCORD_FIELD_VALUE - 2 * fence.length - 2);
        fields.push({ name: "Console", value: `${fence}\n${body}\n${fence}` });
    }
    const footer = r.selector ? clip(r.selector, MAX_DISCORD_FOOTER_TEXT) : undefined;
    // Whatever is left of the 6000 after the parts that carry the facts. The
    // description is the reporter's own words, which is the one part that can be
    // read in a truncated form and still make sense.
    const room = Math.max(0, MAX_DISCORD_EMBED_TOTAL - fixedCost(title, fields, footer));
    const description = clip(r.message, Math.min(MAX_DISCORD_EMBED_DESCRIPTION, room));
    const embed = {
        title,
        color: DISCORD_COLOURS[r.type],
    };
    if (description)
        embed.description = description;
    if (link)
        embed.url = link;
    if (fields.length > 0)
        embed.fields = fields;
    if (screenshot)
        embed.image = { url: screenshot };
    if (r.timestamp)
        embed.timestamp = r.timestamp;
    if (footer)
        embed.footer = { text: footer };
    const body = { embeds: [embed] };
    if (options.username)
        body.username = options.username;
    if (options.avatarUrl)
        body.avatar_url = options.avatarUrl;
    return body;
}
/**
 * A sink that posts one embed per report to a Discord incoming webhook.
 * Resolves on a 2xx — Discord answers 204 with no body — throws `SinkError`
 * carrying the status and the response body on anything else, and lets
 * network failures from `fetch` propagate as they are.
 *
 * ```ts
 * handleReport(req, { sinks: [discordSink({ webhookUrl: process.env.DISCORD_URL! })] });
 * ```
 */
export function discordSink(options) {
    return async (report, ctx = {}) => {
        const doFetch = options.fetch ?? globalThis.fetch;
        const response = await doFetch(options.webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(buildDiscordMessage(report, options, ctx)),
            ...(ctx.signal ? { signal: ctx.signal } : {}),
        });
        if (!response.ok) {
            const body = await readBody(response);
            const fallback = `Discord refused the report with status ${response.status}`;
            throw new SinkError(messageFromBody(body, fallback), response.status, body);
        }
    };
}
/**
 * @deprecated Renamed to `MAX_DISCORD_EMBED_TITLE` in 0.9: every other ceiling in the
 * package starts with `MAX_`. Removed in 1.0 (#65).
 */
export const DISCORD_MAX_EMBED_TITLE = MAX_DISCORD_EMBED_TITLE;
/**
 * @deprecated Renamed to `MAX_DISCORD_EMBED_DESCRIPTION` in 0.9: every other ceiling in the
 * package starts with `MAX_`. Removed in 1.0 (#65).
 */
export const DISCORD_MAX_EMBED_DESCRIPTION = MAX_DISCORD_EMBED_DESCRIPTION;
/**
 * @deprecated Renamed to `MAX_DISCORD_EMBED_FIELDS` in 0.9: every other ceiling in the
 * package starts with `MAX_`. Removed in 1.0 (#65).
 */
export const DISCORD_MAX_EMBED_FIELDS = MAX_DISCORD_EMBED_FIELDS;
/**
 * @deprecated Renamed to `MAX_DISCORD_FIELD_NAME` in 0.9: every other ceiling in the
 * package starts with `MAX_`. Removed in 1.0 (#65).
 */
export const DISCORD_MAX_FIELD_NAME = MAX_DISCORD_FIELD_NAME;
/**
 * @deprecated Renamed to `MAX_DISCORD_FIELD_VALUE` in 0.9: every other ceiling in the
 * package starts with `MAX_`. Removed in 1.0 (#65).
 */
export const DISCORD_MAX_FIELD_VALUE = MAX_DISCORD_FIELD_VALUE;
/**
 * @deprecated Renamed to `MAX_DISCORD_FOOTER_TEXT` in 0.9: every other ceiling in the
 * package starts with `MAX_`. Removed in 1.0 (#65).
 */
export const DISCORD_MAX_FOOTER_TEXT = MAX_DISCORD_FOOTER_TEXT;
/**
 * @deprecated Renamed to `MAX_DISCORD_EMBED_TOTAL` in 0.9: every other ceiling in the
 * package starts with `MAX_`. Removed in 1.0 (#65).
 */
export const DISCORD_MAX_EMBED_TOTAL = MAX_DISCORD_EMBED_TOTAL;
//# sourceMappingURL=discord.js.map