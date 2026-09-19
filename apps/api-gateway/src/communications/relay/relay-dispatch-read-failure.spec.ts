/**
 * ADR 0161 — the person door's dispatcher tells an unreadable queue apart from
 * an empty one.
 *
 * `dispatchQueued` used to answer a failed `relay_email_queue` read with
 * `{ considered: 0, sent: 0, failed: 0, skipped: 0 }` — byte for byte what it
 * answers when nothing is due — so `RelayEmailCron` recorded `error: null` and
 * a database outage read as a quiet minute for as long as it lasted. The cases
 * below are the same call with one difference: whether the read failed.
 *
 * `dispatchQueued` touches nothing but `db` until the read succeeds, so the
 * service is built directly here rather than through the doors suite's whole
 * Nest app (relay-email.doors.spec.ts proves the HTTP seam; this proves the
 * cron's own contract).
 */

import { DatabaseService } from "../../database/database.service";
import { RelayEmailCron } from "./relay-email.cron";
import { RelayEmailService } from "./relay-email.service";

function dbWhoseQueueRead(result: {
  data: unknown[] | null;
  error: { message: string } | null;
}) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "lte", "limit"]) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  return { client: { from: () => chain } } as unknown as DatabaseService;
}

function cronOver(db: DatabaseService) {
  // Every collaborator past the read is unreachable on these paths.
  const none = {} as never;
  const relay = new RelayEmailService(db, none, none, none, none, none);
  return { relay, cron: new RelayEmailCron(relay) };
}

describe("a relay queue that cannot be read is not a quiet minute", () => {
  it("throws, naming the read, when the queue read fails", async () => {
    const { relay } = cronOver(
      dbWhoseQueueRead({ data: null, error: { message: "connection refused" } }),
    );
    await expect(relay.dispatchQueued()).rejects.toThrow(
      /could not read what is due: connection refused/,
    );
  });

  it("records the failure on the cron's lastRun, never as error: null", async () => {
    const { cron } = cronOver(
      dbWhoseQueueRead({ data: null, error: { message: "connection refused" } }),
    );
    await cron.run();
    expect(cron.lastRun()?.error).toMatch(
      /could not read what is due: connection refused/,
    );
  });

  it("still records a genuinely empty queue as a completed run with error: null", async () => {
    const { relay, cron } = cronOver(dbWhoseQueueRead({ data: [], error: null }));
    await expect(relay.dispatchQueued()).resolves.toEqual({
      considered: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      statusUpdateErrors: 0,
    });
    await cron.run();
    expect(cron.lastRun()).toMatchObject({ considered: 0, error: null });
  });
});
