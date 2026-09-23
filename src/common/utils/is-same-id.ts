/**
 * Compares two UUIDs case-insensitively. `ParseUUIDPipe` accepts uppercase
 * input without normalizing it, and Postgres compares `uuid` values
 * case-insensitively — so a plain `===` between a JWT `sub` (lowercase) and a
 * route param (possibly uppercase) would treat the same user as two different
 * ones. Guards run before pipes and read raw `request.params`, so this check
 * has to happen at the comparison site, not in a pipe.
 */
export function isSameId(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}
