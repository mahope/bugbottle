/**
 * A complete receiving endpoint: auth, validation via `bugbottle/server`,
 * upload to a private bucket, and an authenticated route that streams the
 * screenshot back. Written as Next.js Route Handler exports (`POST`/`GET`
 * taking a standard `Request`), which is portable enough to adapt to most
 * frameworks with a thin wrapper.
 *
 * Configure via env vars: S3_ENDPOINT, S3_REGION, S3_BUCKET,
 * S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY. See README.md.
 */
import {
  decodeScreenshotDataUrl,
  InvalidScreenshotError,
  isReportType,
  normaliseMessage,
  normaliseContext,
} from "bugbottle/server";
import { assertBucketIsPrivate, getObject, putObject, type S3Config } from "./s3.ts";
import { db } from "./db.ts";

// Your auth. The only requirement here is that it returns null for anyone
// unauthenticated — swap the body for a real session/cookie/JWT lookup.
async function getUser(req: Request): Promise<{ id: string } | null> {
  const token = req.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return null;
  return { id: token };
}

const s3Config: S3Config = {
  endpoint: requireEnv("S3_ENDPOINT"),
  region: requireEnv("S3_REGION"),
  bucket: requireEnv("S3_BUCKET"),
  accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
  secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

/** POST /api/reports — receives a bug report, optionally with a screenshot. */
export async function POST(req: Request): Promise<Response> {
  const user = await getUser(req);
  if (!user) return new Response(null, { status: 401 });

  const payload: unknown = await req.json().catch(() => null);
  const body = (payload ?? {}) as Record<string, unknown>;

  const message = normaliseMessage(body.message);
  if (!message) return new Response("Write a message first", { status: 400 });

  const type = isReportType(body.type) ? body.type : "other";
  const context = normaliseContext(body.context);

  let screenshotKey: string | null = null;
  if (typeof body.screenshotDataUrl === "string") {
    try {
      const bytes = decodeScreenshotDataUrl(body.screenshotDataUrl);
      await assertBucketIsPrivate(s3Config);
      screenshotKey = `reports/${crypto.randomUUID()}.png`;
      await putObject(s3Config, screenshotKey, bytes, "image/png");
    } catch (err) {
      // A rejected or failed picture must not fail the report — the
      // message is the valuable part.
      if (!(err instanceof InvalidScreenshotError)) throw err;
    }
  }

  const report = await db.reports.insert({
    userId: user.id,
    type,
    message,
    url: context.url,
    screenshotKey,
  });

  return Response.json({ id: report.id }, { status: 201 });
}

/**
 * GET /api/reports/:id/screenshot — streams a report's screenshot back.
 * The storage key comes from the row, never from the request: an id alone
 * cannot be used to walk the bucket, and there is never a public URL to leak.
 */
export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const user = await getUser(req);
  if (!user) return new Response(null, { status: 401 });

  const report = await db.reports.findById(params.id);
  // Swap for your own access rule — this one only lets the reporter who
  // filed the report re-fetch their own screenshot.
  if (!report || report.userId !== user.id || !report.screenshotKey) {
    return new Response(null, { status: 404 });
  }

  const object = await getObject(s3Config, report.screenshotKey);
  if (!object) return new Response(null, { status: 404 });

  return new Response(object.body, { headers: { "content-type": object.contentType } });
}
