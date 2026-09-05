/**
 * "Act safely and healthy" — the founder, 2026-09-05, about his own API key.
 *
 * These tests are that sentence. Every one of them is about a credential NOT
 * appearing somewhere, or a refusal saying a true thing about a deployment.
 * Nothing here goes outbound: the HTTP call is injected.
 */

import {
  SAFETY_MARGIN_MS,
  TUIK_CLIENT_ID,
  TUIK_KEY_ENV,
  TUIK_TOKEN_URL,
  TuikTokenHolder,
  scrubSecrets,
  type HttpPost,
} from "./tuik-token";

/** A key-shaped string. Never a real one, and never in the repository. */
const FAKE_KEY = "kkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkkk";
const FAKE_TOKEN =
  "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJwcm9iZSIsImV4cCI6OTk5OX0.c2lnbmF0dXJlLXBsYWNlaG9sZGVy";

interface Call {
  url: string;
  body: string;
  headers: Record<string, string>;
}

function holderWith(
  reply: { status: number; text: string },
  calls: Call[] = [],
  now = { t: 1_000_000 },
) {
  const post: HttpPost = async (url, body, headers) => {
    calls.push({ url, body: body.toString(), headers });
    return reply;
  };
  return { holder: new TuikTokenHolder(post, () => now.t), calls, now };
}

const OK_REPLY = {
  status: 200,
  text: JSON.stringify({ access_token: FAKE_TOKEN, expires_in: 300 }),
};

describe("an unset environment refuses in words, naming the variable", () => {
  it("does not call the token endpoint at all", async () => {
    // A missing credential and a broken publisher are different facts and must
    // not render alike. This one is a DEPLOYMENT fact.
    const { holder, calls } = holderWith(OK_REPLY);
    const out = await holder.get({} as NodeJS.ProcessEnv);
    expect(calls).toHaveLength(0);
    expect(out.token).toBeNull();
    expect(out.refusal).toBe("key_not_configured");
    expect(out.detail).toContain(TUIK_KEY_ENV);
    expect(out.detail).toMatch(/never given the credential, not a publisher that refused us/);
  });

  it("treats an empty or whitespace value as unset", async () => {
    const { holder } = holderWith(OK_REPLY);
    for (const value of ["", "   "]) {
      const out = await holder.get({ [TUIK_KEY_ENV]: value } as NodeJS.ProcessEnv);
      expect(out.refusal).toBe("key_not_configured");
    }
  });

  it("reports whether THIS environment holds it, without reading the value out", async () => {
    const { holder } = holderWith(OK_REPLY);
    expect(holder.configured({} as NodeJS.ProcessEnv)).toBe(false);
    expect(holder.configured({ [TUIK_KEY_ENV]: FAKE_KEY } as NodeJS.ProcessEnv)).toBe(true);
  });
});

describe("the key goes into the form body and NOWHERE else", () => {
  it("posts the documented grant to the documented endpoint", async () => {
    const { holder, calls } = holderWith(OK_REPLY);
    const out = await holder.get({ [TUIK_KEY_ENV]: FAKE_KEY } as NodeJS.ProcessEnv);
    expect(out.token).toBe(FAKE_TOKEN);
    expect(calls[0].url).toBe(TUIK_TOKEN_URL);
    expect(calls[0].body).toContain(`client_id=${TUIK_CLIENT_ID}`);
    expect(calls[0].body).toContain("grant_type=password");
    expect(calls[0].body).toContain(`api_key=${FAKE_KEY}`);
  });

  it("never puts the key in a HEADER, where a proxy log would keep it", async () => {
    const { holder, calls } = holderWith(OK_REPLY);
    await holder.get({ [TUIK_KEY_ENV]: FAKE_KEY } as NodeJS.ProcessEnv);
    expect(JSON.stringify(calls[0].headers)).not.toContain(FAKE_KEY);
    expect(calls[0].headers["User-Agent"]).toMatch(/Mudavym/);
  });
});

