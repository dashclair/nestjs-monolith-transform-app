import { BadRequestException } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { SortOrder, UserSortField } from '../dto/list-users.dto';

export type UsersCursor = {
  value: string; // createdAt (ISO) or email, depending on `sort`
  id: string;
  sort: UserSortField;
  order: SortOrder;
};

/**
 * Strict check that `value` is exactly what `Date#toISOString()` produces —
 * the only format we ever encode createdAt cursors in. `Date.parse` alone is
 * too lenient: it accepts '1' or '2026', which Postgres then rejects with a
 * 500. Years outside 0001–9999 are rejected too: JS round-trips year 0 and
 * `±YYYYYY` extended years, Postgres doesn't.
 */
function isIsoTimestamp(value: string): boolean {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const year = date.getUTCFullYear();
  return year >= 1 && year <= 9999 && date.toISOString() === value;
}

export function encodeUsersCursor(cursor: UsersCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeUsersCursor(
  cursor: string,
  sort: UserSortField,
  order: SortOrder,
): UsersCursor {
  let parsed: Partial<UsersCursor>;
  try {
    parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as Partial<UsersCursor>;
  } catch {
    throw new BadRequestException('Invalid cursor');
  }

  const isValid =
    parsed?.sort === sort &&
    parsed.order === order &&
    typeof parsed.value === 'string' &&
    typeof parsed.id === 'string' &&
    isUUID(parsed.id) &&
    (sort !== UserSortField.CreatedAt || isIsoTimestamp(parsed.value));

  if (!isValid) {
    throw new BadRequestException('Invalid cursor');
  }

  return parsed as UsersCursor;
}
