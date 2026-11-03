import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { getEventListeners } from "node:events";
import { sendReportSmtp, smtpSink } from "../src/sinks/smtp.ts";
import { handleReport } from "../src/server/handle.ts";
import { reportBody } from "./report-fixtures.ts";

async function stalledServer(phase: string) {
  const commands: string[] = [];
  const sockets = new Set<Socket>();
  let connections = 0;
  let deliveries = 0;
  let reached!: () => void;
  let closed!: () => void;
  const ready = new Promise<void>((resolve) => { reached = resolve; });
  const ended = new Promise<void>((resolve) => { closed = resolve; });
  const server = createServer((socket) => {
    connections++;
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => { sockets.delete(socket); closed(); });
    let buffer = "";
    let inData = false;
    let handshake = phase === "implicit TLS";
    socket.on("data", (chunk) => {
      if (handshake) { reached(); return; }
      buffer += chunk.toString();
      for (;;) {
        const end = buffer.indexOf("\r\n");
        if (end < 0) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            if (phase === "message") reached();
            else { deliveries++; socket.write("250 Accepted\r\n"); }
          }
          continue;
        }
        commands.push(line);
        const verb = line.split(" ")[0];
        if (verb === phase && phase !== "STARTTLS") { reached(); continue; }
        if (verb === "EHLO") socket.write(phase === "STARTTLS" ? "250-fake\r\n250 STARTTLS\r\n" : "250 fake\r\n");
        else if (verb === "STARTTLS") {
          socket.write("220 Ready\r\n");
          handshake = true;
          return;
        } else if (verb === "DATA") {
          inData = true;
          socket.write("354 Send message\r\n");
        } else if (verb === "QUIT") {
          socket.end("221 Bye\r\n");
        } else socket.write("250 OK\r\n");
      }
    });
    if (phase === "greeting") reached();
    else if (!handshake) socket.write("220 fake\r\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return {
    options: { host: "127.0.0.1", port: address.port, from: "bugs@example.com", to: "team@example.com", timeoutMs: 1500 },
    commands, ready, ended,
    connections: () => connections,
    deliveries: () => deliveries,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

async function promptly<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("cancellation did not settle promptly")), 400);
    })]);
  } finally { clearTimeout(timer); }
}

test("SMTP cancellation before entry opens no connection", async () => {
  const fake = await stalledServer("greeting");
  const controller = new AbortController();
  controller.abort();
  try {
    await promptly(assert.rejects(sendReportSmtp(reportBody, fake.options, { signal: controller.signal }), /abort/i));
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(fake.connections(), 0);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  } finally { await fake.close(); }
});

for (const phase of ["greeting", "MAIL", "DATA", "message", "QUIT", "STARTTLS", "implicit TLS"]) {
  test(`SMTP cancellation during ${phase} closes the transport`, async () => {
    const fake = await stalledServer(phase);
    const controller = new AbortController();
    const delivery = sendReportSmtp(reportBody, { ...fake.options, secure: phase === "implicit TLS" }, { signal: controller.signal });
    const rejected = assert.rejects(delivery, /abort/i);
    try {
      await fake.ready;
      const before = [...fake.commands];
      controller.abort();
      await promptly(rejected);
      await promptly(fake.ended);
      assert.deepEqual(fake.commands, before, "no later command or message was sent");
      assert.equal(fake.deliveries(), phase === "QUIT" ? 1 : 0);
      assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    } finally { await fake.close(); await rejected; }
  });
}

test("handleReport times out SMTP and keeps its accepted response policy", async () => {
  const fake = await stalledServer("greeting");
  const errors: unknown[] = [];
  try {
    const response = await handleReport(new Request("https://app.example.com/report", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(reportBody),
    }), { sinks: [smtpSink(fake.options)], sinkTimeoutMs: 100, onSinkError: (error) => { errors.push(error); } });
    assert.equal(response.status, 202);
    assert.deepEqual(await response.json(), {});
    assert.equal(errors.length, 1);
    await promptly(fake.ended);
    assert.deepEqual(fake.commands, []);
  } finally { await fake.close(); }
});

test("successful SMTP delivery removes its abort listener", async () => {
  const fake = await stalledServer("success");
  const controller = new AbortController();
  try {
    await sendReportSmtp(reportBody, fake.options, { signal: controller.signal });
    assert.equal(fake.deliveries(), 1);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    controller.abort();
    await promptly(fake.ended);
  } finally { await fake.close(); }
});
