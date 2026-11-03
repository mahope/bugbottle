import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { once } from "node:events";
import express from "express";
import Fastify from "fastify";
import { expressHandler, fastifyHandler, fileStore } from "bugbottle/server";
import { computeSignature } from "bugbottle/sign";

const dir = await mkdtemp(join(process.cwd(), "reports-"));
const key = "public-fixture-signing-key";
const cors = "https://consumer.example.invalid";
const limit = 512;
const report = JSON.stringify({ type: "bug", message: "  Blåbær 🐛  ", context: { url: "/fixture" }, console: [] }, null, 2);
const atLimit = report + " ".repeat(limit - Buffer.byteLength(report));
const closers = [];

try {
  for (const framework of ["express", "fastify"]) {
    for (const raw of [false, true]) {
      const storage = join(dir, `${framework}-${raw}`);
      const reports = fileStore({ dir: storage });
      let entered = 0;
      let writes = 0;
      const errors = [];
      const options = {
        cors,
        store: async (...args) => { writes++; return reports.store(...args); },
        onError: (error) => errors.push(error.message),
      };
      let base;
      let close;
      if (framework === "express") {
        const app = express();
        const parser = raw
          ? express.raw({ type: "application/json", limit })
          : express.json({ limit });
        const mount = (path, extra) => app.all(path, parser, (req, res) => {
          entered++;
          return extra(req, res);
        });
        mount("/report", expressHandler(options));
        mount("/signed", expressHandler({ ...options, signature: { key } }));
        mount("/receiver-limit", expressHandler({ ...options, maxBodyBytes: limit - 1 }));
        app.use((error, _req, res, _next) => res.status(error.status ?? 500).json({ framework: error.type }));
        const server = app.listen(0, "127.0.0.1");
        close = async () => { server.closeAllConnections(); await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); };
        closers.push(close);
        await once(server, "listening");
        base = `http://127.0.0.1:${server.address().port}`;
      } else {
        const app = Fastify({ bodyLimit: limit });
        close = () => app.close();
        closers.push(close);
        if (raw) app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));
        const mount = (path, handler) => app.route({
          method: ["POST", "OPTIONS"], url: path,
          handler: (req, reply) => { entered++; handler(req, reply); },
        });
        mount("/report", fastifyHandler(options));
        mount("/signed", fastifyHandler({ ...options, signature: { key } }));
        mount("/receiver-limit", fastifyHandler({ ...options, maxBodyBytes: limit - 1 }));
        base = await app.listen({ port: 0, host: "127.0.0.1" });
      }
      const request = async (path, body, headers = {}, method = "POST") => {
        const response = await fetch(base + path, {
          method, body, signal: AbortSignal.timeout(3000),
          headers: { ...(method === "POST" ? { "content-type": "application/json" } : {}), origin: cors, ...headers },
        });
        const text = await response.text();
        return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : undefined };
      };
      const accepted = await request("/report", atLimit);
      assert.equal(accepted.status, 201);
      assert.equal(accepted.headers.get("access-control-allow-origin"), cors);
      assert.equal(writes, 1);
      const files = (await readdir(storage)).filter((name) => name.endsWith(".json"));
      assert.equal(files.length, 1);
      const stored = JSON.parse(await readFile(join(storage, files[0]), "utf8"));
      assert.equal(stored.message, "Blåbær 🐛");
      assert.equal((await readdir(storage)).filter((name) => name.endsWith(".json")).length, 1);

      const signature = await computeSignature(key, report);
      for (let attempt = 0; attempt < 2; attempt++) {
        const signed = await request("/signed", report, { "x-bugbottle-signature": signature });
        assert.equal(signed.status, raw && attempt === 0 ? 201 : 401);
      }
      assert.equal(errors.length, raw ? 0 : 1);
      if (!raw) assert.match(errors[0], /cannot verify a signature/);
      const expectedWrites = raw ? 2 : 1;
      assert.equal(writes, expectedWrites);
      for (const name of await readdir(storage)) {
        const persisted = JSON.parse(await readFile(join(storage, name), "utf8"));
        assert.equal(persisted.message, "Blåbær 🐛");
      }

      let before = entered;
      const malformed = await request("/report", "{");
      assert.equal(malformed.status, 400);
      assert.equal(entered - before, raw ? 1 : 0);
      assert.equal(malformed.headers.get("access-control-allow-origin"), raw ? cors : null);
      if (raw) assert.equal(malformed.body.error, "Malformed JSON");
      if (!raw) {
        if (framework === "express") assert.equal(malformed.body.framework, "entity.parse.failed");
        else assert.match(malformed.body.code, /^FST_ERR_CTP_/);
      }

      before = entered;
      const oversized = await request("/report", atLimit + " ");
      assert.equal(oversized.status, 413);
      assert.equal(entered, before);
      assert.equal(oversized.headers.get("access-control-allow-origin"), null);
      if (framework === "express") assert.equal(oversized.body.framework, "entity.too.large");
      else assert.equal(oversized.body.code, "FST_ERR_CTP_BODY_TOO_LARGE");

      // JSON parsing removes padding before the adapter sees the body.
      if (raw) {
        before = entered;
        const rejected = await request("/receiver-limit", atLimit);
        assert.equal(rejected.status, 413);
        assert.equal(entered, before + 1);
        assert.equal(rejected.headers.get("access-control-allow-origin"), cors);
        assert.equal(rejected.body.error, "Report is too large");
        assert.equal(rejected.body.code, undefined);
      }
      const preflight = await request("/signed", undefined, { "access-control-request-method": "POST" }, "OPTIONS");
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get("access-control-allow-origin"), cors);
      assert.match(preflight.headers.get("access-control-allow-methods"), /POST/);
      assert.equal(writes, expectedWrites);
      assert.equal((await readdir(storage)).filter((name) => name.endsWith(".json")).length, expectedWrites);
      await close();
      closers.pop();
      console.log(`${framework} ${raw ? "raw" : "JSON"}: HTTP, persistence, signatures, parser limits and CORS passed`);
    }
  }
} finally {
  try { await Promise.all(closers.map((close) => close())); }
  finally { await rm(dir, { recursive: true, force: true }); }
}
