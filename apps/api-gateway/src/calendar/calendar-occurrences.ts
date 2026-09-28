/** Date-only recurrence resolver shared by the Calendar owner and recorded Ask reads.
 * Callers must prove all input pages were read. Work limits refuse an incomplete
 * answer; they never turn a truncated set into a count or an empty calendar.
 */
export interface CalendarOccurrenceRow {
  id: string; restaurant_id: string; start_date: string; end_date?: string | null;
  status?: string; is_recurring?: boolean; parent_event_id?: string | null;
  occurrence_date?: string | null; recurrence_rule_id?: string | null;
  [key: string]: unknown;
}
export interface CalendarOccurrenceRule {
  id: string; restaurant_id: string; calendar_event_id: string; frequency: string;
  interval_value?: number; days_of_week?: number[] | null; day_of_month?: number | null;
  week_of_month?: number | null; month_of_year?: number | null; end_type: string;
  end_after_count?: number | null; end_on_date?: string | null;
  [key: string]: unknown;
}
export interface CalendarOccurrenceException {
  recurrence_rule_id: string; original_date: string; exception_type: string;
  replacement_event_id?: string | null; [key: string]: unknown;
}
export interface ResolvedCalendarOccurrence extends CalendarOccurrenceRow { is_virtual_occurrence: boolean }
export type CalendarOccurrenceResult =
  | { state: 'complete'; events: ResolvedCalendarOccurrence[] }
  | { state: 'incomplete' | 'unsupported'; reason: string; detail: string };

const DAY = 86_400_000;
const MAX_STEPS = 1_000_000;
const MAX_OUTPUT = 100_000;
function day(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date.getTime() / DAY : null;
}
function iso(value: number): string { return new Date(value * DAY).toISOString().slice(0, 10); }
function integer(value: unknown, min: number, max: number): value is number { return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max; }
function failure(reason: string, detail: string, state: 'incomplete' | 'unsupported' = 'incomplete'): CalendarOccurrenceResult { return { state, reason, detail }; }

