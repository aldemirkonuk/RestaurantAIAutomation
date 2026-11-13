/**
 * About ninety places print `error.response.data.message` before
 * `error.message`. Nest's list of field messages then showed as a run-on line
 * (or "a,b"), and its stock names ("Forbidden resource", "Internal server
 * error") showed as if they were reasons. The shared client now puts the same
 * sentence it puts on `.message` into the body's `message`, so those readers
 * say it too, whatever the status.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AxiosError,
  type AxiosAdapter,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import { apiClient, getErrorMessage, sayPlainly } from "./client";

type Body = Record<string, unknown> & {
  message?: unknown;
  messageAsSent?: unknown;
};
type Failure = AxiosError<Body> & { transportMessage?: string };

let original: AxiosAdapter | readonly unknown[] | string | undefined;
beforeEach(() => {
  original = apiClient.defaults.adapter as typeof original;
});
afterEach(() => {
  apiClient.defaults.adapter = original as typeof apiClient.defaults.adapter;
});

/** Answer the next request with this status and body, through the real interceptor. */
async function refusedWith(status: number, data: unknown): Promise<Failure> {
  apiClient.defaults.adapter = async (cfg: InternalAxiosRequestConfig) => {
    const response = {
      status,
      statusText: "",
      headers: {},
      config: cfg,
      data,
    } as AxiosResponse;
    throw new AxiosError(
      `Request failed with status code ${status}`,
      status >= 500 ? "ERR_BAD_RESPONSE" : "ERR_BAD_REQUEST",
      cfg,
      {},
      response,
    );
  };
  return (await apiClient
    .post("/api/v1/anything", {})
    .then(() => {
      throw new Error("expected a refusal");
    })
    .catch((e: unknown) => e)) as Failure;
}

/** The reader most surfaces use: `data.message || error.message`. */
function whatAPagePrints(err: Failure): unknown {
  return err.response?.data?.message || err.message;
}

function expectNoTransportWords(text: unknown) {
  expect(typeof text).toBe("string");
  expect(text as string).not.toMatch(/status code|axios|network error/i);
}

