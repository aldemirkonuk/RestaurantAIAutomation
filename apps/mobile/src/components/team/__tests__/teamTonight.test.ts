import {
  FULL_ROTA_IS_FOR_MANAGERS,
  NOT_ON_TONIGHT,
  ROTA_NOT_PUBLISHED,
  ROTA_DID_NOT_LOAD,
  resolveTonight,
} from "@/components/team/teamTonight";
import { houseDateKey, mondayOfKey } from "@/lib/houseDate";

const LA = "America/Los_Angeles";
// Thu 2026-10-08 18:30 in Los Angeles is Fri 01:30 UTC.
const THU_EVENING_LA = new Date("2026-10-09T01:30:00Z");
// Mon 2026-10-12 20:00 in Los Angeles is Tue 03:00 UTC.
const MON_EVENING_LA = new Date("2026-10-13T03:00:00Z");

const idle = { data: undefined, isLoading: false, error: null };
const forbidden = Object.assign(new Error("Only owners and managers can perform this action"), {
  status: 403,
});

describe("Team tab dates follow the house's zone (F-252)", () => {
  it("reads Thursday evening in LA as Thursday, not Friday", () => {
    expect(houseDateKey(THU_EVENING_LA, LA)).toBe("2026-10-08");
    expect(mondayOfKey(houseDateKey(THU_EVENING_LA, LA))).toBe("2026-10-05");
  });

  it("starts a Monday evening's week on that Monday, not the day after", () => {
    expect(mondayOfKey(houseDateKey(MON_EVENING_LA, LA))).toBe("2026-10-12");
  });

  it("anchors a Sunday to the Monday before it", () => {
    expect(mondayOfKey("2026-10-11")).toBe("2026-10-05");
  });

  it("lists tonight's shifts, not tomorrow's, after 17:00 in an LA house", () => {
    const view = resolveTonight({
      role: "manager",
      week: {
        isLoading: false,
        error: null,
        data: {
          timezone: LA,
          shifts: [
            { id: "fri", shift_date: "2026-10-09", start_time: "17:00" },
            { id: "thu", shift_date: "2026-10-08", start_time: "17:00" },
          ],
        },
      },
      mine: idle,
      now: THU_EVENING_LA,
    });
    expect(view.kind).toBe("shifts");
    expect(view.kind === "shifts" && view.shifts.map((s) => s.id)).toEqual(["thu"]);
  });
});

describe("Team tab for staff (F-251)", () => {
  it("never says the team space is not set up when the full rota is refused", () => {
    const view = resolveTonight({
      role: "manager",
      week: { ...idle, error: forbidden },
      mine: {
        isLoading: false,
        error: null,
        data: { mine: [], timezone: LA, schedule: { status: "published" } },
      },
      now: THU_EVENING_LA,
    });
    expect(JSON.stringify(view)).not.toMatch(/set up/i);
    expect(view.note).toBe(FULL_ROTA_IS_FOR_MANAGERS);
    expect(view.kind === "none" && view.message).toBe(NOT_ON_TONIGHT);
  });

  it("says the rota is not published yet, not that they are off, before the week is out (F-884)", () => {
    for (const schedule of [{ status: "draft" }, null]) {
      const view = resolveTonight({
        role: "staff",
        week: idle,
        mine: { isLoading: false, error: null, data: { mine: [], timezone: LA, schedule } },
        now: THU_EVENING_LA,
      });
      expect(view.kind === "none" && view.message).toBe(ROTA_NOT_PUBLISHED);
    }
  });

  it("shows a staff member their own shift tonight", () => {
    const view = resolveTonight({
      role: "staff",
      week: idle,
      mine: {
        isLoading: false,
        error: null,
        data: {
          timezone: LA,
          mine: [{ id: "mine-thu", shift_date: "2026-10-08", start_time: "16:00" }],
        },
      },
      now: THU_EVENING_LA,
    });
    expect(view.kind).toBe("shifts");
    expect(view.kind === "shifts" && view.own).toBe(true);
    expect(view.kind === "shifts" && view.shifts.map((s) => s.id)).toEqual(["mine-thu"]);
    expect(view.caption).toBe("Your shift tonight");
  });

  it("still asks for the full rota when the role has not arrived", () => {
    const view = resolveTonight({
      role: undefined,
      week: { isLoading: false, error: null, data: { timezone: LA, shifts: [] } },
      mine: idle,
      now: THU_EVENING_LA,
    });
    expect(view.caption).toBe("On tonight");
    expect(view.note).toBeNull();
  });

  it("says the rota did not load when it did not, rather than that it is missing", () => {
    const view = resolveTonight({
      role: "owner",
      week: { ...idle, error: Object.assign(new Error("down"), { status: 500 }) },
      mine: idle,
      now: THU_EVENING_LA,
    });
    expect(view.kind === "error" && view.message).toBe(ROTA_DID_NOT_LOAD);
  });
});

