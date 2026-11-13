/**
 * r28 mail audit, gaps 5 and 7: a letter is filed under the vendor whose
 * address it came from, whichever of the vendor's addresses that is, and
 * never under a removed vendor.
 *
 * The house reader reads mail from every address in the vendor book
 * (contact_email, primary_contact.email, provider_contacts.email); the
 * bridge matched contact_email alone, and read removed vendors too.
 */
import { bridge, inbound, Row } from "./testing/mail-store";

const HOUSE = "house-A";
const vendor = (o: Row): Row => ({
  restaurant_id: HOUSE,
  name: "BigDist",
  contact_email: "sales@bigdist.com",
  primary_contact: null,
  deleted_at: null,
  ...o,
});
const book = (
  providers: Row[],
  contacts: Row[] = [],
): Record<string, Row[]> => ({
  restaurants: [{ id: HOUSE }],
  providers,
  provider_contacts: contacts,
  procurement_orders: [],
  procurement_conversations: [],
});

async function letterFrom(
  tables: Record<string, Row[]>,
  address: string,
  failing: string[] = [],
) {
  const { svc, inserts } = bridge(tables, failing);
  const outcome = await svc.handleInboundEmail(
    inbound({
      restaurant_id: HOUSE,
      from: `Accounts <${address}>`,
      subject: "Invoice 4410",
      body: "Please find the invoice for last week.",
      message_id_header: "<inv-4410@bigdist.com>",
    }),
  );
  const stored = inserts.find((i) => i.table === "procurement_conversations");
  return { outcome, vendorId: stored?.row.provider_id ?? null };
}

describe("a letter from any of the vendor's addresses is the vendor's", () => {
  it("the primary contact's address", async () => {
    const r = await letterFrom(
      book([
        vendor({
          id: "prov-A",
          primary_contact: { name: "Ayse", email: "ayse@bigdist.com" },
        }),
      ]),
      "ayse@bigdist.com",
    );
    expect(r).toEqual({ outcome: "filed", vendorId: "prov-A" });
  });

  it("an extra contact added in /vendors, in any letter case", async () => {
    const r = await letterFrom(
      book(
        [vendor({ id: "prov-A" })],
        [
          {
            provider_id: "prov-A",
            name: "Accounts",
            email: "Accounts@BigDist.com",
          },
        ],
      ),
      "accounts@bigdist.com",
    );
    expect(r).toEqual({ outcome: "filed", vendorId: "prov-A" });
  });

  it("the vendor's main address still decides first", async () => {
    const r = await letterFrom(
      book([
        vendor({
          id: "prov-B",
          contact_email: "other@elsewhere.example",
          primary_contact: { email: "sales@bigdist.com" },
        }),
        vendor({ id: "prov-A" }),
      ]),
      "sales@bigdist.com",
    );
    expect(r.vendorId).toBe("prov-A");
  });

  it("a contact address is matched exactly, never as a pattern", async () => {
    const r = await letterFrom(
      book(
        [vendor({ id: "prov-A" })],
        [{ provider_id: "prov-A", name: "A", email: "aXb@bigdist.com" }],
      ),
      "a_b@bigdist.com",
    );
    expect(r).toEqual({ outcome: "not_kept", vendorId: null });
  });
});

describe("a removed vendor receives none of the house's mail", () => {
  it("removed and added again with the same address: the live one", async () => {
    const r = await letterFrom(
      book([
        vendor({ id: "prov-old", deleted_at: "2026-11-01T00:00:00Z" }),
        vendor({ id: "prov-new" }),
      ]),
      "sales@bigdist.com",
    );
    expect(r).toEqual({ outcome: "filed", vendorId: "prov-new" });
  });

  it("removed, and no live vendor lists the address: not filed under it", async () => {
    const r = await letterFrom(
      book([vendor({ id: "prov-old", deleted_at: "2026-11-01T00:00:00Z" })]),
      "sales@bigdist.com",
    );
    expect(r.vendorId).toBeNull();
  });

  it("a removed vendor's extra contact is not read either", async () => {
    const r = await letterFrom(
      book(
        [vendor({ id: "prov-old", deleted_at: "2026-11-01T00:00:00Z" })],
        [
          {
            provider_id: "prov-old",
            name: "Accounts",
            email: "accounts@bigdist.com",
          },
        ],
      ),
      "accounts@bigdist.com",
    );
    expect(r.vendorId).toBeNull();
  });
});

describe("what the address does not prove", () => {
  it("another house's vendor's contact is not this house's vendor", async () => {
    const r = await letterFrom(
      book(
        [vendor({ id: "prov-B", restaurant_id: "house-B" })],
        [
          {
            provider_id: "prov-B",
            name: "Accounts",
            email: "accounts@bigdist.com",
          },
        ],
      ),
      "accounts@bigdist.com",
    );
    expect(r.vendorId).toBeNull();
  });

  it("two live vendors list the same contact: filed under neither", async () => {
    const r = await letterFrom(
      book(
        [
          vendor({ id: "prov-A" }),
          vendor({ id: "prov-C", contact_email: "orders@cellarco.example" }),
        ],
        [
          { provider_id: "prov-A", name: "Rep", email: "rep@agency.example" },
          { provider_id: "prov-C", name: "Rep", email: "rep@agency.example" },
        ],
      ),
      "rep@agency.example",
    );
    expect(r.vendorId).toBeNull();
  });

  it("two live vendors with the same primary contact: filed under neither", async () => {
    const r = await letterFrom(
      book([
        vendor({
          id: "prov-A",
          primary_contact: { email: "rep@agency.example" },
        }),
        vendor({
          id: "prov-C",
          contact_email: "orders@cellarco.example",
          primary_contact: { email: "rep@agency.example" },
        }),
      ]),
      "rep@agency.example",
    );
    expect(r.vendorId).toBeNull();
  });
});

describe("an unreadable book is not 'nobody'", () => {
  it("the vendor read fails: the letter is not stored, so it is offered again", async () => {
    await expect(
      letterFrom(book([vendor({ id: "prov-A" })]), "sales@bigdist.com", [
        "providers",
      ]),
    ).rejects.toThrow(/vendor book could not be read/);
  });

  it("the contact read fails: the same", async () => {
    await expect(
      letterFrom(book([vendor({ id: "prov-A" })]), "accounts@bigdist.com", [
        "provider_contacts",
      ]),
    ).rejects.toThrow(/contact list could not be read/);
  });
});
