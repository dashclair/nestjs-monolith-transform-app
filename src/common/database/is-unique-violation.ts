const PG_UNIQUE_VIOLATION = '23505';

/**
 * True when a TypeORM `QueryFailedError` was caused by a Postgres unique
 * constraint. Duck-typed on `driverError.code` so `common/` stays free of a
 * TypeORM import.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { driverError } = error as { driverError?: { code?: unknown } };
  return driverError?.code === PG_UNIQUE_VIOLATION;
}
