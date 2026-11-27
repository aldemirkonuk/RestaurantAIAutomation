/**
 * The RFC 3464 notice, read as words (r109 mail-gap g1): the query's bound,
 * what makes a failure, a delay or no mark, and where the letter's own
 * Message-ID is looked for. The reader that uses these is pinned in
 * house-inbox.dsn.spec.ts.
 */
import { deliveryMark, isNoticeSender, noticeQuery, noticeSenderChecked, parseNotice } from "./house-inbox.dsn";

const AT = 1_700_000_120_000;
const b64 = (t: string) => Buffer.from(t, "utf-8").toString("base64url");
const STATUS_FAILED =
  "Reporting-MTA: dns; googlemail.com\r\n\r\nFinal-Recipient: rfc822; v@x.com\r\nAction: failed\r\nStatus: 5.1.1\r\n";
const CURSOR = 1_700_000_000_000;

describe("a delivery notice, read", () => {
  it("is bounded by the daemon senders and the cursor", () => {
    expect(noticeQuery(CURSOR)).toBe("from:(mailer-daemon OR postmaster) after:1700000000");
  });

  it("a 5.x.x status with no Action is a failure; a delivered report is no mark", () => {
    const n = parseNotice(
      { mimeType: "message/delivery-status", body: { data: b64("Reporting-MTA: dns; x\n\nFinal-Recipient: rfc822;v@x.com\nStatus: 5.2.2\n") } },
      [],
    )!;
    expect(deliveryMark(n, AT)).toMatchObject({ state: "did_not_arrive", status: "5.2.2" });
    const d = parseNotice(
      { mimeType: "message/delivery-status", body: { data: b64("Reporting-MTA: dns; x\n\nFinal-Recipient: rfc822;v@x.com\nAction: delivered\nStatus: 2.0.0\n") } },
      [],
    )!;
    expect(deliveryMark(d, AT)).toBeNull();
  });

  it("References is read from its end, the letter answered", () => {
    const n = parseNotice({ mimeType: "message/delivery-status", body: { data: b64(STATUS_FAILED) } }, [{ name: "References", value: "<old@x> <mine@x>" }])!;
    expect(n.originalIds).toEqual(["<mine@x>", "<old@x>"]);
  });

  it("only a mailer-daemon or postmaster is a notice's sender", () => {
    expect(isNoticeSender("MAILER-DAEMON@mx.example")).toBe(true);
    expect(isNoticeSender("postmaster@x.example")).toBe(true);
    expect(isNoticeSender("mailer-daemon.fan@x.example")).toBe(false);
  });

  it("an SPF pass from Gmail's own stamp is enough for a remote server's notice; a fail is not", () => {
    const h = (auth: string) => [
      { name: "Authentication-Results", value: auth },
      { name: "From", value: "Mail Delivery System <MAILER-DAEMON@mx.remote.example>" },
    ];
    expect(noticeSenderChecked(h("mx.google.com; spf=pass smtp.helo=mx.remote.example"))).toBe(true);
    expect(noticeSenderChecked(h("mx.google.com; spf=softfail smtp.helo=mx.remote.example"))).toBe(false);
    expect(noticeSenderChecked(h("mx.google.com; dkim=pass header.i=@other.example"))).toBe(false);
  });
});