describe("an overnight shift stays on after the house's midnight (F-1075)", () => {
  const IST = "Europe/Istanbul";
  // Mon 2026-10-12 01:30 in Istanbul is Sun 22:30 UTC.
  const MON_0130_IST = new Date("2026-10-11T22:30:00Z");
  // Mon 2026-10-12 02:30 in Istanbul.
  const MON_0230_IST = new Date("2026-10-11T23:30:00Z");
  const sundayLate = { id: "sun-late", shift_date: "2026-10-11", start_time: "18:00", end_time: "02:00" };
  const sundayDay = { id: "sun-day", shift_date: "2026-10-11", start_time: "09:00", end_time: "17:00" };
  const mondayEve = { id: "mon-eve", shift_date: "2026-10-12", start_time: "17:00", end_time: "23:00" };

  it("keeps Sunday's late shift on a Monday, read from last week", () => {
    const view = resolveTonight({
      role: "manager",
      week: { isLoading: false, error: null, data: { timezone: IST, shifts: [mondayEve] } },
      weekBefore: { data: { shifts: [sundayDay, sundayLate] } },
      mine: idle,
      now: MON_0130_IST,
    });
    expect(view.kind === "shifts" && view.shifts.map((s) => s.id)).toEqual(["sun-late", "mon-eve"]);
  });

  it("lets it go once its end has passed on the house's clock", () => {
    const view = resolveTonight({
      role: "manager",
      week: { isLoading: false, error: null, data: { timezone: IST, shifts: [mondayEve] } },
      weekBefore: { data: { shifts: [sundayLate] } },
      mine: idle,
      now: MON_0230_IST,
    });
    expect(view.kind === "shifts" && view.shifts.map((s) => s.id)).toEqual(["mon-eve"]);
  });

  it("keeps a staff member's own late shift from the night before mid-week", () => {
    // Wed 2026-10-14 00:30 in Istanbul.
    const view = resolveTonight({
      role: "staff",
      week: idle,
      mine: {
        isLoading: false,
        error: null,
        data: {
          timezone: IST,
          schedule: { status: "published" },
          mine: [{ id: "tue-late", shift_date: "2026-10-13", start_time: "20:00", end_time: "01:00" }],
        },
      },
      now: new Date("2026-10-13T21:30:00Z"),
    });
    expect(view.kind).toBe("shifts");
    expect(view.kind === "shifts" && view.shifts.map((s) => s.id)).toEqual(["tue-late"]);
  });
});

describe("a called-out shift is not on tonight (F-1303)", () => {
  const shifts = [
    { id: "ana", shift_date: "2026-10-08", start_time: "17:00", state: "callout" },
    { id: "cover", shift_date: "2026-10-08", start_time: "17:00", state: "open" },
  ];

  it("leaves the call-out off the manager's 'On tonight'", () => {
    const view = resolveTonight({
      role: "manager",
      week: { isLoading: false, error: null, data: { timezone: LA, shifts } },
      mine: idle,
      now: THU_EVENING_LA,
    });
    expect(view.kind === "shifts" && view.shifts.map((s) => s.id)).toEqual(["cover"]);
  });

  it("does not tell a staff member who called out that they are on tonight", () => {
    const view = resolveTonight({
      role: "staff",
      week: idle,
      mine: {
        isLoading: false,
        error: null,
        data: { timezone: LA, schedule: { status: "published" }, mine: [shifts[0]] },
      },
      now: THU_EVENING_LA,
    });
    expect(view.kind).toBe("none");
    expect(view.kind === "none" && view.message).toBe(NOT_ON_TONIGHT);
  });
});
