import { BadRequestException } from '@nestjs/common';

import { SortOrder, UserSortField } from '../dto/list-users.dto';
import {
  decodeUsersCursor,
  encodeUsersCursor,
  UsersCursor,
} from '../utils/users-list-cursor';

describe('users-list-cursor', () => {
  const validCursor: UsersCursor = {
    sort: UserSortField.CreatedAt,
    order: SortOrder.Desc,
    value: '2026-09-02T10:00:00.000Z',
    id: '22222222-2222-4222-8222-222222222222',
  };

  // Raw encoding, so malformed payloads can be built without going through
  // the typed encodeUsersCursor().
  const encodeRaw = (payload: unknown): string =>
    Buffer.from(JSON.stringify(payload)).toString('base64url');

  it('round-trips a cursor it encoded', () => {
    const encoded = encodeUsersCursor(validCursor);

    expect(
      decodeUsersCursor(encoded, validCursor.sort, validCursor.order),
    ).toEqual(validCursor);
  });

  it('encodes as URL-safe base64 (no +, / or = to escape in a query string)', () => {
    const encoded = encodeUsersCursor({ ...validCursor, value: '??>>~~' });

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('accepts the year boundaries Postgres supports', () => {
    for (const value of [
      '0001-01-01T00:00:00.000Z',
      '9999-12-31T23:59:59.999Z',
    ]) {
      const cursor = { ...validCursor, value };

      expect(
        decodeUsersCursor(encodeUsersCursor(cursor), cursor.sort, cursor.order),
      ).toEqual(cursor);
    }
  });

  it('accepts any string value for an email-sorted cursor', () => {
    const cursor: UsersCursor = {
      ...validCursor,
      sort: UserSortField.Email,
      order: SortOrder.Asc,
      value: 'user2@example.com',
    };

    expect(
      decodeUsersCursor(
        encodeUsersCursor(cursor),
        UserSortField.Email,
        SortOrder.Asc,
      ),
    ).toEqual(cursor);
  });

  it.each([
    ['not base64/JSON', 'garbage!!'],
    ['JSON of the wrong shape', encodeRaw({ foo: 'bar' })],
    ['JSON null', encodeRaw(null)],
    ['JSON primitive', encodeRaw('123')],
    [
      'issued for another sort',
      encodeRaw({ ...validCursor, sort: UserSortField.Email }),
    ],
    [
      'issued for another order',
      encodeRaw({ ...validCursor, order: SortOrder.Asc }),
    ],
    ['id is not a UUID', encodeRaw({ ...validCursor, id: 'user-1' })],
    ['value is not a string', encodeRaw({ ...validCursor, value: 123 })],
    [
      'createdAt is not a date',
      encodeRaw({ ...validCursor, value: 'not-a-date' }),
    ],
    // Regression: Date.parse accepts these, Postgres doesn't → used to be 500.
    ["createdAt is '1'", encodeRaw({ ...validCursor, value: '1' })],
    ["createdAt is '2026'", encodeRaw({ ...validCursor, value: '2026' })],
    [
      'createdAt is not in toISOString() format',
      encodeRaw({ ...validCursor, value: '2026-09-02 10:00:00' }),
    ],
    [
      'createdAt is an impossible date JS would roll over',
      encodeRaw({ ...validCursor, value: '2026-02-30T00:00:00.000Z' }),
    ],
    [
      'createdAt is year 0',
      encodeRaw({ ...validCursor, value: '0000-01-01T00:00:00.000Z' }),
    ],
    [
      'createdAt is an extended (6-digit) year',
      encodeRaw({ ...validCursor, value: '+275760-09-13T00:00:00.000Z' }),
    ],
  ])(
    'rejects a cursor that is %s with 400 Invalid cursor',
    (_label, cursor) => {
      expect(() =>
        decodeUsersCursor(cursor, UserSortField.CreatedAt, SortOrder.Desc),
      ).toThrow(new BadRequestException('Invalid cursor'));
    },
  );
});
