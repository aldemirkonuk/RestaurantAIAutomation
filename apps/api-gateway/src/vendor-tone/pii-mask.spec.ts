/**
 * The masker that stands between a vendor's message and Jev (ADR 0207, round
 * 3; the founder's egress ruling, 2026-09-21: "Only with names removed").
 *
 * Nothing is mocked: the unit is a pure function, and every case hands it text
 * and reads back what would leave.
 */

import { MASK, displayNameOf, maskForEgress, nameVariants } from "./pii-mask";

describe("emails leave as [email]", () => {
  it("masks every address, including one inside a sentence and one with dots and a plus", () => {
    const r = maskForEgress(
      "Write to deniz.aydin+orders@kestrel-wine.com.tr or sales@kestrel.co — thanks.",
      [],
    );
    expect(r.text).toBe(`Write to ${MASK.email} or ${MASK.email} — thanks.`);
    expect(r.masked.emails).toBe(2);
  });
});

describe("phone numbers leave as [phone]; dates, prices and order numbers stay", () => {
  it("masks Turkish, US and international numbers", () => {
    const r = maskForEgress(
      "Call +90 212 555 01 23, or 0532 123 45 67, or (212) 555-0123, or 00 44 20 7946 0958.",
      [],
    );
    expect(r.text).toBe(
      `Call ${MASK.phone}, or ${MASK.phone}, or ${MASK.phone}, or ${MASK.phone}.`,
    );
    expect(r.masked.phones).toBe(4);
  });

  it("keeps an ISO date, a dotted date, a price and an order number", () => {
    const text =
      "PO-2291 ships 2026-09-21 (21.09.2026) at 1,620.00 per case, 12 cases.";
    const r = maskForEgress(text, []);
    expect(r.text).toBe(text);
    expect(r.masked.phones).toBe(0);
  });
});

