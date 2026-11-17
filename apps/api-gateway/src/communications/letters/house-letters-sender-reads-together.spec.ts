/**
 * GET /communications/letters/sender answers from three independent reads: the
 * sender identity, whether this person's hold sends, and the inbox reader's
 * standing. They used to run one after another, so every Mail poll waited for
 * the sum of three database round trips. They now start together; the answer
 * is the same.
 */
import { HouseLettersController } from "./house-letters.controller";

const HOUSE = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const PERSON = "dddddddd-0000-4000-8000-dddddddddddd";

function gate<T>() {
  let release!: (v: T) => void;
  let fail!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    release = res;
    fail = rej;
  });
  return { promise, release, fail };
}

function build() {
  const g = { identity: gate<any>(), send: gate<any>(), status: gate<any>() };
  const started: string[] = [];
  const sender = { resolve: jest.fn(() => (started.push("identity"), g.identity.promise)) };
  const letters = { sendOrAsk: jest.fn(() => (started.push("sendOrAsk"), g.send.promise)) };
  const inbox = { statusFor: jest.fn(() => (started.push("statusFor"), g.status.promise)) };
  const controller = new HouseLettersController(
    letters as any,
    sender as any,
    { lastRun: () => "dispatcher-run" } as any,
    { lastRun: () => "reader-run" } as any,
    inbox as any,
  );
  return { g, started, controller };
}

const USER = { userId: PERSON, restaurantId: HOUSE } as any;

describe("the sender route starts its three reads together", () => {
  it("all three reads are under way before the first one answers", async () => {
    const { g, started, controller } = build();
    const out = controller.senderIdentity(USER);
    await Promise.resolve();
    expect(started.sort()).toEqual(["identity", "sendOrAsk", "statusFor"]);
    g.identity.release({ kind: "house", words: "w" });
    g.send.release({ readable: true, maySend: true });
    g.status.release({ connected: true });
    const body: any = await out;
    expect(body.kind).toBe("house");
    expect(body.sendOrAsk).toEqual({ readable: true, maySend: true });
    expect(body.reader).toEqual({ lastRun: "reader-run", connected: true });
    expect(body.dispatcher).toBe("dispatcher-run");
  });

  it("a failed read still fails the route, never a half answer", async () => {
    const { g, controller } = build();
    const out = controller.senderIdentity(USER);
    g.identity.release({ kind: "house" });
    g.send.fail(new Error("read failed"));
    g.status.release({});
    await expect(out).rejects.toThrow("read failed");
  });
});
