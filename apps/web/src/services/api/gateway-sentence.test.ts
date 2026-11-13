/**
 * Every sheet and form printed "Request failed with status code 400" where
 * the gateway had sent its own sentence. The shared request path now puts
 * that sentence on `error.message`, and `getErrorMessage` returns it.
 */
import { describe, expect, it } from "vitest";
import {
  AxiosError,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from "axios";
import { gatewaySentence, requestFailureSentence } from "./gateway-sentence";
import { apiClient, getErrorMessage, sayPlainly } from "./client";

const config = { headers: {} } as InternalAxiosRequestConfig;

function failed(status: number, data: unknown): AxiosError {
  const response = {
    status,
    statusText: "",
    headers: {},
    config,
    data,
  } as AxiosResponse;
  return new AxiosError(
    `Request failed with status code ${status}`,
    "ERR_BAD_REQUEST",
    config,
    {},
    response,
  );
}

describe("gatewaySentence — the gateway own words", () => {
  it("reads the message the gateway sent", () => {
    expect(
      gatewaySentence(
        failed(400, {
          statusCode: 400,
          message: "An entry cannot end before the day it starts.",
        }),
      ),
    ).toBe("An entry cannot end before the day it starts.");
  });

  it("joins Nest's list of field messages into one sentence", () => {
    expect(
      gatewaySentence(
        failed(400, {
          message: ["title should not be empty", "eventTime must be a time."],
        }),
      ),
    ).toBe("title should not be empty; eventTime must be a time.");
  });

  it("reads `error` when there is no message, and a nested message object", () => {
    expect(
      gatewaySentence(
        failed(409, { error: "That bottle was already counted." }),
      ),
    ).toBe("That bottle was already counted.");
    expect(
      gatewaySentence(
        failed(400, {
          message: { message: "That vendor is not in this house." },
        }),
      ),
    ).toBe("That vendor is not in this house.");
  });

  it("ignores Nest's stock name for a status, an unknown route, and an HTML page", () => {
    expect(
      gatewaySentence(
        failed(400, { message: "Bad Request", error: "Bad Request" }),
      ),
    ).toBeNull();
    expect(
      gatewaySentence(failed(403, { message: "Forbidden resource" })),
    ).toBeNull();
    expect(
      gatewaySentence(failed(500, { message: "Internal server error" })),
    ).toBeNull();
    expect(
      gatewaySentence(
        failed(429, { message: "ThrottlerException: Too Many Requests" }),
      ),
    ).toBeNull();
    expect(
      gatewaySentence(failed(404, { message: "Cannot POST /api/v1/nowhere" })),
    ).toBeNull();
    expect(
      gatewaySentence(failed(502, "<html><body>Bad gateway</body></html>")),
    ).toBeNull();
  });

  it("keeps a worded 5xx: some routes fail closed with a sentence on purpose", () => {
    expect(
      gatewaySentence(
        failed(500, {
          message: "The week could not be read. Nothing was changed.",
        }),
      ),
    ).toBe("The week could not be read. Nothing was changed.");
  });
});

describe("requestFailureSentence — a plain sentence when the gateway gave none", () => {
  it.each([
    [400, /not accepted as written/],
    [401, /session has ended/],
    [403, /do not have access/],
    [404, /could not be found/],
    [409, /changed since this page read it/],
    [429, /Too many tries/],
    [503, /before it could confirm that/],
  ])("says %i in words, never as a code", (status, words) => {
    const said = requestFailureSentence(
      failed(status, { message: "Bad Request" }),
    )!;
    expect(said).toMatch(words);
    expect(said).not.toMatch(/status code|\d{3}/);
  });

  it("tells a timeout from a dropped connection, and leaves a cancellation alone", () => {
    expect(
      requestFailureSentence(
        new AxiosError(
          "timeout of 30000ms exceeded",
          "ECONNABORTED",
          config,
          {},
        ),
      ),
    ).toMatch(/took too long/);
    expect(
      requestFailureSentence(
        new AxiosError("Network Error", "ERR_NETWORK", config, {}),
      ),
    ).toMatch(/did not answer/);
    expect(
      requestFailureSentence(
        new AxiosError("canceled", "ERR_CANCELED", config),
      ),
    ).toBeNull();
    expect(requestFailureSentence(new Error("a page bug"))).toBeNull();
  });
});

describe("getErrorMessage — one string, the gateway sentence first", () => {
  it("returns the gateway sentence, then a plain one, then the error own message", () => {
    expect(
      getErrorMessage(
        failed(400, { message: "That order is not in this house." }),
      ),
    ).toBe("That order is not in this house.");
    expect(getErrorMessage(failed(400, {}))).toMatch(/not accepted as written/);
    expect(getErrorMessage(new Error("Pick a vendor first."))).toBe(
      "Pick a vendor first.",
    );
    expect(getErrorMessage("nonsense")).toBe("An unexpected error occurred");
  });
});

describe("the shared client — every failed request carries the sentence on .message", () => {
  it("rejects with the gateway sentence, keeping the transport text aside", async () => {
    const original = apiClient.defaults.adapter;
    apiClient.defaults.adapter = async (cfg) => {
      const response = {
        status: 400,
        statusText: "Bad Request",
        headers: {},
        config: cfg,
        data: {
          statusCode: 400,
          message: "An entry cannot end before the day it starts.",
          error: "Bad Request",
        },
      } as AxiosResponse;
      throw new AxiosError(
        "Request failed with status code 400",
        "ERR_BAD_REQUEST",
        cfg,
        {},
        response,
      );
    };
    try {
      const err = (await apiClient
        .post("/calendar/events", {})
        .catch((e: unknown) => e)) as AxiosError & {
        transportMessage?: string;
      };
      expect(err.message).toBe("An entry cannot end before the day it starts.");
      expect(err.transportMessage).toBe("Request failed with status code 400");
      expect(err.response?.status).toBe(400);
    } finally {
      apiClient.defaults.adapter = original;
    }
  });

  it("is said once: a second pass leaves the sentence as it is", () => {
    const err = sayPlainly(failed(400, { message: "First." }));
    (err.response!.data as { message: string }).message = "Second.";
    sayPlainly(err);
    expect(err.message).toBe("First.");
  });
});
