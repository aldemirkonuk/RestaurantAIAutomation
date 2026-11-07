/**
 * The pure rules of the Mail read model: page cursors round-trip with
 * microseconds kept and anything else is a 400 in words; the page size is
 * clamped; only an owner or manager sees withheld letters; each letter's door;
 * and the "Subject:" line stripped from a letter's text.
 */
import { BadRequestException } from "@nestjs/common";
import {
  clampMailLimit,
  decodeMailCursor,
  encodeMailCursor,
  mailDoorOf,
  stripSubjectLine,
  withholdsHouseLetters,
} from "./mail.read-rules";

const VENDOR = "c0000000-0000-4000-8000-000000000001";
const BAD_CURSOR_WORDS = /not one this list made/;

describe("page cursors", () => {
  it("round-trips the exact Postgres time, microseconds included", () => {
    const at = "2026-11-07 10:00:00.123456+00";
    const key = `vendor:${VENDOR}`;
    const raw = encodeMailCursor(at, key);
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeMailCursor(raw)).toEqual({ at, key });
  });

  it.each([
    ["not base64url", "abc$def"],
    ["not JSON", Buffer.from("hello").toString("base64url")],
    [
      "an object",
      Buffer.from(JSON.stringify({ at: "x" })).toString("base64url"),
    ],
    [
      "not a time",
      Buffer.from(JSON.stringify(["yesterday", "k"])).toString("base64url"),
    ],
    [
      "an empty key",
      Buffer.from(JSON.stringify(["2026-11-07T10:00:00Z", ""])).toString(
        "base64url",
      ),
    ],
    ["far too long", "a".repeat(3000)],
  ])("refuses %s with a 400 in words", (_label, raw) => {
    expect(() => decodeMailCursor(raw)).toThrow(BadRequestException);
    expect(() => decodeMailCursor(raw)).toThrow(BAD_CURSOR_WORDS);
  });
});

describe("page size", () => {
  it.each([
    [undefined, 50],
    ["", 50],
    ["7", 7],
    ["0", 1],
    ["-4", 1],
    ["1000", 100],
  ])("%p becomes %p", (raw, want) => {
    expect(clampMailLimit(raw as any)).toBe(want);
  });

  it.each(["abc", "1.5", "NaN"])("%p is a 400", (raw) => {
    expect(() => clampMailLimit(raw)).toThrow(BadRequestException);
  });
});

describe("withholding by role", () => {
  it("only an owner or manager sees undecided credit-claim letters", () => {
    expect(withholdsHouseLetters("owner")).toBe(false);
    expect(withholdsHouseLetters("Manager")).toBe(false);
    for (const r of ["staff", "waiter", "admin", "", null, undefined]) {
      expect(withholdsHouseLetters(r as any)).toBe(true);
    }
  });
});

describe("doors", () => {
  it.each([
    [{ direction: "outbound", channel: "email" }, "from_house"],
    [
      { direction: "INBOUND", channel: "email", mirrored_by_grant_id: "g" },
      "house_mailbox",
    ],
    [{ direction: "inbound", channel: "WHATSAPP" }, "whatsapp"],
    [{ direction: "inbound", channel: "email" }, "mudavym_mail"],
  ])("%p comes by %p", (row, door) => {
    expect(mailDoorOf(row)).toBe(door);
  });
});

describe("Subject line", () => {
  it("removes only a leading Subject line", () => {
    expect(stripSubjectLine("Subject: Order 12\r\n\r\nHello")).toBe("Hello");
    expect(stripSubjectLine("subject:x")).toBe("");
    expect(stripSubjectLine("Hello\nSubject: kept")).toBe(
      "Hello\nSubject: kept",
    );
    expect(stripSubjectLine(null)).toBe("");
  });
});
