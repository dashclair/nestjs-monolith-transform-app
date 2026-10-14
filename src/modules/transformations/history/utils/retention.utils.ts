const DAY_MS = 24 * 60 * 60 * 1000;

export function retentionCutoff(days: number, now = Date.now()): Date {
  return new Date(now - days * DAY_MS);
}