describe("no failure path carries a credential into a message", () => {
  it("a refused credential yields the STATUS and nothing from the body", async () => {
    // A rejected credential's response is the single most plausible place for
    // an echoed key to appear.
    const { holder } = holderWith({
      status: 401,
      text: JSON.stringify({ error: "invalid_grant", api_key: FAKE_KEY, hint: FAKE_TOKEN }),
    });
    const out = await holder.get({ [TUIK_KEY_ENV]: FAKE_KEY } as NodeJS.ProcessEnv);
    expect(out.refusal).toBe("refused_by_issuer");
    expect(out.detail).toContain("HTTP 401");
    expect(out.detail).not.toContain(FAKE_KEY);
    expect(out.detail).not.toContain(FAKE_TOKEN);
    expect(out.detail).toMatch(/no detail from the response is repeated here/);
  });

  it("a non-JSON 200 says so without repeating the body", async () => {
    const { holder } = holderWith({ status: 200, text: `<html>${FAKE_TOKEN}</html>` });
    const out = await holder.get({ [TUIK_KEY_ENV]: FAKE_KEY } as NodeJS.ProcessEnv);
    expect(out.refusal).toBe("unreadable_response");
    expect(out.detail).not.toContain(FAKE_TOKEN);
    expect(out.detail).toMatch(/where a credential would be/);
  });

  it("a 200 with no access_token is named, not treated as success", async () => {
    const { holder } = holderWith({ status: 200, text: JSON.stringify({ expires_in: 300 }) });
    const out = await holder.get({ [TUIK_KEY_ENV]: FAKE_KEY } as NodeJS.ProcessEnv);
    expect(out.refusal).toBe("no_token_in_response");
    expect(out.token).toBeNull();
  });

  it("a thrown fetch error is scrubbed before it becomes a message", async () => {
    const post: HttpPost = async () => {
      throw new Error(`connect ECONNREFUSED while sending api_key=${FAKE_KEY}`);
    };
    const holder = new TuikTokenHolder(post);
    const out = await holder.get({ [TUIK_KEY_ENV]: FAKE_KEY } as NodeJS.ProcessEnv);
    expect(out.detail).not.toContain(FAKE_KEY);
    expect(out.detail).toContain("[redacted]");
  });

  it("the scrubber catches both a JWT and a long key-shaped run", () => {
    expect(scrubSecrets(`Bearer ${FAKE_TOKEN}`)).toContain("[token redacted]");
    expect(scrubSecrets(`Bearer ${FAKE_TOKEN}`)).not.toContain(FAKE_TOKEN);
    expect(scrubSecrets(`api_key=${FAKE_KEY}`)).not.toContain(FAKE_KEY);
    // And it leaves ordinary prose alone, or nobody would keep it.
    expect(scrubSecrets("The token endpoint answered HTTP 401.")).toBe(
      "The token endpoint answered HTTP 401.",
    );
  });
});

describe("the 300-second life, with a margin", () => {
  it("reuses the token inside its life rather than re-minting on every call", async () => {
    const { holder, calls, now } = holderWith(OK_REPLY);
    const env = { [TUIK_KEY_ENV]: FAKE_KEY } as NodeJS.ProcessEnv;
    await holder.get(env);
    now.t += 100_000; // 100s into a 300s life
    await holder.get(env);
    expect(calls).toHaveLength(1);
  });

  it("treats the token as dead a MARGIN before it expires", async () => {
    // A cache expiring exactly on the boundary hands a token to a request that
    // arrives a second later and spends a 401 to find out.
    const { holder, calls, now } = holderWith(OK_REPLY);
    const env = { [TUIK_KEY_ENV]: FAKE_KEY } as NodeJS.ProcessEnv;
    await holder.get(env);
    now.t += 300_000 - SAFETY_MARGIN_MS - 1_000; // just inside
    await holder.get(env);
    expect(calls).toHaveLength(1);
    now.t += 2_000; // now past the margin, still before the real expiry
    await holder.get(env);
    expect(calls).toHaveLength(2);
  });

  it("falls back to 300 seconds when the issuer states no life", async () => {
    const { holder, calls, now } = holderWith({
      status: 200,
      text: JSON.stringify({ access_token: FAKE_TOKEN }),
    });
    const env = { [TUIK_KEY_ENV]: FAKE_KEY } as NodeJS.ProcessEnv;
    await holder.get(env);
    now.t += 100_000;
    await holder.get(env);
    expect(calls).toHaveLength(1);
    // Never forever: a token cached forever is a 401 on every call after five
    // minutes, discovered the expensive way.
    now.t += 400_000;
    await holder.get(env);
    expect(calls).toHaveLength(2);
  });
});

describe("the request budget is ours, and it refuses", () => {
  it("spends down and then says no", () => {
    const { holder } = holderWith(OK_REPLY);
    expect(holder.spend(2)).toBe(true);
    expect(holder.spend(2)).toBe(true);
    expect(holder.spend(2)).toBe(false);
    expect(holder.spentSoFar().spent).toBe(2);
  });

  it("starts a new day rather than carrying yesterday's spend forever", () => {
    const { holder, now } = holderWith(OK_REPLY);
    expect(holder.spend(1)).toBe(true);
    expect(holder.spend(1)).toBe(false);
    now.t += 26 * 60 * 60 * 1000;
    expect(holder.spend(1)).toBe(true);
  });
});
