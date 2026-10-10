/**
 * The Today header: a greeting, and the house that is open (F-675). An owner
 * of two houses saw the same greeting in both and had no screen saying which
 * house's orders and sales they were looking at. The house line is left out
 * until the houses are read, rather than guessed.
 */
export function todayHeader(input: {
  hour: number;
  userName?: string | null;
  houseName?: string | null;
}): { greeting: string; house: string | null } {
  const name = input.userName ? `, ${input.userName.split(" ")[0]}` : "";
  const greeting =
    input.hour < 11
      ? `Morning${name}`
      : input.hour < 17
        ? `Afternoon${name}`
        : `Evening${name}`;
  return { greeting, house: input.houseName?.trim() || null };
}
