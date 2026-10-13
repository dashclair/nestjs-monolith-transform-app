import { BadRequestException } from '@nestjs/common';
import type { ObjectLiteral, SelectQueryBuilder } from 'typeorm';

export type SortDirection = 'ASC' | 'DESC';

export type KeysetCursor = {
  value: string;
  id: string;
};

export function isIsoTimestamp(value: string): boolean {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const year = date.getUTCFullYear();
  return year >= 1 && year <= 9999 && date.toISOString() === value;
}

export function encodeCursor(cursor: KeysetCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor<T extends KeysetCursor>(
  cursor: string,
  isValid: (parsed: Partial<T> | null) => boolean,
): T {
  let parsed: Partial<T> | null;
  try {
    parsed = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as Partial<T> | null;
  } catch {
    throw new BadRequestException('Invalid cursor');
  }

  if (!isValid(parsed)) {
    throw new BadRequestException('Invalid cursor');
  }

  return parsed as T;
}

export function applyKeysetSorting<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  sortColumn: string,
  idColumn: string,
  direction: SortDirection,
): void {
  qb.orderBy(sortColumn, direction);
  qb.addOrderBy(idColumn, direction);
}

export function applyKeysetCursor<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  sortColumn: string,
  idColumn: string,
  direction: SortDirection,
  cursor: KeysetCursor,
): void {
  const operator = direction === 'ASC' ? '>' : '<';

  qb.andWhere(`(${sortColumn}, ${idColumn}) ${operator} (:value, :id)`, {
    value: cursor.value,
    id: cursor.id,
  });
}

export async function fetchKeysetPage<T extends ObjectLiteral>(
  qb: SelectQueryBuilder<T>,
  limit: number,
): Promise<{ items: T[]; hasNextPage: boolean }> {
  const rows = await qb.take(limit + 1).getMany();
  const hasNextPage = rows.length > limit;

  return {
    items: hasNextPage ? rows.slice(0, limit) : rows,
    hasNextPage,
  };
}
