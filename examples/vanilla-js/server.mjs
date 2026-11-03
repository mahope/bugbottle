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
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, normalize } from "node:path";
import { randomUUID } from "node:crypto";
import { handleReport } from "../../dist/server/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "..", "dist");
const port = process.env.PORT ?? 8787;

export function createDemoServer(options = {}) {
  const store = (report, screenshot) => {
    console.log("--- report received ---");
    console.log(JSON.stringify({ ...report, screenshotBytes: screenshot?.length ?? 0 }, null, 2));
    return { id: randomUUID() };
  };
  return createServer(async (req, res) => {
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
      // Cancellation pauses the upload; close the socket only after the reply
      // has flushed, so a refused upload receives its 413 or 408 rather than a reset.
      const body = new ReadableStream({
        start(controller) {
          req.on("data", onData);
          req.on("end", onEnd);
          req.on("error", onError);
          function onData(chunk) { req.pause(); controller.enqueue(chunk); }
          function onEnd() { cleanup(); controller.close(); }
          function onError(error) { cleanup(); controller.error(error); }
          function cleanup() {
            req.off("data", onData);
            req.off("end", onEnd);
            req.off("error", onError);
          }
          this.cleanup = cleanup;
          req.pause();
        },
        pull() { req.resume(); },
        cancel() { req.pause(); this.cleanup(); },
      }, { highWaterMark: 0 });
      const response = await handleReport(new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: req.headers,
        body,
        duplex: "half",
      }), { store, ...options });
      if (!req.readableEnded) {
        res.setHeader("Connection", "close");
        res.once("finish", () => req.destroy());
      }
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
      return;
    }

    res.writeHead(404).end();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createDemoServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`Open http://localhost:${server.address().port} and send a report.`);
  });
}
