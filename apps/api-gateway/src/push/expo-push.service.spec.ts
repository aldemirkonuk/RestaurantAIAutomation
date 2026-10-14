/**
 * The push report is three-way, and each way is reachable (ADR 0121 P0 item 1).
 *
 * WHY THIS SUITE EXISTS AT ALL
 * ----------------------------
 * The four-outcome report shipped on 2026-09-05, and `src/push/` held NO spec
 * file — the outcomes existed and nothing had ever executed the branch that
 * produces each one. `team.controller.broadcast.spec.ts` stubs
 * `sendToUsers` wholesale with `outcome: "accepted_by_service"`, so the whole
 * suite would have stayed green if this method went back to
 * `if (error || !data?.length) return;` — the exact body ADR 0121 measured as
 * reporting **notified: 11** against **0 rows** in `mobile_devices`.
 *
 * A guard whose failing branch has never executed is a guard with an untested
 * half. These six cases execute all of them.
 */

import { ExpoPushService } from "./expo-push.service";
import {
  asDatabaseService,
  makeStubDb,
  type StubDb,
} from "../team/testing/supabase-stub";

const PAYLOAD = { title: "Prep list", body: "Two cases arriving at four." };

function svc(db: StubDb): ExpoPushService {
  const s = new ExpoPushService(asDatabaseService(db));
  // The token fan-out is Expo's HTTP call and is not what this suite is about.
  // Stubbed so a green run can never depend on a network being up — a test that
  // passed because a network was down would be the first thing here to lie.
  (
    s as unknown as {
      sendToTokens: (
        tokens: string[],
      ) => Promise<{ accepted: number; refused: number; reasons: string[] }>;
    }
  ).sendToTokens = async (tokens) => ({
    accepted: tokens.length,
    refused: 0,
    reasons: [],
  });
  return s;
}

describe("ExpoPushService.sendToUsers reports what push actually did", () => {
  it("nobody addressed is `no_recipients`, and it is not a failure", async () => {
    const out = await svc(makeStubDb({ mobile_devices: [] })).sendToUsers(
      [],
      PAYLOAD,
    );
    expect(out.outcome).toBe("no_recipients");
    expect(out.tokens).toBe(0);
  });

  it("addressed people with no device is `no_device_registered`, NOT a send", async () => {
    // The production state ADR 0121 measured: 11 crew, 0 rows in mobile_devices.
    const out = await svc(makeStubDb({ mobile_devices: [] })).sendToUsers(
      ["u1", "u2", "u3"],
      PAYLOAD,
    );
    expect(out.outcome).toBe("no_device_registered");
    expect(out.tokens).toBe(0);
    // The count must come off DEVICES, never off the roster. Three people were
    // addressed and the honest answer is zero.
    expect(out.tokens).not.toBe(3);
    expect(out.detail).toMatch(/nowhere to send/i);
  });

  it("a failed device read is `read_failed`, kept apart from having no device", async () => {
    const db = makeStubDb(
      { mobile_devices: [] },
      { "mobile_devices:select": { message: "timeout" } },
    );
    const out = await svc(db).sendToUsers(["u1"], PAYLOAD);
    expect(out.outcome).toBe("read_failed");
    // THE WHOLE POINT. The old body returned identically for both, so this
    // assertion is the one that fails if the two branches are ever merged back.
    expect(out.outcome).not.toBe("no_device_registered");
    expect(out.detail).toMatch(/we do not know/i);
  });

  it("a registered device is `accepted_by_service` and counts DEVICES", async () => {
    const db = makeStubDb({
      mobile_devices: [
        { user_id: "u1", expo_push_token: "ExponentPushToken[a]" },
        { user_id: "u1", expo_push_token: "ExponentPushToken[b]" },
        { user_id: "u2", expo_push_token: "ExponentPushToken[c]" },
      ],
    });
    const out = await svc(db).sendToUsers(["u1", "u2"], PAYLOAD);
    expect(out.outcome).toBe("accepted_by_service");
    // Three devices for two people. A roster count would say 2.
    expect(out.tokens).toBe(3);
  });

  it("never says `delivered` — Expo holding it is not a handset showing it", async () => {
    const db = makeStubDb({
      mobile_devices: [{ user_id: "u1", expo_push_token: "ExponentPushToken[a]" }],
    });
    const out = await svc(db).sendToUsers(["u1"], PAYLOAD);
    expect(out.outcome).toBe("accepted_by_service");
    expect(out.detail).not.toMatch(/\bdelivered\b/i);
    expect(out.detail).toMatch(/not proof a handset showed it/i);
  });

  it("a throw is reported, not swallowed into a silent success", async () => {
    const db = makeStubDb({ mobile_devices: [] });
    const s = svc(db);
    (
      s as unknown as { databaseService: { supabase: { from: () => never } } }
    ).databaseService = {
      supabase: {
        from: () => {
          throw new Error("connection reset");
        },
      },
    };
    const out = await s.sendToUsers(["u1"], PAYLOAD);
    expect(out.outcome).toBe("read_failed");
    expect(out.tokens).toBe(0);
  });
});

/**
 * F-1696: Expo answers every message with a ticket, and a refused ticket is
 * not a push it took. A low-stock digest naming twenty wines was over Expo's
 * 4096-byte limit (`MessageTooBig`) and was still reported as
 * `accepted_by_service`. These run the real `sendToTokens` against a stubbed
 * Expo answer.
 */
describe("ExpoPushService.sendToUsers reads Expo's tickets (F-1696)", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  function expoAnswers(tickets: unknown[], status = 200) {
    global.fetch = jest.fn().mockResolvedValue({
      ok: status < 400,
      status,
      json: async () => ({ data: tickets }),
    }) as unknown as typeof fetch;
  }

  const twoDevices = () =>
    makeStubDb({
      mobile_devices: [
        { user_id: "u1", expo_push_token: "ExponentPushToken[a]" },
        { user_id: "u2", expo_push_token: "ExponentPushToken[b]" },
      ],
    });

  it("a push Expo refuses as too big is `refused_by_service`, never accepted", async () => {
    const tooBig = {
      status: "error",
      message: "Message too big",
      details: { error: "MessageTooBig" },
    };
    expoAnswers([tooBig, tooBig]);
    const out = await new ExpoPushService(
      asDatabaseService(twoDevices()),
    ).sendToUsers(["u1", "u2"], PAYLOAD);
    expect(out.outcome).toBe("refused_by_service");
    expect(out.tokens).toBe(0);
    expect(out.detail).toMatch(/MessageTooBig/);
  });

  it("counts only the devices Expo took, and says how many it refused", async () => {
    expoAnswers([
      { status: "ok", id: "t1" },
      {
        status: "error",
        message: "rate",
        details: { error: "MessageRateExceeded" },
      },
    ]);
    const out = await new ExpoPushService(
      asDatabaseService(twoDevices()),
    ).sendToUsers(["u1", "u2"], PAYLOAD);
    expect(out.outcome).toBe("accepted_by_service");
    expect(out.tokens).toBe(1);
    expect(out.detail).toMatch(/refused it for 1 more \(MessageRateExceeded\)/);
  });

  it("an HTTP refusal of the whole request is not an acceptance", async () => {
    expoAnswers([], 413);
    const out = await new ExpoPushService(
      asDatabaseService(twoDevices()),
    ).sendToUsers(["u1", "u2"], PAYLOAD);
    expect(out.outcome).toBe("refused_by_service");
    expect(out.detail).toMatch(/HTTP 413/);
  });
});
