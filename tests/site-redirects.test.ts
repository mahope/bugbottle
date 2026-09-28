/**
 * This container listens on :80 and nothing else, because Traefik terminates
 * the TLS in front of it — so nginx's own `$scheme` is `http` on every request
 * that actually arrived over https. The directory redirect nginx writes for a
 * URL that is missing its trailing slash is an absolute one built from that
 * `$scheme`, which is why a link written as `https://bugbottle.dev/docs/install`
 * used to be answered with `Location: http://bugbottle.dev/docs/install/`.
 *
 * Measured on live 28/9 13:1x: the request bounced off TLS onto the plain
 * address and back again, and the browser rendered a scheme downgrade on the
 * way. It is not a wrong page — the redirect still lands on the right one — but
 * it is a full extra round trip for every link that arrives without its slash,
 * and those are most of the ones in a README, an npm page or a chat window.
 *
 * The guard is here rather than in `site-image.test.ts` because that file
 * watches the Dockerfile's file lists, and this is a directive inside a config
 * file. Like the rest of the site checks it reads the source rather than the
 * running image, because the bug is only visible through a real request, and a
 * request needs a port this suite does not have. So the assertions are about
 * the two things that make the redirect correct: the directive is set on the
 * block that serves the canonical host, and the one redirect that must stay
 * absolute is written as a literal rather than left to nginx to build.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

const nginxConf = readFileSync(join(root, "site/nginx.conf"), "utf8").replace(/\r\n/g, "\n");

/**
 * The body of one `server` block, by the `server_name` it declares. nginx
 * allows the two blocks in this file to be written in either order — the exact
 * match has to beat the catch-all whatever the order is, which is why the
 * config says so — so nothing here may depend on which comes first.
 */
function serverBlock(serverName: string): string {
  const start = nginxConf.search(new RegExp(`^server \\{[^}]*server_name\\s+${serverName};`, "m"));
  assert.notEqual(start, -1, `no server block declares server_name ${serverName}`);
  let depth = 0;
  for (let i = nginxConf.indexOf("{", start); i < nginxConf.length; i++) {
    if (nginxConf[i] === "{") depth++;
    if (nginxConf[i] === "}") {
      depth--;
      if (depth === 0) return nginxConf.slice(start, i + 1);
    }
  }
  throw new Error(`the server block for ${serverName} is never closed`);
}

test("a URL without its trailing slash is redirected without leaving https", () => {
  const canonical = serverBlock("_");
  assert.match(
    canonical,
    /^\s*absolute_redirect\s+off;/m,
    "the block serving the canonical host does not set `absolute_redirect off`, so nginx " +
      "builds the trailing-slash redirect from its own $scheme — which is http here, " +
      "because the TLS is terminated in front of the container. Every such URL is then " +
      "answered with an http:// Location and takes two redirects to reach a page it " +
      "could have reached in one.",
  );
});

test("no block turns the relative redirect back on", () => {
  const offenders = [...nginxConf.matchAll(/^\s*absolute_redirect\s+on;/gm)];
  assert.deepEqual(
    offenders.map((m) => m[0].trim()),
    [],
    "a block sets `absolute_redirect on`, which undoes the fix on that block whatever " +
      "the directive above it says — nginx takes the last one it reads, not the first.",
  );
});

test("the alias host still redirects to the canonical host over https", () => {
  // The reason the directive above is safe: this one is written out in full,
  // so nginx serves it verbatim and `absolute_redirect` cannot shorten it to a
  // bare path. If it were left to nginx to build, turning relative redirects on
  // would quietly turn the alias into a loop that never reaches bugbottle.dev.
  const alias = serverBlock("bugbottle\\.mahoje\\.dk");
  assert.match(
    alias,
    /return 301 https:\/\/bugbottle\.dev\$request_uri;/,
    "the alias block no longer redirects to https://bugbottle.dev as a literal, so the " +
      "relative-redirect setting now rewrites it to a path on the alias itself and the " +
      "old address stops converging on the canonical one.",
  );
});

test("the health check is answered on both hosts, not redirected", () => {
  // Dokploy polls /health on the application, and a redirect there reads as a
  // failure and flaps it. The relative-redirect change is near enough to the
  // catch-all that this is worth pinning rather than rediscovering.
  for (const name of ["_", "bugbottle\\.mahoje\\.dk"]) {
    const block = serverBlock(name);
    const health = /location = \/health \{([\s\S]*?)\n  \}/.exec(block)?.[1] ?? "";
    assert.match(
      health,
      /return 200 "ok\\n";/,
      `server_name ${name} no longer answers /health with 200 directly`,
    );
  }
});
