import { BookRow, Evidence, RecordingSession, ReadingFailure } from "./recording-session";

// A READING_SHELVES table naming each source's tenant-scope path used to live
// here as a standalone export. Nothing imported it (grep: zero call sites) and
// no guard proved it matched the `ReadingSources` methods below, so it was
// exactly the unchecked-prose drift class ADR 0145 R6 exists to prevent --
// the scope a reader trusted could go stale the moment a method below changed
// without the table changing with it (KL audit J12, 2026-09-17). Deleted
// rather than wired to a guard: each method's own scope predicate (`houseScope`
// and the per-method filters just below) is the actual, checked source of
// truth, and the table repeated it as text that nothing re-read.

const selected = { count: "exact" as const };
/** The only client exposed to this class is the runner's recording facade. */
export class ReadingSources {
  constructor(readonly session: RecordingSession, readonly restaurantId: string) {}
  private houseScope = (r: BookRow): boolean => r.restaurant_id === this.restaurantId;
  inventory(): Promise<Evidence> {
    return this.session.read(c => c.from("restaurant_inventory")
      .select("id,restaurant_id,display_name,wine_name,kind,uom,unit_type,stock_live,shadow_stock,in_transit_quantity,threshold_min,is_active,deleted_at", selected)
      .eq("restaurant_id", this.restaurantId).is("deleted_at", null), this.houseScope);
  }
  house(): Promise<Evidence> {
    return this.session.read(c => c.from("restaurants").select("id,threshold_configured", selected)
      .eq("id", this.restaurantId), r => r.id === this.restaurantId);
  }
  lots(itemId: string): Promise<Evidence> {
    return this.session.read(c => c.from("inventory_lots")
      .select("id,restaurant_id,inventory_id,location_id,stock_state,qty,status", selected)
      .eq("restaurant_id", this.restaurantId).eq("inventory_id", itemId),
    r => this.houseScope(r) && r.inventory_id === itemId);
  }
  locations(): Promise<Evidence> {
    return this.session.read(c => c.from("storage_locations").select("id,restaurant_id,name", selected)
      .eq("restaurant_id", this.restaurantId), this.houseScope);
  }
  movements(itemId: string, from: string, to: string): Promise<Evidence> {
    return this.session.read(c => c.from("inventory_transactions")
      .select("id,restaurant_id,inventory_id,transaction_type,source,quantity_change,stock_type,transaction_date,reference_type,reference_id", selected)
      .eq("restaurant_id", this.restaurantId).eq("inventory_id", itemId)
      .gte("transaction_date", from).lt("transaction_date", to),
    r => this.houseScope(r) && r.inventory_id === itemId);
  }
  orders(): Promise<Evidence> {
    return this.session.read(c => c.from("procurement_orders")
      .select("id,restaurant_id,status,order_number,inventory_id,quantity,unit_type,bottles_total,expected_delivery_date,created_at", selected)
      .eq("restaurant_id", this.restaurantId), this.houseScope);
  }
  orderLines(ownedOrderIds: string[]): Promise<Evidence> {
    if (!ownedOrderIds.length) throw new ReadingFailure("missing_subject");
    return this.session.read(c => c.from("procurement_order_items")
      .select("id,order_id,restaurant_id,inventory_id,wine_name,quantity,unit_type,bottles_per_unit,total_bottles", selected)
      .in("order_id", ownedOrderIds),
    r => ownedOrderIds.includes(String(r.order_id)) && (r.restaurant_id === null || this.houseScope(r)));
  }
  documents(): Promise<Evidence> {
    return this.session.read(c => c.from("procurement_documents")
      .select("id,restaurant_id,doc_type,doc_number,doc_date,status,currency,extracted,verified_at,verified_by", selected)
      .eq("restaurant_id", this.restaurantId), this.houseScope);
  }
  documentLines(ownedDocumentIds: string[]): Promise<Evidence> {
    if (!ownedDocumentIds.length) throw new ReadingFailure("missing_verified_link");
    // Do not pre-filter the child tenant: a mismatched child must fail closed.
    return this.session.read(c => c.from("procurement_document_lines")
      .select("id,document_id,restaurant_id,inventory_id,order_line_id,confirmed_at,confirmed_by,qty,uom,pack_size,unit_price,price_base_qty,price_base_uom", selected)
      .in("document_id", ownedDocumentIds),
    r => ownedDocumentIds.includes(String(r.document_id)) && this.houseScope(r));
  }
  documentLinks(ownedDocumentIds: string[]): Promise<Evidence> {
    if (!ownedDocumentIds.length) throw new ReadingFailure("missing_verified_link");
    return this.session.read(c => c.from("procurement_document_links")
      .select("id,restaurant_id,document_id,order_id", selected).in("document_id", ownedDocumentIds),
    r => ownedDocumentIds.includes(String(r.document_id)) && this.houseScope(r));
  }
  checks(from: string, to: string): Promise<Evidence> {
    return this.session.read(c => c.from("pos_checks")
      .select("id,restaurant_id,closed_at,covers,voided", selected)
      .eq("restaurant_id", this.restaurantId).eq("voided", false)
      .gte("closed_at", from).lt("closed_at", to), this.houseScope);
  }
  consumption(itemId: string, from: string, to: string): Promise<Evidence> {
    return this.session.read(c => c.from("wine_consumption_log")
      .select("id,restaurant_id,inventory_id,consumption_type,quantity,volume_ml,recorded_at", selected)
      .eq("restaurant_id", this.restaurantId).eq("inventory_id", itemId)
      .gte("recorded_at", from).lt("recorded_at", to),
    r => this.houseScope(r) && r.inventory_id === itemId);
  }
  events(): Promise<Evidence> {
    return this.session.read(c => c.from("calendar_events")
      .select("id,restaurant_id,title,start_date,end_date,start_time,end_time,status,is_recurring,recurrence_rule_id,parent_event_id,occurrence_date,is_exception,exception_type", selected)
      .eq("restaurant_id", this.restaurantId), this.houseScope);
  }
  rules(ownedEventIds: string[]): Promise<Evidence> {
    return this.session.read(c => c.from("calendar_recurrence_rules")
      .select("id,restaurant_id,calendar_event_id,frequency,interval_value,days_of_week,day_of_month,week_of_month,month_of_year,end_type,end_on_date,end_after_count", selected)
      .eq("restaurant_id", this.restaurantId),
    r => this.houseScope(r) && ownedEventIds.includes(String(r.calendar_event_id)));
  }
  exceptions(ownedRuleIds: string[]): Promise<Evidence> {
    if (!ownedRuleIds.length) throw new ReadingFailure("unsupported_recurrence");
    return this.session.read(c => c.from("calendar_recurrence_exceptions")
      .select("id,recurrence_rule_id,original_date,exception_type,replacement_event_id", selected)
      .in("recurrence_rule_id", ownedRuleIds), r => ownedRuleIds.includes(String(r.recurrence_rule_id)));
  }
  vendorLinks(): Promise<Evidence> {
    return this.session.read(c => c.from("restaurant_providers")
      .select("id,restaurant_id,provider_id,is_active", selected).eq("restaurant_id", this.restaurantId), this.houseScope);
  }
  async vendors(): Promise<Evidence> {
    const links = await this.vendorLinks();
    const revoked = new Set(this.session.rows(links).filter(r => r.is_active !== true).map(r => r.provider_id));
    const owned = await this.session.read(c => c.from("providers")
      .select("id,restaurant_id,name,is_active,deleted_at", selected).eq("restaurant_id", this.restaurantId), this.houseScope);
    const permittedOwned = this.session.filter(owned, r => r.is_active === true && r.deleted_at === null && !revoked.has(r.id));
    const linkedIds = this.session.rows(links).filter(r => r.is_active === true && !revoked.has(r.provider_id)).map(r => String(r.provider_id));
    if (!linkedIds.length) return permittedOwned;
    const linked = await this.session.read(c => c.from("providers")
      .select("id,restaurant_id,name,is_active,deleted_at", selected).in("id", linkedIds),
    r => linkedIds.includes(String(r.id)) && (r.restaurant_id === null || this.houseScope(r)));
    return this.session.union([permittedOwned, this.session.filter(linked, r => r.is_active === true && r.deleted_at === null)]);
  }
  goals(): Promise<Evidence> {
    return this.session.read(c => c.from("analytics_goals")
      .select("id,restaurant_id,name,metric_key,target_value,direction,deadline,status", selected)
      .eq("restaurant_id", this.restaurantId).eq("status", "active"), this.houseScope);
  }
}
