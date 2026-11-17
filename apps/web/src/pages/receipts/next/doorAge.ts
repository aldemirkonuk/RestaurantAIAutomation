/**
 * How long ago a delivery was counted at the door, said the way a person says
 * it: hours while it is under two days old, whole days after that. A count the
 * gateway calls overdue says so in words, so a count a year old is not a bare
 * number of hours.
 */
export function doorAge(ageHours: number, severity: 'fresh' | 'stale' | 'overdue'): string {
  const hours = Math.max(0, Math.round(ageHours));
  const when =
    hours < 48 ? `${hours}h ago` : `${Math.floor(hours / 24)} ${Math.floor(hours / 24) === 1 ? 'day' : 'days'} ago`;
  return severity === 'overdue' ? `${when}, overdue` : when;
}
