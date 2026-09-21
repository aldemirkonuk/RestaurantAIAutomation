import { isBelowPar } from "../common/stock-status";
import { isIso4217 } from "../common/iso-4217";
import { ORDER_CLOSED_STATUSES } from "../procurement/order-status";
import { READING_CATALOGUE, shownFields } from "./reading-catalogue";
import { BookRow, Evidence, recordedNumber, RecordingSession, ReadingFailure } from "./recording-session";
import { ReadingSources } from "./reading-sources";
import { BoundCell, Finding, FindingRow, ReadingArgs, ReadingId } from "./reading.types";

const labelField = (row: BookRow) => typeof row.display_name === "string" && row.display_name.trim() ? "display_name" : "wine_name";
const label = (row: BookRow) => String(row[labelField(row)] || row.order_number || row.id);
const normalized = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
const hasUnit = (row: BookRow): string => {
  if (typeof row.uom !== "string" || !row.uom.trim()) throw new ReadingFailure("missing_unit");
  return row.uom;
};

/** Date-only windows are inclusive; timestamp query bounds are [from, next day). */
export function readingWindow(args: ReadingArgs): { from: string; to: string } {
  if (!args.from || !args.to) throw new ReadingFailure("missing_window");
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(args.from) || !valid(args.to) || args.from > args.to ||
    Date.parse(args.to) - Date.parse(args.from) > 366 * 86400_000) throw new ReadingFailure("invalid_window");
  return { from: `${args.from}T00:00:00.000Z`, to: new Date(Date.parse(args.to) + 86400_000).toISOString() };
}

