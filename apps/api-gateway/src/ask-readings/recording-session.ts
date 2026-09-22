import { randomUUID } from "crypto";
import { CalendarOccurrenceException, CalendarOccurrenceRow, CalendarOccurrenceRule,
  resolveCalendarOccurrences } from "../calendar/calendar-occurrences";
import { findingFingerprint } from "./finding-fingerprint";
import { baseRelation } from "./reading-data-classes";
import { BoundCell, Finding, FindingRow, Provenance, ReadingArgs, ReadingId,
  ReadingOutcome, ReadingReason, SourceTrace } from "./reading.types";

export type BookRow = Readonly<Record<string, unknown>>;
declare const observed: unique symbol;
/** Only this module can construct evidence; readers can select, never invent rows. */
export interface Evidence { readonly [observed]: true }
type RecordedRows = { rows: readonly BookRow[]; relations: string[] };
export class ReadingFailure extends Error {
  constructor(readonly reason: ReadingReason) { super(reason); }
}
const numeric = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const parsed = Number(v);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};
export { numeric as recordedNumber };

/**
 * The intercepted method is the actual Supabase method, not an author-supplied
 * sources array. Selection factories use literal .from() calls (schema guard
 * visible). Trace is written only when their thenable executes. Writes are not
 * a capability of a Reading. Error codes, never database text/credentials, leave
 * this boundary.
 */
export class RecordingSession {
  private readonly trace: SourceTrace[] = [];
  readonly client: any;
  private readonly evidence = new WeakMap<Evidence, RecordedRows>();
  private readonly cells = new WeakSet<BoundCell>();
  private readonly responseTrace = new WeakMap<object, SourceTrace>();

  /**
   * `shown` is the running Reading's declared fields (`shownFields` in
   * reading-catalogue.ts). A cell may be minted only from a field it names --
   * `relation.column`, or `relation.*` for a count -- because each of those
   * carries the data class the role gate was decided on. Absent means an empty
   * set: a session nobody declared fields for mints nothing (fail closed).
   */
  /**
   * `version` is the Reading version the caller ASKED for. It is written on the
   * Finding as asked, so a refused unknown version is not recorded as version
   * 1 (2026-09-21, round 6r: until then `finish` wrote 1 whatever was asked).
   */
  constructor(client: any, private readonly clock: () => Date = () => new Date(),
    private readonly shown: ReadonlySet<string> = new Set(), private readonly version = 1) {
    this.client = new Proxy(client, { get: (target, property) => {
      if (property !== "from" && property !== "rpc")
        throw new ReadingFailure("unrecorded_figure");
      return (...args: unknown[]) => {
        if (typeof args[0] !== "string") throw new ReadingFailure("unrecorded_figure");
        const query = Reflect.apply(target[property], target, args);
        return this.wrap(query, args[0], property === "rpc" ? "rpc" : "select");
      };
    } });
  }

  private wrap(builder: any, relation: string, operation: "select" | "rpc"): any {
    return new Proxy(builder, { get: (target, property) => {
      if (["insert", "update", "delete", "upsert"].includes(String(property)))
        throw new ReadingFailure("unrecorded_figure");
      if (property === "then") return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
        Promise.resolve(target).then((result: any) => {
          const ok = !result?.error && Array.isArray(result?.data);
          const entry: SourceTrace = {
            relation, operation,
            outcome: !ok ? "failed" : result.data.length ? "rows" : "empty",
            rowsScanned: ok ? result.data.length : null,
            matchedRows: ok && Number.isInteger(result.count) && result.count >= 0 ? result.count : null,
            asOf: this.clock().toISOString(),
            ...(!ok ? { failureCode: String(result?.error?.code || "invalid_result").slice(0, 80) } : {}),
          };
          this.trace.push(entry);
          if (result && typeof result === "object") this.responseTrace.set(result, entry);
          return result;
        }, (error: unknown) => {
          this.trace.push({ relation, operation, outcome: "failed", rowsScanned: null,
            matchedRows: null, asOf: this.clock().toISOString(), failureCode: "transport_error" });
          throw error;
        }).then(resolve, reject);
      const value = target[property];
      if (typeof value !== "function") throw new ReadingFailure("unrecorded_figure");
      return (...args: unknown[]) => this.wrap(Reflect.apply(value, target, args), relation, operation);
    } });
  }

