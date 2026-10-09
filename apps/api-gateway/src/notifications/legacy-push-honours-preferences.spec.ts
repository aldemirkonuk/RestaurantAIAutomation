import { NotificationsService } from "./notifications.service";
import { pushHolds } from "./push-hold";

/**
 * F-539: `sendToUser`, the older one-person send (the Settings test send and
 * the order/price senders), pushed to the browser and the phone without
 * reading the person's Push switch or quiet hours. It now reads them in the
 * house, by the same rule as the funnel's push leg; the live ping still goes.
 */
describe("sendToUser honours Push and quiet hours (F-539)", () => {
  function fakeSupabase(pref: Record<string, any> | null, zone = "UTC") {
    return {
      from(table: string) {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          maybeSingle: () =>
            Promise.resolve({ data: { timezone: zone }, error: null }),
          then: (ok: any, bad: any) =>
            Promise.resolve(
              table === "notification_preferences"
                ? {
                    data: pref ? [{ user_id: "u1", ...pref }] : [],
                    error: null,
                  }
                : { data: [], error: null },
            ).then(ok, bad),
        };
        return chain;
      },
    };
  }

  function build(pref: Record<string, any> | null) {
    const emit = jest.fn();
    const expo = { sendToUsers: jest.fn(async () => ({})) };
    const svc = new NotificationsService(
      { server: { to: () => ({ emit }) } } as any,
      { get: () => undefined } as any,
      { supabase: fakeSupabase(pref) } as any,
      undefined,
      expo as any,
    );
    const web = jest
      .spyOn(svc, "sendWebPush")
      .mockResolvedValue(undefined as any);
    return { svc, emit, expo, web };
  }

  const payload = { type: "system_alert", title: "Mudavym test", body: "Hi" };

  it("[REVERT-FAILS] Push switched off: the app gets the line, the phone and browser stay quiet", async () => {
    const { svc, emit, expo, web } = build({ push_enabled: false });
    const held = await svc.sendToUser("u1", payload, "r1");
    expect(held).toBe("push_off");
    expect(emit).toHaveBeenCalled();
    expect(expo.sendToUsers).not.toHaveBeenCalled();
    expect(web).not.toHaveBeenCalled();
  });

  it("[REVERT-FAILS] inside quiet hours: no push", async () => {
    // A window covering the whole day except one minute that is never now.
    const now = new Date();
    const hh = (n: number) => String(n).padStart(2, "0");
    const after = new Date(now.getTime() + 60_000);
    const before = new Date(now.getTime() - 60_000);
    const { svc, expo, web } = build({
      push_enabled: true,
      quiet_hours_enabled: true,
      quiet_hours_start: `${hh(before.getUTCHours())}:${hh(before.getUTCMinutes())}`,
      quiet_hours_end: `${hh(after.getUTCHours())}:${hh(after.getUTCMinutes())}`,
    });
    const held = await svc.sendToUser("u1", payload, "r1");
    expect(held).toBe("quiet_hours");
    expect(expo.sendToUsers).not.toHaveBeenCalled();
    expect(web).not.toHaveBeenCalled();
  });

  it("no preferences row: pushed as before", async () => {
    const { svc, expo, web } = build(null);
    expect(await svc.sendToUser("u1", payload, "r1")).toBeNull();
    expect(expo.sendToUsers).toHaveBeenCalledWith(["u1"], expect.anything());
    expect(web).toHaveBeenCalled();
  });

  it("an unreadable preferences table pushes, and says so", async () => {
    const warn = jest.fn();
    const broken = {
      from: () => {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          in: () => Promise.resolve({ data: null, error: { message: "boom" } }),
        };
        return chain;
      },
    };
    const held = await pushHolds(broken, "r1", ["u1"], warn);
    expect(held.size).toBe(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("PUSH_PREFERENCES_UNREAD"),
    );
  });
});
