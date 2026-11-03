import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const name = `bugbottle-inbox-smoke-${randomUUID()}`;
const image = `${name}:test`;
const volume = `${name}-data`;
const password = randomBytes(32).toString("hex");
const authorization = `Basic ${Buffer.from(`inbox:${password}`).toString("base64")}`;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9X8AAAAASUVORK5CYII=", "base64");
const message = "Docker persistence smoke fixture";
let phase = "build";
class SmokeError extends Error {}

function docker(args, { optional = false, timeout = 30_000 } = {}) {
  const result = spawnSync("docker", args, {
    cwd: root, encoding: "utf8", timeout,
    env: { ...process.env, INBOX_PASSWORD: password },
    maxBuffer: 8 * 1024 * 1024,
  });
  if (!optional && (result.error || result.status !== 0)) {
    const reason = result.error?.code === "ETIMEDOUT" ? `timed out after ${timeout} ms`
      : result.error ? `spawn error ${result.error.code}`
      : result.signal ? `signal ${result.signal}` : `exit ${result.status}`;
    if (args[0] === "build") {
      // Build receives no report or credentials; redact our generated fixture too.
      for (const output of [result.stdout, result.stderr]) {
        let safe = output || "";
        for (const secret of [authorization, password, message, png.toString("base64")]) {
          safe = safe.replaceAll(secret, "[redacted]");
        }
        if (safe) console.error(`Docker build output (last 4096 characters):\n${safe.slice(-4096)}`);
      }
    }
    throw new SmokeError(`Docker ${args[0]} failed during ${phase} (${reason})`);
  }
  return result;
}

function check(condition, label) {
  if (!condition) throw new SmokeError(label);
}

function diagnostics() {
  // Never dump inspect, logs, health output or HTTP bodies: they may carry secrets.
  const result = docker(["inspect", "--format", '{{json .State}}', name], { optional: true });
  try {
    const state = JSON.parse(result.stdout);
    console.error(JSON.stringify({
      phase, status: state.Status, exitCode: state.ExitCode, oomKilled: state.OOMKilled,
      health: state.Health?.Status, failingStreak: state.Health?.FailingStreak,
      probes: state.Health?.Log?.map(({ Start, End, ExitCode }) => ({ Start, End, ExitCode })),
    }));
  } catch {
    console.error(`No container state available during ${phase}`);
  }
}

function cleanup() {
  let failed = false;
  for (const args of [["rm", "-f", name], ["volume", "rm", volume], ["image", "rm", image]]) {
    const result = docker(args, { optional: true });
    if (result.status !== 0) {
      // Missing resources are expected after a partial startup; verify absence.
      const inspect = args[0] === "rm" ? ["container", "inspect", name]
        : [args[0], "inspect", args.at(-1)];
      const state = docker(inspect, { optional: true });
      const resource = args.at(-1);
      const kind = args[0] === "rm" ? "container" : args[0];
      const missing = kind === "volume"
        ? `Error response from daemon: get ${resource}: no such volume`
        : `Error: No such ${kind}: ${resource}`;
      const detail = state.stderr?.trim();
      const absent = detail === missing || detail === missing.replace(/^Error:/, "Error response from daemon:");
      if (state.error || state.status !== 1 || !absent) failed = true;
    }
  }
  if (failed) {
    console.error("Smoke resource cleanup failed");
    process.exitCode = 1;
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => { diagnostics(); cleanup(); process.exit(1); });
}

async function start() {
  docker(["run", "-d", "--name", name, "--publish", "127.0.0.1::8788",
    "--mount", `type=volume,source=${volume},target=/data`, "--env", "INBOX_PASSWORD", image]);
  const deadline = Date.now() + 90_000;
  while (true) {
    const state = JSON.parse(docker(["inspect", "--format", "{{json .State}}", name]).stdout);
    check(Date.now() < deadline, "Docker HEALTHCHECK deadline exceeded (90 seconds)");
    if (state.Health?.Status === "healthy") break;
    check(state.Running && state.Health?.Status !== "unhealthy", "Container exited or became unhealthy");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const uid = docker(["exec", name, "id", "-u"]).stdout.trim();
  check(/^\d+$/.test(uid) && uid !== "0", "Container must run as a non-root user");
  const binding = JSON.parse(docker(["inspect", "--format", '{{json .NetworkSettings.Ports}}', name]).stdout)["8788/tcp"];
  check(binding.length === 1 && binding[0].HostIp === "127.0.0.1", "Port must be localhost-only");
  return `http://127.0.0.1:${binding[0].HostPort}`;
}

async function request(origin, path, options = {}) {
  return fetch(`${origin}${path}`, { ...options, signal: AbortSignal.timeout(5000), redirect: "manual" });
}

async function readBack(origin, id) {
  for (const path of ["/", `/r/${id}`, `/r/${id}.json`, `/r/${id}.png`]) {
    const denied = await request(origin, path);
    check(denied.status === 401, "Unauthenticated inbox read was not denied");
    await denied.arrayBuffer();
  }
  const headers = { Authorization: authorization };
  const list = await request(origin, "/", { headers });
  check(list.status === 200 && (await list.text()).includes(id), "Stored id missing from inbox");
  const report = await request(origin, `/r/${id}.json`, { headers });
  check(report.status === 200, "Authenticated report read failed");
  check((await report.json()).message === message, "Stored report differs from fixture");
  const picture = await request(origin, `/r/${id}.png`, { headers });
  check(picture.status === 200 && picture.headers.get("content-type") === "image/png", "Screenshot read failed");
  check(Buffer.from(await picture.arrayBuffer()).equals(png), "Stored screenshot differs from fixture");
}

try {
  docker(["build", "-f", "examples/inbox/Dockerfile", "-t", image, "."], { timeout: 180_000 });
  phase = "first container";
  docker(["volume", "create", volume]);
  let origin = await start();
  const posted = await request(origin, "/api/feedback", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: authorization },
    body: JSON.stringify({ type: "bug", message, screenshotDataUrl: `data:image/png;base64,${png.toString("base64")}` }),
  });
  check(posted.status === 201, "Valid report was not accepted");
  const { id } = await posted.json();
  check(typeof id === "string" && /^[0-9a-f-]{36}$/.test(id), "Invalid stored report id");
  await readBack(origin, id);
  phase = "replacement container";
  docker(["rm", "-f", name]);
  origin = await start();
  await readBack(origin, id);
  console.log("Inbox Docker smoke passed: healthy, non-root, protected reads and persistent report/PNG");
} catch (error) {
  console.error(error instanceof SmokeError ? error.message : `Smoke failed during ${phase} (request or response error)`);
  diagnostics();
  process.exitCode = 1;
} finally {
  cleanup();
}
