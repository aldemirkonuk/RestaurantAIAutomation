/**
 * Jev's product egress fails OPEN: nothing the product does waits on Jev, and
 * no Jev failure breaks anything but that one reading (ADR 0207; the product
 * analogue of `scripts/check_jev_never_blocks.py`, which pins the same rule for
 * the coding-agent prompt gate, ADR 0182).
 *
 * "Fail open" here has a precise meaning, and it is NOT "send when unsure":
 *   - The SEND side stays fail-CLOSED (no acceptance, no switch, an unread
 *     language, an unreadable names list: nothing leaves). Those are pinned in
 *     `vendor-tone-scoring.service.spec.ts` and `sensitive-mask.spec.ts`.
 *   - The PRODUCT side is fail-OPEN: when TypeSafe is down, slow, redirecting,
 *     answering garbage, or the key is missing, the call resolves to a failed
 *     reading — it never throws, never hangs past its deadline — and no
 *     request a person makes (reading the vendor sheet, the scorecard, the
 *     mail, Settings) ever waits on it, because the only caller is the
 *     scheduled sweep.
 *
 * Each block below is a way that could stop being true: the client throwing
 * or hanging (section 1), a request path gaining a Jev call (section 2), and
 * what leaves carrying a name or a private topic (section 3, the masker, over
 * the one function every send goes through). The sweep's own per-house
 * isolation is in `vendor-tone-scoring.service.spec.ts` ("one house's Jev
 * failure does not stop the sweep").
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { JevToneScorer, TIMEOUT_MS } from "./jev-tone.client";
import { egressFor, type EgressPayload } from "./tone-egress";

const SRC = join(__dirname, "..");

function scorer(env: Record<string, string | undefined>): JevToneScorer {
  return new JevToneScorer({ get: (k: string) => env[k] } as never);
}

function payload(): EgressPayload {
  const p = egressFor(
    "Thanks for the order. The Barolo ships on Friday, sorry for the wait.",
    [],
  );
  if (!p) throw new Error("fixture: the payload did not build");
  return p;
}

describe("1. the client resolves to a failed reading — it never throws and never hangs", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
  });

  const cases: [string, () => typeof fetch][] = [
    ["the network refuses", () => (async () => { throw new TypeError("fetch failed"); }) as never],
    ["fetch throws before it returns a promise", () => (() => { throw new Error("boom"); }) as never],
    ["TypeSafe answers 503", () => (async () => new Response("down", { status: 503 })) as never],
    ["TypeSafe answers a body that is not JSON", () => (async () => new Response("<html>", { status: 200 })) as never],
    ["TypeSafe answers JSON null", () => (async () => new Response("null", { status: 200 })) as never],
    ["TypeSafe answers a hostile shape", () => (async () => new Response(JSON.stringify({ answers: { valence: { score: 99 } } }), { status: 200 })) as never],
    ["a redirect is refused (redirect: error)", () => (async () => { throw new TypeError("unexpected redirect"); }) as never],
  ];

  it.each(cases)("[REVERT-FAILS] %s: { ok: false }, no throw", async (_label, make) => {
    global.fetch = make();
    const out = await scorer({ JEV_API_KEY: "k-test" }).score(payload());
    expect(out.ok).toBe(false);
  });

  it("[REVERT-FAILS] a TypeSafe that never answers is abandoned at the deadline, not waited on", async () => {
    jest.useFakeTimers();
    let aborted = false;
    global.fetch = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          aborted = true;
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      })) as never;
    const pending = scorer({ JEV_API_KEY: "k-test" }).score(payload());
    await jest.advanceTimersByTimeAsync(TIMEOUT_MS);
    const out = await pending;
    expect(aborted).toBe(true);
    expect(out).toEqual({
      ok: false,
      reason: `Jev did not answer within ${TIMEOUT_MS / 1000} s`,
    });
  });

  it("with no key it is unavailable and sends nothing — a missing key is never an error", async () => {
    const calls: unknown[] = [];
    global.fetch = (async (...a: unknown[]) => {
      calls.push(a);
      return new Response("{}", { status: 200 });
    }) as never;
    const s = scorer({});
    expect(s.available()).toBe(false);
    await expect(s.score(payload())).resolves.toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
  });
});

/** Every non-spec `.ts` file under the gateway's `src`. */
function sourceFiles(dir = SRC): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (p.endsWith(".ts") && !p.endsWith(".spec.ts") && !p.endsWith(".test.ts"))
      out.push(p);
  }
  return out;
}

