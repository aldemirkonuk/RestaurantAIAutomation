/** A range is never evidence that every row was read. Callers supply literal
 * scoped table queries so schema guards and audit readers can identify them. */
export async function readCalendarPages<T>(factory: () => any): Promise<T[]> {
  const rows: T[] = [];
  let expected: number | null = null;
  for (let offset = 0; offset < 100_000; offset += 500) {
    const { data, error, count } = await factory().order('id', { ascending: true }).range(offset, offset + 499);
    if (error || !Array.isArray(data) || typeof count !== 'number' || (expected !== null && expected !== count)) throw new Error('The calendar book could not be read completely; retry this window.');
    expected = count; rows.push(...data);
    if (rows.length === count) return rows;
    if (data.length === 0 || rows.length > count) throw new Error('The calendar book changed while it was being read; retry this window.');
  }
  throw new Error("The calendar book exceeds this read's complete-result limit.");
}
