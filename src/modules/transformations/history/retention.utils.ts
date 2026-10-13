const DAY_MS = 24 * 60 * 60 * 1000;

// Shared by the history queries and the cleanup job, so that "not shown" and
// "deleted" always agree on the same cutoff.
export function retentionCutoff(days: number, now = Date.now()): Date {
  return new Date(now - days * DAY_MS);
}