export function resolveCalendarOccurrences(input: {
  restaurantId: string; events: CalendarOccurrenceRow[]; rules: CalendarOccurrenceRule[];
  exceptions: CalendarOccurrenceException[]; from: string; to: string;
}): CalendarOccurrenceResult {
  const from = day(input.from), to = day(input.to);
  if (from === null || to === null || from > to) return failure('invalid_window', 'The calendar needs a valid, ordered pair of date-only bounds.');
  const byId = new Map<string, CalendarOccurrenceRow>();
  for (const event of input.events) {
    if (event.restaurant_id !== input.restaurantId || !event.id || byId.has(event.id)) return failure('event_identity', 'Calendar rows are duplicated or do not belong to this house.');
    if (day(event.start_date) === null || (event.end_date != null && (day(event.end_date) === null || event.end_date < event.start_date))) return failure('event_date', 'A calendar row has an unreadable date or end date.');
    byId.set(event.id, event);
  }
  const rules = new Map<string, CalendarOccurrenceRule>();
  const rulesByParent = new Map<string, CalendarOccurrenceRule[]>();
  for (const rule of input.rules) {
    if (rule.restaurant_id !== input.restaurantId || rules.has(rule.id) || !byId.has(rule.calendar_event_id)) return failure('rule_identity', 'A repeat rule is duplicated, belongs elsewhere, or is missing its event.');
    rules.set(rule.id, rule);
    rulesByParent.set(rule.calendar_event_id, [...(rulesByParent.get(rule.calendar_event_id) ?? []), rule]);
  }
  const exceptions = new Map<string, CalendarOccurrenceException>();
  const replacements = new Set<string>();
  for (const exception of input.exceptions) {
    const key = `${exception.recurrence_rule_id}:${exception.original_date}`;
    if (!rules.has(exception.recurrence_rule_id) || exceptions.has(key) || day(exception.original_date) === null) return failure('exception_identity', 'An exception is duplicated or its owned repeat rule/date cannot be established.');
    if (exception.exception_type !== 'deleted' && exception.exception_type !== 'modified') return failure('exception_type', 'This exception kind has no supported meaning.', 'unsupported');
    if (exception.exception_type === 'modified') {
      const replacement = exception.replacement_event_id && byId.get(exception.replacement_event_id);
      if (!replacement || replacements.has(replacement.id)) return failure('missing_replacement', 'A changed occurrence has no single readable replacement.');
      const owner = rules.get(exception.recurrence_rule_id)!;
      if (replacement.id === owner.calendar_event_id || (replacement.parent_event_id && replacement.parent_event_id !== owner.calendar_event_id)) return failure('replacement_owner', 'A changed occurrence points at a different series.');
      replacements.add(replacement.id);
    }
    exceptions.set(key, exception);
  }
  const children = new Map<string, Map<string, CalendarOccurrenceRow>>();
  for (const event of input.events) {
    if (!event.parent_event_id) continue;
    const parent = byId.get(event.parent_event_id);
    if (!parent || parent.parent_event_id || !event.occurrence_date || day(event.occurrence_date) === null) return failure('orphan_occurrence', 'A stored occurrence is missing its parent or original date.');
    const group = children.get(parent.id) ?? new Map<string, CalendarOccurrenceRow>();
    if (group.has(event.occurrence_date)) return failure('duplicate_occurrence', 'More than one stored row claims the same occurrence.');
    group.set(event.occurrence_date, event); children.set(parent.id, group);
  }
  const output = new Map<string, ResolvedCalendarOccurrence>();
  const append = (row: CalendarOccurrenceRow, virtual = false) => {
    if (row.status === 'cancelled' || row.status === 'dismissed') return;
    if (row.start_date > input.to || (row.end_date ?? row.start_date) < input.from) return;
    output.set(row.id, { ...row, is_virtual_occurrence: virtual });
  };
  let steps = 0;
  for (const parent of input.events) {
    if (parent.parent_event_id || replacements.has(parent.id)) continue;
    if (parent.status === 'cancelled' || parent.status === 'dismissed') continue;
    const ownedRules = rulesByParent.get(parent.id) ?? [];
    if (!parent.is_recurring && !parent.recurrence_rule_id && ownedRules.length === 0) {
      if (children.has(parent.id)) return failure('missing_rule', 'Stored occurrences exist without a parent repeat rule.');
      append(parent); continue;
    }
    if (ownedRules.length !== 1 || (parent.recurrence_rule_id && ownedRules[0].id !== parent.recurrence_rule_id)) return failure('missing_rule', 'The series does not have exactly one readable repeat rule.');
    const rule = ownedRules[0];
    if (!['daily', 'weekly', 'monthly', 'yearly'].includes(rule.frequency)) return failure('unsupported_frequency', `The ${rule.frequency} repeat rule cannot be expanded safely.`, 'unsupported');
    const interval = rule.interval_value ?? 1;
    if (!integer(interval, 1, 365) || !['never', 'on_date', 'after_count'].includes(rule.end_type)) return failure('invalid_rule', 'The repeat interval or end condition is invalid.');
    if (rule.days_of_week != null && (!Array.isArray(rule.days_of_week) || rule.days_of_week.some((n) => !integer(n, 0, 6)))) return failure('invalid_rule', 'A repeat weekday is outside Sunday through Saturday.');
    if (rule.day_of_month != null && !integer(rule.day_of_month, 1, 31)) return failure('invalid_rule', 'The repeat day of month is invalid.');
    if (rule.week_of_month != null && (!integer(rule.week_of_month, 1, 5) || !rule.days_of_week?.length)) return failure('invalid_rule', 'A repeat week of month requires a valid weekday.');
    if (rule.month_of_year != null && !integer(rule.month_of_year, 1, 12)) return failure('invalid_rule', 'The repeat month is invalid.');
    const movedDates = [ ...[...(children.get(parent.id)?.values() ?? [])].map((row) => row.occurrence_date!), ...input.exceptions.filter((ex) => ex.recurrence_rule_id === rule.id && ex.exception_type === 'modified').map((ex) => ex.original_date) ];
    const candidateEnd = Math.max(to, ...movedDates.map((value) => day(value)!));
    const end = rule.end_type === 'on_date' ? day(rule.end_on_date) : candidateEnd;
    if (end === null || (rule.end_type === 'after_count' && !integer(rule.end_after_count, 1, Number.MAX_SAFE_INTEGER))) return failure('invalid_rule', 'The series end date or occurrence count is unreadable.');
    const anchor = day(parent.start_date)!;
    const anchorDate = new Date(anchor * DAY);
    const duration = day(parent.end_date ?? parent.start_date)! - anchor;
    const weekdays = rule.days_of_week?.length ? rule.days_of_week : [anchorDate.getUTCDay()];
    const anchorWeek = anchor - anchorDate.getUTCDay();
    let count = 0;
    for (let cursor = anchor; cursor <= Math.min(candidateEnd, end); cursor++) {
      if (++steps > MAX_STEPS) return failure('expansion_limit', 'The requested calendar requires more expansion work than can be completed in one read. Narrow the date window.');
      const date = new Date(cursor * DAY);
      const monthDelta = (date.getUTCFullYear() - anchorDate.getUTCFullYear()) * 12 + date.getUTCMonth() - anchorDate.getUTCMonth();
      const monthDayMatches = rule.week_of_month != null
        ? Math.floor((date.getUTCDate() - 1) / 7) + 1 === rule.week_of_month && weekdays.includes(date.getUTCDay()) && (rule.day_of_month == null || date.getUTCDate() === rule.day_of_month)
        : date.getUTCDate() === (rule.day_of_month ?? anchorDate.getUTCDate());
      const qualifies = rule.frequency === 'daily' ? (cursor - anchor) % interval === 0
        : rule.frequency === 'weekly' ? Math.floor((cursor - anchorWeek) / 7) % interval === 0 && weekdays.includes(date.getUTCDay())
        : rule.frequency === 'monthly' ? monthDelta % interval === 0 && monthDayMatches
        : (date.getUTCFullYear() - anchorDate.getUTCFullYear()) % interval === 0 && date.getUTCMonth() + 1 === (rule.month_of_year ?? anchorDate.getUTCMonth() + 1) && monthDayMatches;
      if (!qualifies) continue;
      count++;
      if (rule.end_type === 'after_count' && count > rule.end_after_count!) break;
      const occurrenceDate = iso(cursor);
      const exception = exceptions.get(`${rule.id}:${occurrenceDate}`);
      if (exception?.exception_type === 'deleted') continue;
      if (exception?.exception_type === 'modified') { append(byId.get(exception.replacement_event_id!)!); continue; }
      const stored = children.get(parent.id)?.get(occurrenceDate);
      if (stored) {
        if (stored.recurrence_rule_id && stored.recurrence_rule_id !== rule.id) return failure('occurrence_rule', 'A stored occurrence names a different repeat rule.');
        append(stored); continue;
      }
      if (cursor + duration < from) continue;
      append({ ...parent, id: `${parent.id}__occ_${occurrenceDate}`, start_date: occurrenceDate,
        end_date: parent.end_date ? iso(cursor + duration) : null, parent_event_id: parent.id,
        occurrence_date: occurrenceDate, recurrence_rule_id: rule.id }, true);
      if (output.size > MAX_OUTPUT) return failure('output_limit', 'The calendar has too many occurrences for one complete answer. Narrow the date window.');
    }

  }
  if (output.size > MAX_OUTPUT) return failure('output_limit', 'The calendar has too many occurrences for one complete answer. Narrow the date window.');
  return { state: 'complete', events: [...output.values()].sort((a, b) => a.start_date.localeCompare(b.start_date) || a.id.localeCompare(b.id)) };
}
