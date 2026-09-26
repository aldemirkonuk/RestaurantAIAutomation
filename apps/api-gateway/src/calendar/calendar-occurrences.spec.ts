import { resolveCalendarOccurrences, CalendarOccurrenceRow, CalendarOccurrenceRule, CalendarOccurrenceException } from './calendar-occurrences';
const parent: CalendarOccurrenceRow = { id: 'series', restaurant_id: 'house', title: 'Delivery', start_date: '2020-01-06', is_recurring: true, recurrence_rule_id: 'rule', status: 'pending' };
const weekly: CalendarOccurrenceRule = { id: 'rule', restaurant_id: 'house', calendar_event_id: 'series', frequency: 'weekly', interval_value: 1, days_of_week: [1], end_type: 'never' };
function read(events = [parent], rules = [weekly], exceptions: CalendarOccurrenceException[] = [], from = '2026-09-01', to = '2026-09-30') {
 return resolveCalendarOccurrences({ restaurantId: 'house', events, rules, exceptions, from, to });
}
function dates(result: ReturnType<typeof read>) { if (result.state !== 'complete') throw new Error(JSON.stringify(result)); return result.events.map((row) => row.start_date); }
it('expands an old series past the former 1,000-day ceiling without local timezone drift', () => {
 expect(dates(read())).toEqual(['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28']);
});
it('counts a materialized occurrence once, uses its edited fields, and suppresses its template', () => {
 const child = { ...parent, id: 'child', parent_event_id: parent.id, occurrence_date: '2026-09-14', start_date: '2026-09-14', title: 'Changed delivery' };
 const result = read([parent, child]); expect(dates(result)).toHaveLength(4);
 if (result.state === 'complete') expect(result.events.find((row) => row.start_date === child.start_date)).toMatchObject({ id: 'child', title: 'Changed delivery', is_virtual_occurrence: false });
});
it('suppresses cancelled children and deleted exceptions', () => {
 const child = { ...parent, id: 'cancelled', parent_event_id: parent.id, occurrence_date: '2026-09-14', start_date: '2026-09-14', status: 'cancelled' };
 expect(dates(read([parent, child], [weekly], [{ recurrence_rule_id: 'rule', original_date: '2026-09-21', exception_type: 'deleted' }]))).toEqual(['2026-09-07', '2026-09-28']);
});
it('uses a moved replacement once and suppresses the original date', () => {
 const replacement = { ...parent, id: 'replacement', is_recurring: false, recurrence_rule_id: null, parent_event_id: parent.id, occurrence_date: '2026-09-14', start_date: '2026-09-16' };
 expect(dates(read([parent, replacement], [weekly], [{ recurrence_rule_id: 'rule', original_date: '2026-09-14', exception_type: 'modified', replacement_event_id: replacement.id }]))).toEqual(['2026-09-07', '2026-09-16', '2026-09-21', '2026-09-28']);
});
it('includes a replacement moved into a window from a later original date', () => {
 const replacement = { ...parent, id: 'replacement', is_recurring: false, recurrence_rule_id: null, parent_event_id: parent.id, occurrence_date: '2026-10-05', start_date: '2026-09-16' };
 expect(dates(read([parent, replacement], [weekly], [{ recurrence_rule_id: 'rule', original_date: '2026-10-05', exception_type: 'modified', replacement_event_id: replacement.id }]))).toContain('2026-09-16');
});
it('does not resurrect replacements beyond the series end', () => {
 const replacement = { ...parent, id: 'replacement', is_recurring: false, recurrence_rule_id: null, parent_event_id: parent.id, occurrence_date: '2026-10-05', start_date: '2026-09-16' };
 expect(dates(read([parent, replacement], [{ ...weekly, end_type: 'on_date', end_on_date: '2026-09-15' }], [{ recurrence_rule_id: 'rule', original_date: '2026-10-05', exception_type: 'modified', replacement_event_id: replacement.id }]))).toEqual(['2026-09-07', '2026-09-14']);
});
it('skips missing month days instead of rolling into another month', () => {
 expect(dates(read([{ ...parent, start_date: '2026-01-31' }], [{ ...weekly, frequency: 'monthly', days_of_week: null }], [], '2026-01-01', '2026-05-31'))).toEqual(['2026-01-31', '2026-03-31', '2026-05-31']);
});
it('supports leap-day yearly rules and counted weekly intervals', () => {
 expect(dates(read([{ ...parent, start_date: '2024-02-29' }], [{ ...weekly, frequency: 'yearly', days_of_week: null }], [], '2024-01-01', '2028-12-31'))).toEqual(['2024-02-29', '2028-02-29']);
 expect(dates(read([{ ...parent, start_date: '2026-09-07' }], [{ ...weekly, interval_value: 2, end_type: 'after_count', end_after_count: 2 }], [], '2026-09-01', '2026-12-31'))).toEqual(['2026-09-07', '2026-09-21']);
});
it('supports a numbered weekday and multi-day overlaps', () => {
 expect(dates(read([{ ...parent, start_date: '2026-01-01' }], [{ ...weekly, frequency: 'monthly', week_of_month: 2, days_of_week: [2] }], [], '2026-09-01', '2026-09-30'))).toEqual(['2026-09-08']);
 expect(dates(read([{ id: 'one', restaurant_id: 'house', start_date: '2026-08-30', end_date: '2026-09-02' }], []))).toEqual(['2026-08-30']);
});
it('does not invent daily recurrence for custom or invalid rules', () => {
 expect(read([parent], [{ ...weekly, frequency: 'custom' }])).toMatchObject({ state: 'unsupported', reason: 'unsupported_frequency' });
 expect(read([parent], [{ ...weekly, days_of_week: [9] }])).toMatchObject({ state: 'incomplete', reason: 'invalid_rule' });
});
it('refuses missing rules, unreadable replacements, duplicate children and foreign rows', () => {
 expect(read([parent], [])).toMatchObject({ state: 'incomplete', reason: 'missing_rule' });
 expect(read([parent], [weekly], [{ recurrence_rule_id: 'rule', original_date: '2026-09-14', exception_type: 'modified', replacement_event_id: 'missing' }])).toMatchObject({ state: 'incomplete', reason: 'missing_replacement' });
 const child = { ...parent, id: 'child', parent_event_id: parent.id, occurrence_date: '2026-09-14', start_date: '2026-09-14' };
 expect(read([parent, child, { ...child, id: 'duplicate' }])).toMatchObject({ state: 'incomplete', reason: 'duplicate_occurrence' });
 expect(read([{ ...parent, restaurant_id: 'other' }])).toMatchObject({ state: 'incomplete', reason: 'event_identity' });
});
it('returns no occurrences for a cancelled series or a counted series already exhausted', () => {
 expect(dates(read([{ ...parent, status: 'cancelled' }]))).toEqual([]);
 expect(dates(read([parent], [{ ...weekly, end_type: 'after_count', end_after_count: 1 }]))).toEqual([]);
});
