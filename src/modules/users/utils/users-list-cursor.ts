import { isUUID } from 'class-validator';

import {
  decodeCursor,
  encodeCursor,
  isIsoTimestamp,
} from '@/core/database/keyset-pagination';

import { SortOrder, UserSortField } from '../dto/list-users.dto';

export type UsersCursor = {
  value: string; // createdAt (ISO) or email, depending on `sort`
  id: string;
  sort: UserSortField;
  order: SortOrder;
};

export function encodeUsersCursor(cursor: UsersCursor): string {
  return encodeCursor(cursor);
}

export function decodeUsersCursor(
  cursor: string,
  sort: UserSortField,
  order: SortOrder,
): UsersCursor {
  return decodeCursor<UsersCursor>(
    cursor,
    (parsed) =>
      parsed?.sort === sort &&
      parsed.order === order &&
      typeof parsed.value === 'string' &&
      typeof parsed.id === 'string' &&
      isUUID(parsed.id) &&
      (sort !== UserSortField.CreatedAt || isIsoTimestamp(parsed.value)),
  );
}
