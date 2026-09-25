import { isUniqueViolation } from '../is-unique-violation';

describe('isUniqueViolation', () => {
  it('returns true for a Postgres unique_violation (23505)', () => {
    expect(isUniqueViolation({ driverError: { code: '23505' } })).toBe(true);
  });

  it('returns false for other Postgres error codes', () => {
    expect(isUniqueViolation({ driverError: { code: '23503' } })).toBe(false);
  });

  it('returns false for errors without a driverError', () => {
    expect(isUniqueViolation(new Error('boom'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation('23505')).toBe(false);
  });
});