  /** Ordered, exact-count pagination. Truncation or a changing count refuses. */
  async read(factory: (client: any) => any, validateScope: (row: BookRow) => boolean): Promise<Evidence> {
    const rows: BookRow[] = [];
    const ids = new Set<unknown>();
    const relations = new Set<string>();
    const pageSize = 500;
    const maxRows = 20_000;
    let expected: number | null = null;
    for (let offset = 0; ; offset += pageSize) {
      let result: any;
      try { result = await factory(this.client).order("id", { ascending: true }).range(offset, offset + pageSize - 1); }
      catch (error) {
        if (error instanceof ReadingFailure) throw error;
        throw new ReadingFailure("query_failed");
      }
      const entry = result && this.responseTrace.get(result);
      if (!entry) throw new ReadingFailure("unrecorded_figure");
      relations.add(entry.relation);
      if (entry.outcome === "failed") throw new ReadingFailure("query_failed");
      if (entry.matchedRows === null) throw new ReadingFailure("invalid_source_result");
      if (expected === null) expected = entry.matchedRows;
      if (expected === null) throw new ReadingFailure("invalid_source_result");
      if (expected !== entry.matchedRows) throw new ReadingFailure("source_changed");
      if (expected > maxRows) throw new ReadingFailure("source_limit");
      for (const raw of result.data) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw) || typeof raw.id !== "string")
          throw new ReadingFailure("invalid_source_result");
        if (!validateScope(raw)) throw new ReadingFailure("scope_mismatch");
        if (ids.has(raw.id)) throw new ReadingFailure("source_changed");
        ids.add(raw.id);
        rows.push(Object.freeze({ ...raw }));
      }
      if (rows.length > expected) throw new ReadingFailure("source_changed");
      if (rows.length === expected) return this.remember(rows, [...relations]);
      if (result.data.length < pageSize) throw new ReadingFailure("source_changed");
    }
  }

  private remember(rows: readonly BookRow[], relations: string[]): Evidence {
    const token = Object.freeze({}) as Evidence;
    this.evidence.set(token, { rows: Object.freeze([...rows]), relations });
    return token;
  }
  private recorded(e: Evidence): RecordedRows {
    const result = this.evidence.get(e);
    if (!result) throw new ReadingFailure("unrecorded_figure");
    return result;
  }
  rows(e: Evidence): readonly BookRow[] { return this.recorded(e).rows; }

  /**
   * How many rows the queries behind this evidence actually returned, summed
   * over every traced read of its relations, or null when a read failed.
   *
   * This is what separates an EMPTY REGISTER from a filter that matched
   * nothing: forty closed orders and no open one is a true zero read out of
   * the books, not an absence of books (ADR 0145 R4/R7; KL audit J4).
   */
  scannedRows(e: Evidence): number | null {
    // A row view (`relation@view`) was read from its whole relation.
    const relations = new Set(this.recorded(e).relations.map(baseRelation));
    let scanned = 0;
    for (const entry of this.trace) {
      if (!relations.has(entry.relation)) continue;
      if (entry.rowsScanned === null) return null;
      scanned += entry.rowsScanned;
    }
    return scanned;
  }
  filter(e: Evidence, test: (row: BookRow) => boolean): Evidence {
    const data = this.recorded(e);
    return this.remember(data.rows.filter(test), data.relations);
  }
  /**
   * A named ROW VIEW: the rows `test` keeps, with each relation relabelled
   * `relation@name`, so the cells minted from it need `relation@name.column`
   * tags -- the class of these rows, not the whole relation's (founder,
   * 2026-09-21, round 6: today's open deliveries are a door fact the whole
   * order book is not). The label is exactly as true as `test`; the tests on
   * each view pin what it keeps. Views do not nest.
   */
  view(e: Evidence, name: string, test: (row: BookRow) => boolean): Evidence {
    const data = this.recorded(e);
    if (!/^[a-z_]+$/.test(name) || data.relations.some(r => r.includes("@")))
      throw new ReadingFailure("unrecorded_figure");
    return this.remember(data.rows.filter(test), data.relations.map(r => `${r}@${name}`));
  }
  sorted(e: Evidence, compare: (a: BookRow, b: BookRow) => number): Evidence {
    const data = this.recorded(e);
    return this.remember([...data.rows].sort(compare), data.relations);
  }
  take(e: Evidence, limit: number): Evidence {
    const data = this.recorded(e);
    return this.remember(data.rows.slice(0, limit), data.relations);
  }
  union(evidences: Evidence[]): Evidence {
    const groups = evidences.map(e => this.recorded(e));
    const deduped = new Map<unknown, BookRow>();
    for (const group of groups) for (const row of group.rows) deduped.set(row.id, row);
    return this.remember([...deduped.values()], [...new Set(groups.flatMap(g => g.relations))]);
  }
  /** Generated dates come only from the Calendar owner's measured inputs. */
  calendar(restaurantId: string, events: Evidence, rules: Evidence, exceptions: Evidence | null,
    from: string, to: string): Evidence {
    const groups = [this.recorded(events), this.recorded(rules), ...(exceptions ? [this.recorded(exceptions)] : [])];
    const result = resolveCalendarOccurrences({ restaurantId,
      events: [...groups[0].rows] as CalendarOccurrenceRow[],
      rules: [...groups[1].rows] as CalendarOccurrenceRule[],
      exceptions: exceptions ? [...this.rows(exceptions)] as CalendarOccurrenceException[] : [], from, to });
    if (result.state !== "complete") throw new ReadingFailure(result.state === "unsupported" ? "unsupported_recurrence" : "invalid_source_result");
    return this.remember(result.events.map(row => Object.freeze(row)), [...new Set(groups.flatMap(g => g.relations))]);
  }
  private mint(e: Evidence, column: string, key: string, label: string, value: BoundCell["value"],
    unit: string | null, provenance: Provenance): BoundCell {
    const data = this.recorded(e);
    if (!data.relations.length || !this.trace.length) throw new ReadingFailure("unrecorded_figure");
    // The cell's field must be one its Reading declared, on a relation this
    // evidence actually came from -- otherwise the role gate was decided on
    // classes that do not describe what is about to be shown.
    if (!data.relations.some(relation => this.shown.has(`${relation}.${column}`)))
      throw new ReadingFailure("undeclared_field");
    const cell: BoundCell = Object.freeze({ id: randomUUID(), key, label, value, unit,
      source: "house", provenance: value === null ? "not_recorded" : provenance,
      sourceRelations: [...data.relations] });
    this.cells.add(cell);
    return cell;
  }
  field(e: Evidence, row: BookRow, field: string, label: string,
    unit: string | null = null, provenance: Provenance = "stated", asNumber = false): BoundCell {
    if (!this.rows(e).includes(row)) throw new ReadingFailure("unrecorded_figure");
    const raw = row[field];
    const value = asNumber ? numeric(raw) :
      typeof raw === "string" || typeof raw === "boolean" || typeof raw === "number" ? raw : null;
    const derivedDate = row.is_virtual_occurrence === true && ["start_date", "end_date", "occurrence_date"].includes(field);
    return this.mint(e, field, `${String(row.id)}:${field}`, label, value, unit, derivedDate ? "derived" : provenance);
  }
  count(e: Evidence, key: string, label: string, unit = "records"): BoundCell {
    return this.mint(e, "*", key, label, this.rows(e).length, unit, "derived");
  }
  sum(e: Evidence, field: string, key: string, label: string, unit: string): BoundCell {
    const values = this.rows(e).map(row => numeric(row[field]));
    // Missing is not zero, including one unknown among otherwise known values.
    const value = values.some(v => v === null) ? null : (values as number[]).reduce((a, b) => a + b, 0);
    return this.mint(e, field, key, label, value, unit, "derived");
  }
  finish(id: ReadingId, args: ReadingArgs, rows: FindingRow[],
    outcome: ReadingOutcome = "read", reason: ReadingReason | null = null,
    choices?: Finding["choices"]): Finding {
    for (const row of rows) for (const cell of row.cells)
      if (!this.cells.has(cell)) throw new ReadingFailure("unrecorded_figure");
    if (rows.length && !this.trace.length) throw new ReadingFailure("unrecorded_figure");
    const traces = this.trace.map(t => ({ ...t }));
    const version = this.version;
    const fingerprint = findingFingerprint({ id, version, args, outcome, reason, rows });
    return { kind: "finding", readingId: id, readingVersion: version, args, outcome, reason,
      asOf: this.clock().toISOString(), trace: traces,
      sourcesQueried: [...new Set(traces.map(t => t.relation))],
      failedSources: [...new Set(traces.filter(t => t.outcome === "failed").map(t => t.relation))],
      rowsScanned: traces.some(t => t.rowsScanned === null) ? null : traces.reduce((n, t) => n + t.rowsScanned!, 0),
      rows, fingerprint, ...(choices ? { choices } : {}) };
  }
}
