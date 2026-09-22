/**
 * The Jev adapter against a REAL local HTTP server (ADR 0207, round 3). The
 * unit under test is the adapter — its request, its refusal to follow a
 * redirect, and its reading of the reply — so nothing of it is stood in for;
 * only the far end is a loopback server this spec owns.
 */

import { createServer, IncomingMessage, Server, ServerResponse } from "http";
import { AddressInfo } from "net";
import { ConfigService } from "@nestjs/config";
import {
  ENDPOINT_OVERRIDE_VAR,
  JevToneScorer,
  loopbackOnly,
} from "./jev-tone.client";
import { egressFor } from "./tone-egress";

type Handler = (
  req: IncomingMessage,
  body: string,
  res: ServerResponse,
) => void;

let server: Server;
let base = "";
let handler: Handler = () => undefined;
const heard: { path: string; auth: string | undefined; body: string }[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      heard.push({
        path: req.url ?? "",
        auth: req.headers.authorization,
        body,
      });
      handler(req, body, res);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});
beforeEach(() => {
  heard.length = 0;
});

function scorer(env: Record<string, string | undefined>) {
  return new JevToneScorer(new ConfigService(env));
}

const payload = () =>
  egressFor(
    "Hi Deniz,\nSorry, the truck broke down. We can deliver Monday.\nBest,\nCan",
    ["Deniz"],
  )!;

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

describe("JevToneScorer", () => {
  it("posts the masked request with the bearer and reads a well-formed reply", async () => {
    handler = (_req, _body, res) =>
      json(res, 200, {
        model: "jev-1.13",
        answers: {
          valence: { score: 1, confidence: 0.9 },
          friction: { noul: 0.2 },
          urgency: { noul: 0.1 },
          commitment: { noul: 0.8 },
          apology: { noul: 0.95 },
          escalation: { noul: 0 },
          quote: { choice: "s1", confidence: 0.6 },
        },
      });
    const s = scorer({
      JEV_API_KEY: "k-test",
      [ENDPOINT_OVERRIDE_VAR]: `${base}/v1/systemone`,
    });
    const out = await s.score(payload());
    expect(out).toEqual({
      ok: true,
      score: expect.objectContaining({
        valence: -0.5,
        apology: 0.95,
        quoteIndex: 1,
        modelVersion: "jev-1.13",
      }),
    });
    expect(heard).toHaveLength(1);
    expect(heard[0].auth).toBe("Bearer k-test");
    expect(heard[0].body).not.toContain("Deniz");
    expect(heard[0].body).not.toMatch(/\bCan\b/);
  });

  it("never follows a redirect — the bearer does not reach the Location", async () => {
    handler = (req, _body, res) => {
      if (req.url === "/steal") return json(res, 200, {});
      res.writeHead(302, { Location: `${base}/steal` });
      res.end();
    };
    const s = scorer({
      JEV_API_KEY: "k-test",
      [ENDPOINT_OVERRIDE_VAR]: `${base}/v1/systemone`,
    });
    const out = await s.score(payload());
    expect(out.ok).toBe(false);
    expect(heard.map((h) => h.path)).toEqual(["/v1/systemone"]);
  });

  it("reads a non-200, a non-JSON body or an out-of-range answer as a failed reading", async () => {
    const s = scorer({
      JEV_API_KEY: "k-test",
      [ENDPOINT_OVERRIDE_VAR]: `${base}/v1/systemone`,
    });
    handler = (_q, _b, res) => json(res, 529, { error: "overloaded" });
    expect(await s.score(payload())).toEqual({
      ok: false,
      reason: "Jev answered HTTP 529",
    });
    handler = (_q, _b, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("not json");
    };
    expect(await s.score(payload())).toEqual({
      ok: false,
      reason: "Jev answered with no JSON",
    });
    handler = (_q, _b, res) =>
      json(res, 200, { answers: { valence: { score: 9, confidence: 1 } } });
    expect((await s.score(payload())).ok).toBe(false);
  });

  it("with no key is unavailable and sends nothing", async () => {
    const s = scorer({ [ENDPOINT_OVERRIDE_VAR]: `${base}/v1/systemone` });
    expect(s.available()).toBe(false);
    expect(await s.score(payload())).toEqual({
      ok: false,
      reason: "Jev is not set up on this server (no key)",
    });
    expect(heard).toHaveLength(0);
  });

  it("takes the endpoint override only when it names this machine", () => {
    expect(loopbackOnly("http://127.0.0.1:9/x")).toBe("http://127.0.0.1:9/x");
    expect(loopbackOnly("http://localhost:9/x")).toBe("http://localhost:9/x");
    expect(loopbackOnly("http://[::1]:9/x")).toBe("http://[::1]:9/x");
    expect(loopbackOnly("https://evil.example/x")).toBeNull();
    expect(loopbackOnly("http://127.0.0.1.evil.example/x")).toBeNull();
    expect(loopbackOnly("not a url")).toBeNull();
    expect(loopbackOnly(undefined)).toBeNull();
  });
});
