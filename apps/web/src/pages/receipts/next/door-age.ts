/**
 * How long ago a door count was made, as the "counted at the door, no
 * paperwork yet" strip says it: hours up to two days, whole days after that
 * (a count 300 days old read "7199h ago"), and "overdue" when the gateway
 * marks it so, the same word the counter and the receiving queue use.
 */
export function doorAgeSaid(ageHours: number, severity: 'fresh' | 'stale' | 'overdue'): string {
  const hours = Math.max(0, Math.round(ageHours))
  const ago = hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)} days ago`
  return severity === 'overdue' ? `${ago}, overdue` : ago
}
