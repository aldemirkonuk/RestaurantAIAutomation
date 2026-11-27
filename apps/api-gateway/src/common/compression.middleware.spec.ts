import * as http from "http";
import { AddressInfo } from "net";
import { gunzipSync } from "zlib";
import { compressionMiddleware } from "./compression.middleware";

type Handler = (req: http.IncomingMessage, res: http.ServerResponse) => void;

async function call(handler: Handler, acceptEncoding?: string, method = "GET") {
  const server = http.createServer((req, res) => compressionMiddleware(req as never, res, () => handler(req, res)));
  await new Promise<void>((r) => server.listen(0, r));
  const { port } = server.address() as AddressInfo;
  try {
    return await new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
      const req = http.request({ port, method, headers: acceptEncoding ? { "accept-encoding": acceptEncoding } : {} }, (res) => {
        const parts: Buffer[] = [];
        res.on("data", (d) => parts.push(d));
        res.on("end", () => resolve({ status: res.statusCode || 0, headers: res.headers, body: Buffer.concat(parts) }));
      });
      req.on("error", reject);
      req.end();
    });
  } finally {
    server.close();
  }
}

const big = JSON.stringify({ rows: Array.from({ length: 400 }, (_, i) => ({ id: i, name: `bottle ${i}` })) });
const json: Handler = (_q, res) => {
  res.setHeader("Content-Type", "application/json");
  res.end(big);
};

describe("compressionMiddleware", () => {
  it("gzips a large JSON body when gzip is accepted", async () => {
    const r = await call(json, "gzip, deflate, br");
    expect(r.headers["content-encoding"]).toBe("gzip");
    expect(r.headers["vary"]).toMatch(/Accept-Encoding/i);
    expect(Number(r.headers["content-length"])).toBe(r.body.length);
    expect(r.body.length).toBeLessThan(big.length / 3);
    expect(gunzipSync(r.body).toString()).toBe(big);
  });

  it("passes through untouched when gzip is not accepted", async () => {
    for (const ae of [undefined, "identity", "br", "gzip;q=0"]) {
      const r = await call(json, ae);
      expect(r.headers["content-encoding"]).toBeUndefined();
      expect(r.body.toString()).toBe(big);
    }
  });

  it("does not encode twice when Content-Encoding is already set", async () => {
    const pre = Buffer.from("already-encoded".repeat(200));
    const r = await call((_q, res) => {
      res.setHeader("Content-Type", "application/json");
      res.setHeader("Content-Encoding", "br");
      res.end(pre);
    }, "gzip");
    expect(r.headers["content-encoding"]).toBe("br");
    expect(r.body.equals(pre)).toBe(true);
  });

  it("leaves small bodies alone", async () => {
    const r = await call((_q, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end('{"ok":true}');
    }, "gzip");
    expect(r.headers["content-encoding"]).toBeUndefined();
    expect(r.body.toString()).toBe('{"ok":true}');
  });

  it("never holds back or encodes an event stream", async () => {
    const r = await call((_q, res) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.write("data: " + "x".repeat(2000) + "\n\n");
      res.end("data: done\n\n");
    }, "gzip");
    expect(r.headers["content-encoding"]).toBeUndefined();
    expect(r.body.toString()).toContain("data: done");
  });

  it("does not touch non-text bodies", async () => {
    const png = Buffer.alloc(5000, 1);
    const r = await call((_q, res) => {
      res.setHeader("Content-Type", "image/png");
      res.end(png);
    }, "gzip");
    expect(r.headers["content-encoding"]).toBeUndefined();
    expect(r.body.equals(png)).toBe(true);
  });
});
