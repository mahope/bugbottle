/**
 * A minimal S3-compatible object storage client: SigV4 request signing,
 * `putObject`, `getObject`, and a guard that refuses to write to a bucket
 * carrying a public-access policy.
 *
 * No SDK. SigV4 is the same signing scheme AWS S3, Cloudflare R2, MinIO,
 * DigitalOcean Spaces, and Backblaze B2's S3-compatible endpoint all accept,
 * so this file — not a vendor SDK — is what makes the example adapt to
 * whichever one you use. Swap `endpoint` and you're pointed at a different
 * provider.
 *
 * Uses path-style addressing (`https://endpoint/bucket/key`) rather than
 * virtual-hosted style (`https://bucket.endpoint/key`), because path-style
 * is the one form every S3-compatible provider agrees on.
 */

export type S3Config = {
  endpoint: string; // e.g. "https://s3.eu-central-1.amazonaws.com", or your provider's origin
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

// WebCrypto and fetch expect array buffers backed by a real ArrayBuffer, not
// the wider ArrayBufferLike a bare `Uint8Array` type allows — spelling it out
// here keeps that guarantee through every function in this file.
type Bytes = Uint8Array<ArrayBuffer>;

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(data));
  return toHex(new Uint8Array(digest));
}

async function hmac(key: Bytes, data: string): Promise<Bytes> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
  return new Uint8Array(signature);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Signs a request per AWS Signature Version 4 and returns the URL and
 * headers to send it with. `path` is the URL path to sign (e.g.
 * `/bucket/key` or `/bucket`); `query` is the canonical query string
 * (already sorted — S3 subresources like `publicAccessBlock` are the only
 * ones this file sends, so there's never more than one parameter).
 *
 * Payload is signed as "UNSIGNED-PAYLOAD" — an AWS-documented option for S3
 * that avoids buffering the whole body twice just to hash it, at the cost of
 * not authenticating the payload bytes themselves (the request line,
 * headers and bucket/key are still signed).
 */
async function signRequest(
  config: S3Config,
  method: string,
  path: string,
  query: string,
): Promise<{ url: URL; headers: Record<string, string> }> {
  const iso = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
  const date = iso.slice(0, 8);
  const url = new URL(`${config.endpoint}${path}${query ? `?${query}` : ""}`);

  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": "UNSIGNED-PAYLOAD",
    "x-amz-date": iso,
  };
  const signedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderNames.map((name) => `${name}:${headers[name]}\n`).join("");
  const signedHeaders = signedHeaderNames.join(";");

  const canonicalRequest = [
    method,
    url.pathname,
    query,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const scope = `${date}/${config.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", iso, scope, await sha256Hex(canonicalRequest)].join("\n");

  const kDate = await hmac(new TextEncoder().encode(`AWS4${config.secretAccessKey}`), date);
  const kRegion = await hmac(kDate, config.region);
  const kService = await hmac(kRegion, "s3");
  const kSigning = await hmac(kService, "aws4_request");
  const signature = toHex(await hmac(kSigning, stringToSign));

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { url, headers };
}

export async function putObject(
  config: S3Config,
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  const { url, headers } = await signRequest(config, "PUT", `/${config.bucket}/${key}`, "");
  // Re-wrapped so fetch sees a real ArrayBuffer-backed view: callers may
  // hand us a Uint8Array typed against the wider ArrayBufferLike, which
  // fetch's BodyInit does not accept directly.
  const payload: Bytes = new Uint8Array(body);
  const res = await fetch(url, {
    method: "PUT",
    headers: { ...headers, "content-type": contentType },
    body: payload,
  });
  if (!res.ok) {
    throw new Error(`S3 PUT ${key} failed: ${res.status} ${await res.text()}`);
  }
}

export async function getObject(
  config: S3Config,
  key: string,
): Promise<{ body: ReadableStream<Uint8Array>; contentType: string } | null> {
  const { url, headers } = await signRequest(config, "GET", `/${config.bucket}/${key}`, "");
  const res = await fetch(url, { method: "GET", headers });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`S3 GET ${key} failed: ${res.status} ${await res.text()}`);
  }
  if (!res.body) throw new Error(`S3 GET ${key} returned no body`);
  return { body: res.body, contentType: res.headers.get("content-type") ?? "application/octet-stream" };
}

/**
 * Refuses to proceed if the bucket doesn't have all four S3 public-access
 * blocks enabled. Media buckets commonly carry a public-read policy — the
 * whole point of this example is that a screenshot must never be readable
 * by anyone holding the URL, so writing to a bucket that *could* be public
 * is treated as a configuration bug, not a risk worth taking silently.
 *
 * Cache this in a real deployment; bucket configuration rarely changes and
 * this is one signed request per write otherwise.
 */
export async function assertBucketIsPrivate(config: S3Config): Promise<void> {
  const { url, headers } = await signRequest(config, "GET", `/${config.bucket}`, "publicAccessBlock=");
  const res = await fetch(url, { method: "GET", headers });
  if (!res.ok) {
    throw new Error(
      `Refusing to write: could not confirm "${config.bucket}" blocks public access ` +
        `(${res.status}). Configure a public-access block on this bucket first.`,
    );
  }
  const xml = await res.text();
  const blocked = (field: string) => new RegExp(`<${field}>true</${field}>`).test(xml);
  const allBlocked =
    blocked("BlockPublicAcls") &&
    blocked("IgnorePublicAcls") &&
    blocked("BlockPublicPolicy") &&
    blocked("RestrictPublicBuckets");
  if (!allBlocked) {
    throw new Error(
      `Refusing to write: bucket "${config.bucket}" does not have all public-access blocks enabled. ` +
        `A screenshot written here could end up readable by anyone with the URL.`,
    );
  }
}
