/**
 * Minimal receiving end for a bugbottle report — a working reference, not a
 * framework. Run `node server.mjs`, open the page, submit a report, and see
 * the validated result printed in the terminal.
 *
 * Uses only Node's built-in modules. The browser library is served from this
 * repository's dist/ so the example works without npm; run `npm run build`
 * in the repository root first.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, normalize } from "node:path";
import {
  decodeScreenshotDataUrl,
  isReportType,
  normaliseConsole,
  normaliseContext,
  normaliseElements,
  normaliseMessage,
  InvalidScreenshotError,
} from "bugbottle/server";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "..", "dist");
const port = process.env.PORT ?? 8787;

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/") {
    const html = await readFile(join(here, "index.html"));
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  if (req.method === "GET" && req.url.startsWith("/bugbottle/")) {
    const file = normalize(join(dist, req.url.slice("/bugbottle/".length)));
    if (!file.startsWith(dist) || !file.endsWith(".js")) {
      res.writeHead(404).end();
      return;
    }
    try {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end("Run `npm run build` in the repository root first.");
    }
    return;
  }

  if (req.method === "POST" && req.url === "/api/feedback") {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    try {
      const body = JSON.parse(raw);
      const message = normaliseMessage(body.message);
      if (!message || !isReportType(body.type)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "A report needs a type and a message" }));
        return;
      }
      let screenshotBytes = null;
      try {
        screenshotBytes = body.screenshotDataUrl
          ? decodeScreenshotDataUrl(body.screenshotDataUrl)
          : null;
      } catch (err) {
        if (!(err instanceof InvalidScreenshotError)) throw err;
        // The picture is the optional part — keep the report, drop the bytes.
      }
      console.log("--- report received ---");
      console.log(JSON.stringify({
        type: body.type,
        message,
        context: normaliseContext(body.context),
        console: normaliseConsole(body.console),
        elements: normaliseElements(body.elements),
        screenshotBytes: screenshotBytes?.length ?? 0,
      }, null, 2));
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: crypto.randomUUID() }));
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Malformed report" }));
    }
    return;
  }

  res.writeHead(404).end();
});

server.listen(port, () => {
  console.log(`Open http://localhost:${port} and send a report.`);
});
