import { CalendarOccurrenceRule, CalendarOccurrenceRow, CalendarOccurrenceException, resolveCalendarOccurrences } from '../calendar-occurrences';
import { zonedWallClockToUtc } from '../zoned-time';
const DAYS = ['SU','MO','TU','WE','TH','FR','SA'];
/** Compile only recurrence forms which the owner resolver also understands. */
export function googleRecurrence(parent: CalendarOccurrenceRow, rule: CalendarOccurrenceRule, exceptions: CalendarOccurrenceException[], children: CalendarOccurrenceRow[], zone: string | null): { lines: string[]; firstDate: string } {
  const checked = resolveCalendarOccurrences({ restaurantId: parent.restaurant_id, events: [parent, ...children], rules: [rule], exceptions, from: parent.start_date, to: parent.start_date });
  if (checked.state !== 'complete') throw new Error(checked.detail);
  const start = new Date(`${parent.start_date}T00:00:00Z`);
  const probe = new Date(start);
  probe.setUTCDate(probe.getUTCDate() + (rule.frequency === 'yearly' ? 366 : rule.frequency === 'monthly' ? 32 : rule.frequency === 'weekly' ? 7 : 1) * (rule.interval_value ?? 1) + 366);
  const probeEnd = probe.toISOString().slice(0, 10);
  const first = resolveCalendarOccurrences({ restaurantId: parent.restaurant_id, events: [parent], rules: [{ ...rule, end_type: 'after_count', end_after_count: 1 }], exceptions: [], from: parent.start_date, to: rule.end_type === 'on_date' && rule.end_on_date! < probeEnd ? rule.end_on_date! : probeEnd });
  if (first.state !== 'complete' || first.events.length !== 1) throw new Error('This repeat rule has no supported first occurrence to copy.');
  const firstDate = first.events[0].start_date;
  const fields = [`FREQ=${rule.frequency.toUpperCase()}`, `INTERVAL=${rule.interval_value ?? 1}`];
  const weekdays = rule.days_of_week?.length ? rule.days_of_week : [start.getUTCDay()];
  if (rule.frequency === 'weekly') { fields.push('WKST=SU'); fields.push(`BYDAY=${weekdays.map((n) => DAYS[n]).join(',')}`); }
  if (rule.frequency === 'monthly' || rule.frequency === 'yearly') {
    if (rule.week_of_month != null) fields.push(`BYDAY=${weekdays.map((n) => `${rule.week_of_month}${DAYS[n]}`).join(',')}`);
    if (rule.week_of_month == null || rule.day_of_month != null) fields.push(`BYMONTHDAY=${rule.day_of_month ?? start.getUTCDate()}`);
  }
  if (rule.frequency === 'yearly') fields.push(`BYMONTH=${rule.month_of_year ?? start.getUTCMonth() + 1}`);
  if (rule.end_type === 'after_count') fields.push(`COUNT=${rule.end_after_count}`);
  if (rule.end_type === 'on_date') {
    if (parent.all_day === false && !zone) throw new Error('The house timezone is required to copy a timed repeat.');
    const until = parent.all_day === false
      ? zonedWallClockToUtc(rule.end_on_date!, '23:59', zone!).toISOString().replace(/[-:]/g,'').replace('.000','')
      : rule.end_on_date!.replace(/-/g,'');
    fields.push(`UNTIL=${until}`);
  }
  const omitted = new Set([...exceptions.map((exception) => exception.original_date), ...children.map((child) => child.occurrence_date!).filter(Boolean)]);
  const result = [`RRULE:${fields.join(';')}`];
  if (omitted.size) {
    const dates = [...omitted].sort();
    if (parent.all_day === false) {
      if (!zone) throw new Error('The house timezone is required to copy timed repeat exceptions.');
      const time = String(parent.start_time ?? '').replace(/:/g,'').padEnd(6,'0');
      result.push(`EXDATE;TZID=${zone}:${dates.map((date) => `${date.replace(/-/g,'')}T${time}`).join(',')}`);
    } else result.push(`EXDATE;VALUE=DATE:${dates.map((date) => date.replace(/-/g,'')).join(',')}`);
  }
  return { lines: result, firstDate };
}