describe("2. no request a person makes waits on Jev — the sweep is the only caller", () => {
  const files = sourceFiles();
  const rel = (p: string) => relative(SRC, p);

  it("finds the gateway's sources (a scan that reads nothing is not a check)", () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.map(rel)).toContain(join("vendor-tone", "jev-tone.client.ts"));
  });

  it("[REVERT-FAILS] only the wiring, the sheet's availability read and the sweep import the Jev client", () => {
    const importers = files
      .filter((p) => /from\s+["'][./]*(?:vendor-tone\/)?jev-tone\.client["']/.test(readFileSync(p, "utf8")))
      .map(rel)
      .sort();
    expect(importers).toEqual(
      [
        join("providers", "providers.module.ts"),
        join("providers", "scorecard", "vendor-mail-tone.service.ts"),
        join("vendor-tone", "vendor-tone-scoring.service.ts"),
      ].sort(),
    );
  });

  it("[REVERT-FAILS] the vendor sheet's mail read asks only whether Jev is set up — it never scores", () => {
    const src = readFileSync(
      join(SRC, "providers", "scorecard", "vendor-mail-tone.service.ts"),
      "utf8",
    );
    expect(src).toMatch(/this\.scorer\?\.available\(\)/);
    expect(src).not.toMatch(/\.score\(/);
  });

  it("[REVERT-FAILS] no controller reaches the sweep or the client", () => {
    const leaks = files
      .filter((p) => p.endsWith(".controller.ts"))
      .filter((p) => /VendorToneScoringService|JevToneScorer|TONE_SCORER/.test(readFileSync(p, "utf8")))
      .map(rel);
    expect(leaks).toEqual([]);
  });

  it("[REVERT-FAILS] the sweep's one call to the scorer sits behind the schedule", () => {
    const src = readFileSync(
      join(SRC, "vendor-tone", "vendor-tone-scoring.service.ts"),
      "utf8",
    );
    expect(src.match(/this\.scorer\.score\(/g) ?? []).toHaveLength(1);
    expect(src).toMatch(/@Cron\(SWEEP_CRON/);
    // The scheduled entry swallows what escapes a run: a thrown sweep is a
    // log line, never an unhandled rejection in the gateway process.
    const scheduled = src.slice(src.indexOf("async scheduled()"), src.indexOf("async sweep()"));
    expect(scheduled).toMatch(/try \{[\s\S]*await this\.sweep\(\)[\s\S]*\} catch/);
  });
});

describe("3. what leaves is masked — names AND sensitive topics, in one message", () => {
  const text = [
    "Hi Selin,",
    "Sorry for the late reply. Ahmet is in the hospital after surgery, so Emre Demir is covering.",
    "We are also dealing with a funeral in the family this week.",
    "The Barolo ships on Friday; pay to IBAN DE89 3704 0044 0532 0130 00 as usual.",
    // A name the house's records hold, in a sentence that is neither private
    // nor a greeting or sign-off: only the known-names pass can take it.
    "Emre Demir confirmed the price for the Barolo yesterday.",
    "Call me on 0532 123 45 67 or write to deniz.kaya@kestrel.com.tr.",
    "Best,",
    "Deniz Kaya",
  ].join("\n");

  it("[REVERT-FAILS] sends no name, no private topic, no account, no phone and no address", () => {
    const p = egressFor(text, ["Selin Aksoy", "Emre Demir", "Deniz Kaya"]);
    expect(p).not.toBeNull();
    const wire = JSON.stringify(p!.body);
    for (const leak of [
      // names: a known one, one after a greeting, one in the body, the signer
      "Selin", "Emre", "Demir", "Deniz", "Kaya", "Ahmet",
      // sensitive topics (health, bereavement)
      "hospital", "surgery", "funeral",
      // shapes
      "DE89", "3704", "0532", "kestrel",
    ])
      expect(wire).not.toContain(leak);
    // It still carries the part that is about the order — the reading is
    // worth making — and says what it took out.
    expect(wire).toContain("Barolo");
    expect(wire).toContain("[private]");
    expect(wire).toContain("[name]");
  });

  it("the quote candidates are cut from the masked text, never the raw one", () => {
    const p = egressFor(text, ["Selin Aksoy", "Emre Demir", "Deniz Kaya"])!;
    const quotes = JSON.stringify(p.candidates);
    for (const leak of ["Selin", "Ahmet", "hospital", "funeral", "Deniz"])
      expect(quotes).not.toContain(leak);
  });
});
