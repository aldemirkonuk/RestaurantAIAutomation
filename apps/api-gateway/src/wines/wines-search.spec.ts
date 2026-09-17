import {
  BadRequestException,
  HttpException,
  HttpStatus,
  ServiceUnavailableException,
} from "@nestjs/common";
import { createClient } from "@supabase/supabase-js";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { WinesService } from "./wines.service";
import { WinesController } from "./wines.controller";
import { GetWinesQueryDto, WineSuggestionsQueryDto } from "./dto/wines.dto";

/**
 * GET /wines?search= and GET /wines/suggestions?text= built a PostgREST `or`
 * filter by pasting the raw input between `name.ilike.%` and `%`. postgrest-js
 * does not escape `or()` (2.103.0, dist/index.cjs:2952-2955 appends
 * `(${filters})` as given), so the input was PostgREST grammar, not data:
 *
 *  - a comma ends the condition. 417 of the 9,598 name/producer strings in
 *    datasets/menu_corpus/extracted/*.json contain one, so an ordinary wine
 *    name produced an unparseable filter and a 500 carrying the raw database
 *    message;
 *  - a crafted value adds conditions of its own (`id.not.is.null` widens the
 *    read to every row);
 *  - `%` and `_` were wildcards, so "100%" matched everything.
 *
 * These tests drive a REAL supabase-js client whose fetch is replaced by a
 * recorder, so what is asserted is the exact query string that would have left
 * the gateway. Nothing here reaches a network or a database.
 *
 * `orConditions` below is a MODEL of PostgREST's logic-tree grammar as its
 * documentation states it (reserved characters end an unquoted value; a value in
 * double quotes may contain them, with `\` escaping `"` and `\`). It is not the
 * server, and it was not run against one.
 */

type Recorded = { url: URL };

function recordingClient(
  respond: () => { status: number; body: unknown } = () => ({
    status: 200,
    body: [],
  }),
) {
  const calls: Recorded[] = [];
  const fakeFetch = async (input: unknown) => {
    calls.push({ url: new URL(String(input)) });
    const { status, body } = respond();
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  const client = createClient("http://postgrest.invalid", "test-anon-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fakeFetch as unknown as typeof fetch },
  });
  const service = new WinesService({ getClient: () => client } as any);
  return { service, calls };
}

/** Splits a PostgREST `or=(...)` value into `field op value` triples. */
function orConditions(orParam: string | null): string[] | "parse-error" {
  if (!orParam || !orParam.startsWith("(") || !orParam.endsWith(")")) {
    return "parse-error";
  }
  const body = orParam.slice(1, -1);
  const out: string[] = [];
  let i = 0;
  for (;;) {
    const head = /^([a-z_]+)\.([a-z]+)\./.exec(body.slice(i));
    if (!head) return "parse-error";
    i += head[0].length;
    let value = "";
    if (body[i] === '"') {
      i++;
      while (i < body.length && body[i] !== '"') {
        if (body[i] === "\\") i++;
        value += body[i];
        i++;
      }
      if (body[i] !== '"') return "parse-error";
      i++;
    } else {
      while (i < body.length && body[i] !== "," && body[i] !== ")") {
        value += body[i];
        i++;
      }
      if (body[i] === ")") return "parse-error";
    }
    out.push(`${head[1]} ${head[2]} ${value}`);
    if (i === body.length) return out;
    if (body[i] !== ",") return "parse-error";
    i++;
  }
}

const orOf = (calls: Recorded[]) => calls[0].url.searchParams.get("or");

describe("GET /wines search — the input is data, not PostgREST grammar", () => {
  it("keeps a plain search term byte-identical to what it always sent", async () => {
    const { service, calls } = recordingClient();
    await service.searchWines({ search: "Margaux" } as GetWinesQueryDto);
    expect(orOf(calls)).toBe("(name.ilike.%Margaux%,producer.ilike.%Margaux%)");
  });

  it("quotes a wine name with a comma, so it stays one condition", async () => {
    const { service, calls } = recordingClient();
    await service.searchWines({
      search: "Château Margaux, Pavillon Rouge",
    } as GetWinesQueryDto);
    expect(orOf(calls)).toBe(
      '(name.ilike."%Château Margaux, Pavillon Rouge%",producer.ilike."%Château Margaux, Pavillon Rouge%")',
    );
    expect(orConditions(orOf(calls))).toEqual([
      "name ilike %Château Margaux, Pavillon Rouge%",
      "producer ilike %Château Margaux, Pavillon Rouge%",
    ]);
  });

  it("cannot add a condition of its own", async () => {
    const { service, calls } = recordingClient();
    const hostile = "zzz%,id.not.is.null,name.ilike.%zzz";
    await service.searchWines({ search: hostile } as GetWinesQueryDto);
    expect(orOf(calls)).toBe(
      String.raw`(name.ilike."%zzz\\%,id.not.is.null,name.ilike.\\%zzz%",producer.ilike."%zzz\\%,id.not.is.null,name.ilike.\\%zzz%")`,
    );
    expect(orConditions(orOf(calls))).toEqual([
      String.raw`name ilike %zzz\%,id.not.is.null,name.ilike.\%zzz%`,
      String.raw`producer ilike %zzz\%,id.not.is.null,name.ilike.\%zzz%`,
    ]);
  });

  it("escapes quotes, parentheses, periods, backslashes and LIKE wildcards", async () => {
    const { service, calls } = recordingClient();
    await service.searchWines({
      search: String.raw`Dr. Loosen "Blue Slate" (Mosel) 100%_\ `.trimEnd(),
    } as GetWinesQueryDto);
    const value = String.raw`"%Dr. Loosen \"Blue Slate\" (Mosel) 100\\%\\_\\\\%"`;
    expect(orOf(calls)).toBe(`(name.ilike.${value},producer.ilike.${value})`);
    expect(orConditions(orOf(calls))).toEqual([
      String.raw`name ilike %Dr. Loosen "Blue Slate" (Mosel) 100\%\_\\%`,
      String.raw`producer ilike %Dr. Loosen "Blue Slate" (Mosel) 100\%\_\\%`,
    ]);
  });
});

