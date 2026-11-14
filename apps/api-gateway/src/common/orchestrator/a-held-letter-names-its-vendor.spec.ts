/**
 * r35 mail, gap 9: "Who is writing" names the vendor a held letter is from.
 *
 * A letter the receiving server could not confirm came from its From
 * (`held_reason = sender_unconfirmed`) is held. The strangers list now names
 * the vendor whose book lists that address (`held_vendor`), by the same rule
 * the inbound bridge files mail by (`findSenderVendor`), so a person can be
 * told which vendor it would join before anything is filed. An unread book
 * is said (`held_vendor_unread`), never shown as "no vendor".
 */
import {
  HELD,
  HOUSE,
  OTHER,
  VENDOR,
  type Row,
  heldRow,
  store,
  svc,
  vendorRow,
  world,
} from "../../communications/testing/held-letter-store";

describe("the strangers list names the vendor a held letter would be filed under", () => {
  const stranger = (o: Row = {}) =>
    heldRow({ id: "s-1", held_reason: null, capture_reason: "offer", sender_email: "rep@new.example", ...o });

  it("names the vendor for an unconfirmed letter, and touches no other row", async () => {
    const t = world({ held: [heldRow(), stranger()] });
    const rows = await svc(store(t)).list(HOUSE);
    const held = rows.find((r) => r.id === HELD);
    const plain = rows.find((r) => r.id === "s-1");
    expect(held).toMatchObject({ held_vendor: { id: VENDOR, name: "Quiet Dairy" }, held_vendor_unread: false });
    expect(plain).not.toHaveProperty("held_vendor");
  });

  it("names no vendor when no single live vendor lists the address", async () => {
    const t = world({ providers: [vendorRow({ deleted_at: "2026-11-01T00:00:00Z" })] });
    const [row] = await svc(store(t)).list(HOUSE);
    expect(row).toMatchObject({ held_vendor: null, held_vendor_unread: false });
  });

  it("says the book was unread rather than naming no vendor", async () => {
    const t = world();
    const [row] = await svc(store(t, ["providers:select"])).list(HOUSE);
    expect(row).toMatchObject({ held_vendor: null, held_vendor_unread: true });
  });

  it("reads each row's own house across houses", async () => {
    const t = world({
      held: [heldRow({ restaurant_id: OTHER })],
      providers: [vendorRow({ restaurant_id: HOUSE })],
    });
    const [row] = await svc(store(t)).listAcross([HOUSE, OTHER]);
    expect(row).toMatchObject({ held_vendor: null });
  });

  it("names nothing for a letter whose sender could not be read", async () => {
    const t = world({ held: [heldRow({ held_reason: "sender_unreadable", sender_email: null })] });
    const [row] = await svc(store(t)).list(HOUSE);
    expect(row).not.toHaveProperty("held_vendor");
  });
});