describe("person names leave as [name]", () => {
  it("masks every name the house's records hold, whole and by each part, as written or in capitals — not a lower-case word", () => {
    const r = maskForEgress(
      "Can Yılmaz will call. CAN said Yılmaz is out; can we move it?",
      ["Can Yılmaz"],
    );
    // "can" in lower case is a word, and its loss would change the tone read.
    expect(r.text).toBe(
      `${MASK.name} will call. ${MASK.name} said ${MASK.name} is out; can we move it?`,
    );
    expect(r.masked.names).toBe(3);
    // A name stored in lower case is still found capitalised in the mail.
    expect(maskForEgress("Thanks, Deniz will confirm.", ["deniz"]).text).toBe(
      `Thanks, ${MASK.name} will confirm.`,
    );
  });

  it("masks the name after a greeting it was never told, and keeps 'Hi there'", () => {
    expect(maskForEgress("Hi Deniz,\nThe case is ready.", []).text).toBe(
      `Hi ${MASK.name},\nThe case is ready.`,
    );
    expect(maskForEgress("Dear Ms Aydın,\nThank you.", []).text).toBe(
      `Dear ${MASK.name},\nThank you.`,
    );
    expect(maskForEgress("Merhaba Selin Hanım,\nSipariş hazır.", []).text).toBe(
      `Merhaba ${MASK.name},\nSipariş hazır.`,
    );
    const there = maskForEgress("Hi there,\nThe case is ready.", []);
    expect(there.text).toBe("Hi there,\nThe case is ready.");
    expect(there.masked.names).toBe(0);
  });

  it("masks the line under a sign-off, and a one-line 'Best, Name'", () => {
    const r = maskForEgress(
      "We can deliver Monday.\n\nBest regards,\nCan Yılmaz\nKestrel Wine Co.",
      [],
    );
    expect(r.text).toBe(
      `We can deliver Monday.\n\nBest regards,\n${MASK.name}\nKestrel Wine Co.`,
    );
    expect(r.found).toEqual(["Can Yılmaz"]);
    expect(maskForEgress("Noted.\nBest, Deniz.", []).text).toBe(
      `Noted.\nBest, ${MASK.name}.`,
    );
  });

  it("masks 'my name is' and 'this is … from', but not 'this is the price'", () => {
    expect(maskForEgress("Hello, this is Deniz from Kestrel.", []).text).toBe(
      `Hello, this is ${MASK.name} from Kestrel.`,
    );
    expect(
      maskForEgress("My name is Selin Kaya and I handle orders.", []).text,
    ).toBe(`My name is ${MASK.name} and I handle orders.`);
    const price = maskForEgress("This is The price we can do.", []);
    expect(price.text).toBe("This is The price we can do.");
  });

  it("does not treat a part of an email as a name twice, and counts what it removed", () => {
    const r = maskForEgress("Deniz here — deniz@kestrel.com", ["Deniz"]);
    expect(r.text).toBe(`${MASK.name} here — ${MASK.email}`);
    expect(r.masked).toEqual({ emails: 1, phones: 0, names: 1 });
  });

  it("masks a name found at a sign-off everywhere else in the message too", () => {
    // Last call: the sign-off's name was masked in the cut sentences but left
    // in the whole text that is sent.
    const r = maskForEgress(
      "Hi team,\nDeniz here from Kestrel. The Barolo is late.\nBest,\nDeniz",
      [],
    );
    expect(r.text).toBe(
      `Hi team,\n${MASK.name} here from Kestrel. The Barolo is late.\nBest,\n${MASK.name}`,
    );
    expect(r.masked.names).toBe(2);
  });

  it("masks the line under a signature separator, with no sign-off above it", () => {
    for (const sep of ["--", "-- "]) {
      const r = maskForEgress(
        `The Barolo is delayed to Friday.\n\n${sep}\nMehmet Kaya\nKestrel Wine Co.`,
        [],
      );
      expect(r.text).toBe(
        `The Barolo is delayed to Friday.\n\n${sep}\n${MASK.name}\nKestrel Wine Co.`,
      );
      expect(r.found).toEqual(["Mehmet Kaya"]);
    }
    // A dash inside a sentence is not a separator.
    const dash = maskForEgress("Friday -- Monday at the latest.", []);
    expect(dash.text).toBe("Friday -- Monday at the latest.");
  });

  it("masks the name before a Turkish address word, and keeps the word", () => {
    const r = maskForEgress(
      "Deniz Bey merhaba,\nSiparişiniz yarın gelecek; Selin Hanım'a da ilettim.",
      [],
    );
    expect(r.text).toBe(
      `${MASK.name} Bey merhaba,\nSiparişiniz yarın gelecek; ${MASK.name} Hanım'a da ilettim.`,
    );
    expect(r.masked.names).toBe(2);
    // "bey" in lower case after a lower-case word is not an address.
    expect(maskForEgress("sayın bey", []).text).toBe("sayın bey");
  });

  it("is total: empty and non-string input give empty text", () => {
    expect(maskForEgress("", []).text).toBe("");
    expect(
      maskForEgress(undefined as unknown as string, [null, undefined, " "])
        .text,
    ).toBe("");
  });
});

describe("nameVariants", () => {
  it("gives the whole name and each part of two letters or more, longest first", () => {
    expect(
      nameVariants(["Can Yılmaz", "  ", "J", null, "O'Neill-Smith"]),
    ).toEqual(["O'Neill-Smith", "Can Yılmaz", "Yılmaz", "Can"]);
  });
});

describe("displayNameOf", () => {
  it("gives the display name of a From header, or null for a bare address", () => {
    expect(displayNameOf('"Deniz Kaya" <deniz@kestrel.com>')).toBe(
      "Deniz Kaya",
    );
    expect(displayNameOf("Mehmet Öztürk <m@x.com.tr>")).toBe("Mehmet Öztürk");
    expect(displayNameOf("deniz@kestrel.com")).toBeNull();
    expect(displayNameOf("<deniz@kestrel.com>")).toBeNull();
    expect(displayNameOf(undefined)).toBeNull();
    expect(displayNameOf({ name: "Deniz" })).toBeNull();
  });
});