export class ReadingRunner {
  constructor(private readonly client: any, private readonly clock: () => Date = () => new Date()) {}
  async run(restaurantId: string, id: ReadingId, args: ReadingArgs, version = 1): Promise<Finding> {
    const descriptor = READING_CATALOGUE.find(r => r.id === id);
    // Cells may come only from the fields this Reading declares: those are
    // the fields whose data classes decided who may receive it.
    const s = new RecordingSession(this.client, this.clock, new Set(descriptor ? shownFields(descriptor) : []));
    const sources = new ReadingSources(s, restaurantId);
    if (version !== 1) return s.finish(id, args, [], "not_built", "unknown_reading_version");
    if (!descriptor) return s.finish(id, args, [], "not_built", "unknown_reading_version");
    try {
      const window = descriptor.window ? readingWindow(args) : null;
      let subjectEvidence: Evidence | undefined;
      let subject: BookRow | undefined;
      if (descriptor.subject !== "none") {
        subjectEvidence = descriptor.subject === "item" ? await sources.inventory() : await sources.orders();
        const matching = s.filter(subjectEvidence, row => args.subjectId ? row.id === args.subjectId :
          !!args.subjectText?.trim() && normalized(label(row)).includes(normalized(args.subjectText)));
        const matches = s.rows(matching);
        if (!args.subjectId && !args.subjectText?.trim())
          return s.finish(id, args, [], "clarify", "missing_subject");
        if (matches.length > 1) return s.finish(id, args, [], "clarify", "ambiguous_subject",
          matches.slice(0, 30).map(row => ({ id: String(row.id), label: label(row) })));
        if (!matches.length) return s.finish(id, args, [], "requirements_unsatisfied", "subject_not_found");
        subject = matches[0];
        subjectEvidence = matching;
      }
      const rows: FindingRow[] = [];
      const row = (key: string, cells: BoundCell[]) => rows.push({ key, cells });
      const listing = (e: Evidence, fields: Array<[string, string]>, prefix: string) => {
        row(`${prefix}:coverage`, [s.count(e, `${prefix}:count`, "Matching records"),
          s.count(s.take(e, 100), `${prefix}:shown`, "Records shown")]);
        for (const r of s.rows(s.take(e, 100))) row(`${prefix}:${String(r.id)}`,
          fields.map(([field, title]) => s.field(e, r, field, title)));
      };
      let resultEvidence: Evidence;
      switch (id) {
        case "inventory.position": {
          resultEvidence = subjectEvidence!;
          const unit = hasUnit(subject!);
          row(String(subject!.id), [s.field(resultEvidence, subject!, labelField(subject!), "Item"),
            s.field(resultEvidence, subject!, "uom", "Ledger unit"),
            ...[["stock_live", "Live stock"], ["shadow_stock", "Shadow stock"], ["in_transit_quantity", "Recorded in transit"]].map(([field, title]) =>
              s.field(resultEvidence, subject!, field, title, unit, "stated", true))]);
          break;
        }
        case "inventory.low_stock": {
          const items = await sources.inventory();
          const house = await sources.house();
          const thresholdStated = s.rows(house).length === 1 && s.rows(house)[0].threshold_configured === true;
          const active = s.filter(items, r => r.is_active === true);
          resultEvidence = s.filter(active, r => isBelowPar(recordedNumber(r.stock_live), recordedNumber(r.threshold_min)));
          row("coverage", [s.count(resultEvidence, "below:count", "Items below threshold", "items"),
            s.count(s.filter(active, r => recordedNumber(r.stock_live) === null || recordedNumber(r.threshold_min) === null), "unknown:count", "Items with unknown stock or threshold", "items")]);
          for (const item of s.rows(s.take(resultEvidence, 100))) row(String(item.id), [
            s.field(resultEvidence, item, labelField(item), "Item"),
            s.field(resultEvidence, item, "stock_live", "Live stock", hasUnit(item), "stated", true),
            s.field(resultEvidence, item, "threshold_min", "Recorded threshold", hasUnit(item), thresholdStated ? "stated" : "defaulted", true),
          ]);
          break;
        }
        case "inventory.in_transit": {
          const items = await sources.inventory();
          resultEvidence = s.filter(items, r => recordedNumber(r.in_transit_quantity) !== null && recordedNumber(r.in_transit_quantity)! > 0);
          row("coverage", [s.count(resultEvidence, "transit:count", "Items recorded in transit", "items"),
            s.count(s.filter(items, r => recordedNumber(r.in_transit_quantity) === null), "unknown:count", "Items with unknown transit quantity", "items")]);
          for (const item of s.rows(s.take(resultEvidence, 100))) row(String(item.id), [s.field(resultEvidence, item, labelField(item), "Item"),
            s.field(resultEvidence, item, "in_transit_quantity", "Recorded in transit", hasUnit(item), "stated", true)]);
          break;
        }
        case "inventory.locations": {
          resultEvidence = await sources.lots(String(subject!.id));
          const locations = await sources.locations();
          const locationRows = s.rows(locations);
          for (const lot of s.rows(resultEvidence)) if (lot.location_id != null && !locationRows.some(l => l.id === lot.location_id))
            throw new ReadingFailure("scope_mismatch");
          const groups = [...new Set(s.rows(resultEvidence).map(l => `${String(l.location_id)}:${String(l.stock_state)}`))];
          row("coverage", [s.count(resultEvidence, "lots:count", "Recorded lots", "lots")]);
          for (const key of groups) {
            const group = s.filter(resultEvidence, l => `${String(l.location_id)}:${String(l.stock_state)}` === key);
            const first = s.rows(group)[0];
            const location = locationRows.find(l => l.id === first.location_id);
            row(key, [location ? s.field(locations, location, "name", "Location") : s.field(group, first, "location_id", "Location (unassigned when absent)"),
              s.field(group, first, "stock_state", "Stock lane"), s.sum(group, "qty", `${key}:qty`, "Recorded quantity", hasUnit(subject!))]);
          }
          break;
        }
        case "inventory.movements": {
          resultEvidence = await sources.movements(String(subject!.id), window!.from, window!.to);
          row("coverage", [s.count(resultEvidence, "movements:count", "Recorded movements", "movements")]);
          for (const lane of [...new Set(s.rows(resultEvidence).map(r => r.stock_type))]) {
            const group = s.filter(resultEvidence, r => r.stock_type === lane);
            row(`lane:${String(lane)}`, [s.field(group, s.rows(group)[0], "stock_type", "Stock lane"),
              s.sum(group, "quantity_change", `lane:${String(lane)}:net`, "Net recorded movement", hasUnit(subject!))]);
          }
          break;
        }
        case "orders.open":
        case "orders.late_deliveries": {
          if (id === "orders.late_deliveries") {
            // "Past the stated delivery date" is only true of a date before
            // today. A window reaching today or later would list deliveries
            // that are not late under a title that says they are (KL audit
            // J10). Refused rather than clamped: clamping silently answers a
            // different question than the one asked. Today is the runner's
            // clock in UTC; the house's own time zone is not on this path.
            const today = this.clock().toISOString().slice(0, 10);
            if (args.to! >= today) throw new ReadingFailure("invalid_window");
          }
          const orders = await sources.orders();
          const open = s.filter(orders, r => typeof r.status === "string" && !ORDER_CLOSED_STATUSES.includes(r.status as any));
          resultEvidence = id === "orders.open" ? open : s.filter(open, r => typeof r.expected_delivery_date === "string" &&
            r.expected_delivery_date.slice(0, 10) >= args.from! && r.expected_delivery_date.slice(0, 10) <= args.to!);
          listing(resultEvidence, [["order_number", "Order"], ["status", "Recorded state"], ["expected_delivery_date", "Stated delivery date"]], "orders");
          row("date-coverage", [s.count(s.filter(open, r => !r.expected_delivery_date), "undated:count", "Open orders without a delivery date", "orders")]);
          break;
        }
        case "orders.lines": {
          resultEvidence = await sources.orderLines([String(subject!.id)]);
          if (!s.rows(resultEvidence).length) {
            resultEvidence = subjectEvidence!;
            row("legacy-header", [s.field(resultEvidence, subject!, "order_number", "Legacy header-only order"),
              s.field(resultEvidence, subject!, "quantity", "Header quantity", String(subject!.unit_type || "unit not recorded"), "stated", true),
              s.field(resultEvidence, subject!, "unit_type", "Header unit")]);
          } else {
            row("coverage", [s.count(resultEvidence, "lines:count", "Order lines", "lines")]);
            for (const line of s.rows(s.take(resultEvidence, 100))) row(String(line.id), [
              s.field(resultEvidence, line, "wine_name", "Item"), s.field(resultEvidence, line, "quantity", "Ordered quantity", typeof line.unit_type === "string" ? line.unit_type : null, "stated", true),
              s.field(resultEvidence, line, "unit_type", "Recorded line unit", null, "defaulted"),
              s.field(resultEvidence, line, "bottles_per_unit", "Recorded pack (provenance not retained)", "bottles per unit", "defaulted", true),
            ]);
          }
          break;
        }
        case "receipts.verified_line": {
          const docs = await sources.documents();
          const verified = s.filter(docs, d => d.status === "verified" && !!d.verified_at && !!d.verified_by &&
            ["invoice", "delivery_receipt", "receiving_advice", "delivery_note", "informal_note"].includes(String(d.doc_type)));
          if (!s.rows(verified).length) return s.finish(id, args, [], "requirements_unsatisfied", "missing_verified_link");
          const docIds = s.rows(verified).map(d => String(d.id));
          const lines = await sources.documentLines(docIds);
          const links = await sources.documentLinks(docIds);
          const orders = await sources.orders();
          const ownOrders = new Set(s.rows(orders).map(o => o.id));
          for (const link of s.rows(links)) if (!ownOrders.has(link.order_id)) throw new ReadingFailure("scope_mismatch");
          const linkedOrderIds = [...new Set(s.rows(links).map(l => String(l.order_id)))];
          const orderLines = linkedOrderIds.length ? await sources.orderLines(linkedOrderIds) : null;
          const linked = s.filter(lines, line => {
            // A manual door line is exact user selection; a proposed matcher is not.
            if (line.inventory_id === subject!.id) return true;
            if (!line.confirmed_at || !line.confirmed_by || !orderLines) return false;
            const orderLine = s.rows(orderLines).find(l => l.id === line.order_line_id && l.inventory_id === subject!.id);
            return !!orderLine && s.rows(links).some(l => l.document_id === line.document_id && l.order_id === orderLine.order_id);
          });
          if (!s.rows(linked).length) return s.finish(id, args, [], "requirements_unsatisfied", "missing_verified_link");
          resultEvidence = s.take(s.sorted(linked, (a, b) => {
            const date = (line: BookRow) => String(s.rows(verified).find(d => d.id === line.document_id)!.verified_at);
            return date(b).localeCompare(date(a)) || String(a.id).localeCompare(String(b.id));
          }), 1);
          const line = s.rows(resultEvidence)[0];
          const doc = s.rows(verified).find(d => d.id === line.document_id)!;
          const extracted = doc.extracted && typeof doc.extracted === "object" ? doc.extracted as Record<string, unknown> : {};
          // Legacy DEFAULT USD alone has no documentary provenance.
          const currencyProvenance = extracted.currencyFiledFrom;
          if (!isIso4217(String(doc.currency || "")) || typeof currencyProvenance !== "string" || !currencyProvenance.trim())
            return s.finish(id, args, [], "requirements_unsatisfied", "missing_currency_provenance");
          row(String(line.id), [s.field(verified, doc, "doc_number", "Verified document"), s.field(verified, doc, "verified_at", "Verified at"),
            s.field(resultEvidence, line, "qty", "Printed quantity", typeof line.uom === "string" ? line.uom : null, "stated", true),
            s.field(resultEvidence, line, "uom", "Printed unit"), s.field(resultEvidence, line, "pack_size", "Printed pack", "units per pack", "stated", true),
            s.field(resultEvidence, line, "unit_price", "Recorded unit price", String(doc.currency), "stated", true),
            s.field(resultEvidence, line, "price_base_qty", "Price basis quantity", typeof line.price_base_uom === "string" ? line.price_base_uom : null, "stated", true),
            s.field(resultEvidence, line, "price_base_uom", "Price basis unit"), s.field(verified, doc, "currency", "Filed currency", null, "derived")]);
          break;
        }
        case "sales.check_activity": {
          resultEvidence = await sources.checks(window!.from, window!.to);
          const known = s.filter(resultEvidence, r => recordedNumber(r.covers) !== null);
          row("checks", [s.count(resultEvidence, "checks:count", "Recorded closed checks", "checks"),
            s.sum(known, "covers", "covers:sum", "Known covers", "covers"),
            s.count(s.filter(resultEvidence, r => recordedNumber(r.covers) === null), "covers:unknown", "Checks with unrecorded covers", "checks")]);
          break;
        }
        case "sales.consumption": {
          resultEvidence = await sources.consumption(String(subject!.id), window!.from, window!.to);
          row("volume", [s.sum(resultEvidence, "volume_ml", "consumption:volume", "Recorded volume", "ml"),
            s.count(s.filter(resultEvidence, r => recordedNumber(r.volume_ml) === null), "volume:unknown", "Entries with unrecorded volume", "entries")]);
          for (const kind of [...new Set(s.rows(resultEvidence).map(r => r.consumption_type))]) {
            const group = s.filter(resultEvidence, r => r.consumption_type === kind);
            row(`servings:${String(kind)}`, [s.field(group, s.rows(group)[0], "consumption_type", "Serving type"),
              s.sum(group, "quantity", `servings:${String(kind)}:count`, "Recorded servings", String(kind))]);
          }
          break;
        }
        case "calendar.upcoming": {
          const events = await sources.events();
          const rules = await sources.rules(s.rows(events).map(e => String(e.id)));
          const exceptions = s.rows(rules).length ? await sources.exceptions(s.rows(rules).map(r => String(r.id))) : null;
          resultEvidence = s.calendar(restaurantId, events, rules, exceptions, args.from!, args.to!);
          listing(resultEvidence, [["title", "Entry"], ["start_date", "Date"], ["start_time", "Time"], ["status", "Recorded state"]], "events");
          break;
        }
        case "vendors.active": {
          resultEvidence = await sources.vendors();
          listing(resultEvidence, [["name", "Vendor"]], "vendors");
          break;
        }
        case "documents.waiting": {
          const docs = await sources.documents();
          resultEvidence = s.filter(docs, r => ["received", "extracting", "needs_review"].includes(String(r.status)));
          listing(resultEvidence, [["doc_number", "Document"], ["doc_type", "Document kind"], ["status", "Review state"], ["doc_date", "Document date"]], "documents");
          break;
        }
        case "goals.targets": {
          resultEvidence = await sources.goals();
          row("coverage", [s.count(resultEvidence, "goals:count", "Active posted goals", "goals")]);
          for (const goal of s.rows(s.take(resultEvidence, 100))) row(String(goal.id), [
            s.field(resultEvidence, goal, "name", "Goal"), s.field(resultEvidence, goal, "metric_key", "Metric"),
            s.field(resultEvidence, goal, "target_value", "Posted target", String(goal.metric_key), "stated", true),
            s.field(resultEvidence, goal, "direction", "Direction"), s.field(resultEvidence, goal, "deadline", "Deadline")]);
          break;
        }
      }
      // An empty RESULT is not an empty REGISTER. Only when the queries behind
      // the result returned no rows at all is the answer "not in your books";
      // a filter that matched nothing in a register that has rows is a true
      // zero, read out of the books, and its count cell says so (KL audit J4).
      const matched = s.rows(resultEvidence!).length;
      const scanned = s.scannedRows(resultEvidence!);
      if (scanned === null) throw new ReadingFailure("invalid_source_result");
      if (matched === 0 && scanned === 0) {
        return s.finish(id, args, rows, "not_in_your_books", "empty_register");
      }
      return s.finish(id, args, rows, "read", null);
    } catch (error) {
      const reason = error instanceof ReadingFailure ? error.reason : "query_failed";
      const requirements = ["missing_unit", "missing_pack", "missing_window", "invalid_window", "missing_verified_link", "missing_currency_provenance", "unsupported_recurrence"].includes(reason);
      return s.finish(id, args, [], requirements ? "requirements_unsatisfied" : "could_not_read", reason);
    }
  }
}
