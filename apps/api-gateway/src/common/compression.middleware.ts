import { gzip } from "zlib";

/**
 * Gzip for the gateway's JSON answers.
 *
 * Why: `GET /inventory/<house>` is ~760 KB of JSON that gzips to ~19 KB, and
 * the host in front of this one (a Vercel rewrite to Railway) is not known to
 * encode what it proxies. Cold loads of the biggest pages waited on bytes.
 *
 * Rules: only when the caller accepts gzip; never when a Content-Encoding is
 * already set; only JSON/text bodies of at least `MIN_BYTES`; never an event
 * stream; never an upgrade (those do not pass through `res` this way). A body
 * we will not touch passes through byte for byte, and the first write decides
 * so a stream is never held back.
 */
export const MIN_BYTES = 1024;

type Next = () => void;
interface Req {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
}
// Loose on purpose: the Express response, typed only as far as is used here.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Res = any;

const accepts = (req: Req): boolean => {
  const h = req.headers["accept-encoding"];
  const v = Array.isArray(h) ? h.join(",") : h || "";
  return v.split(",").some((p) => {
    const [name, ...params] = p.trim().toLowerCase().split(";");
    if (name !== "gzip" && name !== "*") return false;
    const q = params.map((s) => s.trim()).find((s) => s.startsWith("q="));
    return !q || Number(q.slice(2)) > 0;
  });
};

const compressible = (type: unknown): boolean => {
  const t = String(type || "").toLowerCase();
  if (t.startsWith("text/event-stream")) return false;
  return t.startsWith("application/json") || t.includes("+json") || t.startsWith("text/");
};

const toBuffer = (chunk: any, enc?: any): Buffer =>
  Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), typeof enc === "string" ? (enc as BufferEncoding) : "utf8");

export function compressionMiddleware(req: Req, res: Res, next: Next): void {
  if (req.method === "HEAD" || !accepts(req)) return next();

  const write = res.write.bind(res);
  const end = res.end.bind(res);
  const vary = () => {
    const cur = String(res.getHeader("Vary") || "");
    if (!/accept-encoding/i.test(cur)) res.setHeader("Vary", cur ? `${cur}, Accept-Encoding` : "Accept-Encoding");
  };

  let mode: "undecided" | "pass" | "buffer" = "undecided";
  const chunks: Buffer[] = [];
  const decide = () => {
    if (mode !== "undecided") return;
    const ok =
      !res.getHeader("Content-Encoding") &&
      res.statusCode !== 204 &&
      res.statusCode !== 304 &&
      compressible(res.getHeader("Content-Type"));
    mode = ok ? "buffer" : "pass";
    if (ok) vary();
    if (mode === "pass") {
      res.write = write;
      res.end = end;
    }
  };

  res.write = (chunk: any, enc?: any, cb?: any): boolean => {
    decide();
    if (mode === "pass") return write(chunk, enc, cb);
    if (chunk) chunks.push(toBuffer(chunk, enc));
    const done = typeof enc === "function" ? enc : cb;
    if (typeof done === "function") done();
    return true;
  };

  res.end = (chunk?: any, enc?: any, cb?: any): any => {
    decide();
    if (mode === "pass") return end(chunk, enc, cb);
    if (chunk && typeof chunk !== "function") chunks.push(toBuffer(chunk, enc));
    const done = [chunk, enc, cb].find((a) => typeof a === "function");
    const body = Buffer.concat(chunks);
    res.write = write;
    res.end = end;
    if (body.length < MIN_BYTES) {
      res.setHeader("Content-Length", body.length);
      return end(body, done);
    }
    gzip(body, (err, zipped) => {
      if (err) {
        res.setHeader("Content-Length", body.length);
        return end(body, done);
      }
      vary();
      res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Content-Length", zipped.length);
      const etag = res.getHeader("ETag");
      if (typeof etag === "string" && !etag.startsWith("W/")) res.setHeader("ETag", `W/${etag}`);
      end(zipped, done);
    });
    return res;
  };

  next();
}