describe("a refusal's body says the same sentence as .message", () => {
  it("400: Nest's list of field messages becomes one sentence", async () => {
    const err = await refusedWith(400, {
      statusCode: 400,
      message: ["name should not be empty", "price must be a positive number"],
      error: "Bad Request",
    });
    expect(err.message).toBe(
      "name should not be empty; price must be a positive number.",
    );
    expect(err.response?.data.message).toBe(err.message);
    expect(err.response?.data.messageAsSent).toEqual([
      "name should not be empty",
      "price must be a positive number",
    ]);
    expect(whatAPagePrints(err)).toBe(err.message);
    expectNoTransportWords(whatAPagePrints(err));
  });

  it("403: the guard's stock 'Forbidden resource' becomes a plain sentence", async () => {
    const err = await refusedWith(403, {
      statusCode: 403,
      message: "Forbidden resource",
      error: "Forbidden",
    });
    expect(err.message).toBe("You do not have access to that.");
    expect(err.response?.data.message).toBe("You do not have access to that.");
    expect(err.response?.data.messageAsSent).toBe("Forbidden resource");
    expect(err.response?.data.error).toBe("Forbidden");
  });

  it("404: an unknown route and a stock 'Not Found' both say it plainly", async () => {
    for (const message of ["Cannot POST /api/v1/anything", "Not Found"]) {
      const err = await refusedWith(404, {
        statusCode: 404,
        message,
        error: "Not Found",
      });
      expect(err.response?.data.message).toBe(
        "That could not be found. It may have been removed.",
      );
      expect(err.response?.data.messageAsSent).toBe(message);
    }
  });

  it("409: a worded refusal is kept word for word, and nothing is set aside", async () => {
    const said = "Someone changed this order a moment ago. Reload it first.";
    const err = await refusedWith(409, {
      statusCode: 409,
      message: said,
      code: "STALE_ORDER",
    });
    expect(err.message).toBe(said);
    expect(err.response?.data.message).toBe(said);
    expect(err.response?.data).not.toHaveProperty("messageAsSent");
    expect(err.response?.data.code).toBe("STALE_ORDER");
  });

  it("422: one field message is said as a sentence, not a one-item list", async () => {
    const err = await refusedWith(422, {
      statusCode: 422,
      message: ["quantity must not be less than 1"],
    });
    expect(err.response?.data.message).toBe("quantity must not be less than 1.");
    expect(Array.isArray(err.response?.data.message)).toBe(false);
  });

  it("422: a list with nothing worded in it falls back to the plain sentence", async () => {
    const err = await refusedWith(422, {
      statusCode: 422,
      message: ["", "Unprocessable Entity"],
    });
    expect(err.response?.data.message).toBe(
      "That was not accepted as written. Check the fields and try again.",
    );
  });

  it("429: the gateway's wait sentence is kept; a stock throttle name is not", async () => {
    const wait = "Too many sign-in tries. Wait 10 minutes, then try again.";
    const worded = await refusedWith(429, { statusCode: 429, message: wait });
    expect(worded.response?.data.message).toBe(wait);

    const stock = await refusedWith(429, {
      statusCode: 429,
      message: "ThrottlerException: Too Many Requests",
    });
    expect(stock.response?.data.message).toBe(
      "Too many tries just now. Wait a moment, then try again.",
    );
  });

  it("500: a stock 'Internal server error' is neutral; a worded fail-closed 500 is kept", async () => {
    const stock = await refusedWith(500, {
      statusCode: 500,
      message: "Internal server error",
    });
    expect(stock.response?.data.message).toBe(
      "The server ran into a problem before it could confirm that.",
    );
    expectNoTransportWords(whatAPagePrints(stock));

    const said = "The house settings could not be read, so nothing was changed.";
    const worded = await refusedWith(500, { statusCode: 500, message: said });
    expect(worded.response?.data.message).toBe(said);
  });

  it("getErrorMessage and a body reader agree after the rewrite", async () => {
    const err = await refusedWith(400, {
      message: ["email must be an email"],
    });
    expect(getErrorMessage(err)).toBe(err.response?.data.message);
  });
});

describe("what the rewrite leaves alone", () => {
  it("a body with no message gets none added; .message still says it", async () => {
    const err = await refusedWith(400, { statusCode: 400, error: "Bad Request" });
    expect(err.response?.data).not.toHaveProperty("message");
    expect(err.message).toBe(
      "That was not accepted as written. Check the fields and try again.",
    );
  });

  it("a text body (a proxy's HTML page) is left as text", async () => {
    const html = "<html><body>502 Bad Gateway</body></html>";
    const err = await refusedWith(502, html);
    expect(err.response?.data).toBe(html);
    expect(err.message).toBe(
      "The server ran into a problem before it could confirm that.",
    );
  });

  it("a frozen body is left as sent, and the refusal still rejects with the sentence", async () => {
    const body = Object.freeze({ message: "Forbidden resource" });
    const err = await refusedWith(403, body);
    expect(err.response?.data.message).toBe("Forbidden resource");
    expect(err.message).toBe("You do not have access to that.");
  });

  it("is said once: a second pass does not set the sentence aside as sent", () => {
    const config = { headers: {} } as InternalAxiosRequestConfig;
    const err = new AxiosError(
      "Request failed with status code 403",
      "ERR_BAD_REQUEST",
      config,
      {},
      {
        status: 403,
        statusText: "",
        headers: {},
        config,
        data: { message: "Forbidden resource" },
      } as AxiosResponse,
    ) as Failure;
    sayPlainly(err);
    sayPlainly(err);
    expect(err.response?.data.messageAsSent).toBe("Forbidden resource");
    expect(err.response?.data.message).toBe("You do not have access to that.");
  });
});