describe("GET /wines/suggestions — same filter, same rule", () => {
  it("quotes a comma in the text", async () => {
    const { service, calls } = recordingClient();
    await service.getWineSuggestions({
      text: "Barolo, Riserva",
    } as WineSuggestionsQueryDto);
    expect(orConditions(orOf(calls))).toEqual([
      "name ilike %Barolo, Riserva%",
      "producer ilike %Barolo, Riserva%",
    ]);
  });
});

describe("a failed library read is a clean 503, never a raw 500", () => {
  const parseFailure = () => ({
    status: 400,
    body: {
      code: "PGRST100",
      message:
        '"failed to parse logic tree ((name.ilike.%a, b%))" (line 1, column 17)',
      details: "unexpected end of input",
      hint: null,
    },
  });

  it("searchWines maps a database error to ServiceUnavailableException without its text", async () => {
    const { service } = recordingClient(parseFailure);
    const failure = await service
      .searchWines({ search: "Margaux" } as GetWinesQueryDto)
      .catch((e) => e);
    expect(failure).toBeInstanceOf(ServiceUnavailableException);
    expect(
      JSON.stringify((failure as HttpException).getResponse()),
    ).not.toMatch(/logic tree/);
  });

  it("searchWines answers a malformed wine id in ids with a 400, not a 503", async () => {
    const { service } = recordingClient(() => ({
      status: 400,
      body: {
        code: "22P02",
        message: 'invalid input syntax for type uuid: "not-a-uuid"',
        details: null,
        hint: null,
      },
    }));
    const failure = await service
      .searchWines({ ids: "not-a-uuid" } as GetWinesQueryDto)
      .catch((e) => e);
    expect(failure).toBeInstanceOf(BadRequestException);
  });

  it("getWineSuggestions maps a database error to ServiceUnavailableException", async () => {
    const { service } = recordingClient(parseFailure);
    const failure = await service
      .getWineSuggestions({ text: "Margaux" } as WineSuggestionsQueryDto)
      .catch((e) => e);
    expect(failure).toBeInstanceOf(ServiceUnavailableException);
  });

  it("the controller passes the service's HTTP status through instead of rewriting it to 500", async () => {
    const controller = new WinesController(
      {
        searchWines: () =>
          Promise.reject(new ServiceUnavailableException("library down")),
      } as any,
      {} as any,
    );
    const failure = await controller
      .searchWines({} as GetWinesQueryDto)
      .catch((e) => e);
    expect(failure).toBeInstanceOf(HttpException);
    expect((failure as HttpException).getStatus()).toBe(
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  });

  it("the controller does not put an unexpected error's text on the wire", async () => {
    const controller = new WinesController(
      {
        searchWines: () =>
          Promise.reject(new Error('column "secret_col" does not exist')),
      } as any,
      {} as any,
    );
    const failure = await controller
      .searchWines({} as GetWinesQueryDto)
      .catch((e) => e);
    expect((failure as HttpException).getStatus()).toBe(
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
    expect(
      JSON.stringify((failure as HttpException).getResponse()),
    ).not.toMatch(/secret_col/);
  });
});

describe("GetWinesQueryDto and WineSuggestionsQueryDto bound their inputs", () => {
  const errorsFor = async (cls: any, plain: Record<string, unknown>) =>
    (await validate(plainToInstance(cls, plain) as object)).map(
      (e) => e.property,
    );

  it("accepts the largest search and limit a real caller sends", async () => {
    // useWineLibraryPage.ts:98 and useCellarNextData.ts:59 send limit=500; the
    // longest name/producer in the local menu corpus is 63 characters.
    expect(
      await errorsFor(GetWinesQueryDto, {
        search: "a".repeat(200),
        limit: "500",
      }),
    ).toEqual([]);
  });

  it("refuses a search longer than 200 characters", async () => {
    expect(
      await errorsFor(GetWinesQueryDto, { search: "a".repeat(201) }),
    ).toEqual(["search"]);
  });

  it("refuses a limit above 500 and a fractional limit", async () => {
    expect(await errorsFor(GetWinesQueryDto, { limit: "501" })).toEqual([
      "limit",
    ]);
    expect(await errorsFor(GetWinesQueryDto, { limit: "1.5" })).toEqual([
      "limit",
    ]);
  });

  it("bounds suggestion text and limit the same way", async () => {
    expect(
      await errorsFor(WineSuggestionsQueryDto, {
        text: "a".repeat(201),
        limit: "51",
      }),
    ).toEqual(["text", "limit"]);
    expect(
      await errorsFor(WineSuggestionsQueryDto, { text: "Barolo", limit: "10" }),
    ).toEqual([]);
  });
});
