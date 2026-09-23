import { BadRequestException } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { SortOrder, UserSortField } from '../dto/list-users.dto';

export type UsersCursor = {
  value: string; // createdAt (ISO) or email, depending on `sort`
  id: string;
  sort: UserSortField;
  order: SortOrder;
};

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
    (sort !== UserSortField.CreatedAt ||
      !Number.isNaN(Date.parse(parsed.value)));

  if (!isValid) {
    throw new BadRequestException('Invalid cursor');
  }

  return parsed as UsersCursor;
}
