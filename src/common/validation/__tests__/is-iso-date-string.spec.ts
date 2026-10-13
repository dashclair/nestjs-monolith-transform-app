import { isIsoDateString } from '../is-iso-date-string.decorator';

describe('isIsoDateString', () => {
  it.each([
    '2026-10-12',
    '2026-10-12T10:00:00Z',
    '2026-10-12T10:00:00.123Z',
    '2026-10-12T10:00:00+03:00',
  ])('accepts %s', (value) => {
    expect(isIsoDateString(value)).toBe(true);
  });

  it.each([
    ['a week date', '2026-W41'],
    ['an ordinal date', '2026-285'],
    ['an impossible date', '2026-02-30'],
    ['year 0', '0000-01-01'],
    ['a non-ISO date', '10/12/2026'],
    ['an empty string', ''],
    ['a number', 1791763200000],
  ])('rejects %s', (_label, value) => {
    expect(isIsoDateString(value)).toBe(false);
  });
});
