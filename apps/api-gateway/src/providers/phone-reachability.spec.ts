/**
 * A landline is not a mobile, and neither is a value nobody chose.
 * ADR 0121 P0 item 2.
 *
 * THE CASE THAT MATTERS IS THE THIRD ONE. `provider_contacts.phone_type`
 * carries `DEFAULT 'main_line'`, so the interesting assertion is not "cell is a
 * mobile" — it is that `'main_line'` comes back `stated: false`, because a row
 * carrying it may be a value the column invented. Every other case here exists
 * to stop that one being satisfied by making everything unstated.
 */

import {
  PHONE_TYPE_COLUMN_DEFAULT,
  isPhoneType,
  isTextable,
  phoneReachability,
} from "./phone-reachability";

describe("phoneReachability tells a mobile from a landline", () => {
  it("`cell` is a mobile, and it is textable", () => {
    const r = phoneReachability("cell");
    expect(r.reach).toBe("mobile");
    expect(r.stated).toBe(true);
    expect(isTextable("cell")).toBe(true);
  });

  it("`whatsapp` is a mobile", () => {
    expect(phoneReachability("whatsapp").reach).toBe("mobile");
  });

  it("`mobile` is accepted as the word a carrier uses for `cell`", () => {
    expect(phoneReachability("mobile").reach).toBe("mobile");
    expect(isPhoneType("mobile")).toBe(true);
  });

  it("`fax`, `office` and `direct` are landlines a person chose", () => {
    for (const t of ["fax", "office", "direct"]) {
      const r = phoneReachability(t);
      expect(r.reach).toBe("landline");
      expect(r.stated).toBe(true);
      expect(isTextable(t)).toBe(false);
    }
  });
});

describe("the column's own default is not an answer", () => {
  it("`main_line` reads as a landline but NOT as stated", () => {
    const r = phoneReachability(PHONE_TYPE_COLUMN_DEFAULT);
    expect(r.reach).toBe("landline");
    // THE ASSERTION THIS FILE EXISTS FOR. `main_line` is what the column writes
    // when nobody answered, so a row carrying it is not evidence that anybody
    // did. If this ever flips to true, every untouched row in the book starts
    // reporting a manager's decision that was never made.
    expect(r.stated).toBe(false);
    expect(r.says).toMatch(/also what the book writes when nobody has said/i);
  });

  it("the default this reading is built on is still the column's default", () => {
    // Read off the baseline migration, so a future migration that changes the
    // default fails here instead of silently agreeing with the new one.
    const sql = require("fs").readFileSync(
      require("path").join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "supabase",
        "migrations",
        "20260805000000_baseline_from_production.sql",
      ),
      "utf8",
    ) as string;
    expect(sql).toContain(`phone_type text DEFAULT '${PHONE_TYPE_COLUMN_DEFAULT}'`);
  });

  it("landline is the SAFE direction: an unchosen value withholds a text", () => {
    // Reading `main_line` as a mobile would text a switchboard, which cannot be
    // undone. Reading it as a landline withholds a message, which can.
    expect(isTextable(PHONE_TYPE_COLUMN_DEFAULT)).toBe(false);
  });
});

describe("silence and nonsense are their own answer, not a landline", () => {
  it("null is `unstated`", () => {
    const r = phoneReachability(null);
    expect(r.reach).toBe("unstated");
    expect(r.stated).toBe(false);
    expect(r.phoneType).toBeNull();
  });

  it("an empty string is `unstated`", () => {
    expect(phoneReachability("").reach).toBe("unstated");
  });

  it("a value outside the vocabulary is `unstated`, never folded into landline", () => {
    const r = phoneReachability("carrier_pigeon");
    expect(r.reach).toBe("unstated");
    // Not "landline": saying landline would assert something nobody wrote.
    expect(r.reach).not.toBe("landline");
    expect(r.says).toContain("carrier_pigeon");
  });

  it("a non-string off a database row does not become data", () => {
    for (const v of [undefined, 7, {}, []]) {
      expect(phoneReachability(v).reach).toBe("unstated");
    }
  });

  it("every reading carries a sentence, never a bare code", () => {
    for (const v of [null, "cell", "main_line", "fax", "nonsense"]) {
      expect(phoneReachability(v).says.length).toBeGreaterThan(20);
    }
  });
});

describe("isPhoneType refuses what the API must not store", () => {
  it("accepts the vocabulary and nothing else", () => {
    expect(isPhoneType("cell")).toBe(true);
    expect(isPhoneType("main_line")).toBe(true);
    expect(isPhoneType("CELL")).toBe(false);
    expect(isPhoneType("")).toBe(false);
    expect(isPhoneType(null)).toBe(false);
  });
});
