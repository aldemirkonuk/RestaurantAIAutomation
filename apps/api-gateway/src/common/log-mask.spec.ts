import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { maskEmail, maskPhone } from "./log-mask";

describe("log masks (F-702)", () => {
  it("keeps the first letter and the domain of an address", () => {
    expect(maskEmail("mira@example.com")).toBe("m•••@example.com");
    expect(maskEmail("broken")).toBe("your email address");
  });

  it("survives a body that is not a string", () => {
    expect(maskEmail(undefined as unknown as string)).toBe(
      "your email address",
    );
    expect(maskEmail(42 as unknown as string)).toBe("your email address");
  });

  it("keeps only the last two digits of a number", () => {
    expect(maskPhone("+90 532 123 45 67")).toBe("•••67");
    expect(maskPhone("12")).toBe("•••");
  });
});

/**
 * The lines that named people by their typed address, phone number or message
 * body. The log store outlives `DELETE /auth/me`, so these call sites must go
 * through `maskEmail` / `maskPhone`, or log a `user_id`, instead.
 */
describe("gateway log lines do not name people (F-702)", () => {
  const SRC = join(__dirname, "..");
  const SCOPE = [
    "auth",
    "passkeys",
    "communications/sms.service.ts",
    "communications/gmail.service.ts",
    // The rest of the raw-address lines (F-702 rest): manager, vendor,
    // provider, invitee and inbound-sender addresses.
    "communications/communications.controller.ts",
    "communications/communications.service.ts",
    "communications/scheduled-tasks.service.ts",
    "procurement/procurement.service.ts",
    "common/orchestrator/studio-invite.controller.ts",
    "common/orchestrator/rabbitmq-bridge.service.ts",
    "common/orchestrator/inbound-email.controller.ts",
    "notifications/producers/experiment-ended.producer.ts",
  ];
  const LOG_CALL = /\blogger\.(?:log|warn|error|debug|verbose)\(([\s\S]*?)\);/g;
  const RAW = [
    /\$\{(?:[\w?.]*\.)?(?:email|normalizedEmail)\}/, // a typed or stored address
    /\$\{(?:[\w?.]*\.)?(?:to|phone|phoneNumber)\}/, // a recipient number
    /^\s*options\.message\s*$/, // a whole SMS body
    // A named person's address or number, or a list of them, interpolated
    // without a mask.
    /\$\{(?![^}]*mask)[^}]*\b(?:managerEmails?|vendorEmail|providerEmail|senderEmail|target_email|emailAddress|recipientEmails|emails|phones|recipients|recipientPhone|managerPhone|from|to)\b[^}]*\}/,
  ];

  function files(rel: string): string[] {
    const abs = join(SRC, rel);
    if (statSync(abs).isFile()) return [abs];
    return readdirSync(abs).flatMap((name) => files(join(rel, name)));
  }

  it("finds no log call that prints an address, a number or an SMS body", () => {
    const hits: string[] = [];
    const scanned = SCOPE.flatMap(files).filter(
      (f) => f.endsWith(".ts") && !f.endsWith(".spec.ts"),
    );
    // Absence is only evidence if the scan looked somewhere.
    expect(scanned.length).toBeGreaterThan(5);
    for (const file of scanned) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(LOG_CALL)) {
        if (RAW.some((re) => re.test(m[1]))) {
          const line = text.slice(0, m.index).split("\n").length;
          hits.push(`${file.slice(SRC.length + 1)}:${line}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
