import worker, { reports } from "./worker.mjs";

export default {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/__stored") return Response.json([...reports.values()]);
    if (path === "/__sign") {
      if (typeof process !== "undefined" || typeof Buffer !== "undefined") {
        throw new Error("Node globals must not be shimmed");
      }
      const encode = (value) => new TextEncoder().encode(value);
      const key = await crypto.subtle.importKey("raw", encode("public-demo-key"),
        { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const timestamp = Date.now();
      const digest = await crypto.subtle.sign("HMAC", key, encode(`${timestamp}.${await request.text()}`));
      const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      return new Response(`t=${timestamp},v1=${hex}`);
    }
    return worker.fetch(request);
  },
};
