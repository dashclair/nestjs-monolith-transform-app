import { HttpStatus } from '@nestjs/common';
import { stringify } from 'csv-stringify/sync';
import { TransformationError } from '../../core/transformation-error';
import { TextFormat } from '../../core/types';
import { FormatSerializer } from './format-serializer';
import { JsonValue } from '../text.types';

type JsonObject = { [key: string]: JsonValue };
type Primitive = string | number | boolean | null;

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const FORMULA_START = /^[=+\-@\t\r]/;

const isObject = (value: JsonValue): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const notTabular = () =>
  new TransformationError(
    'NOT_TABULAR',
    HttpStatus.BAD_REQUEST,
    'Structure cannot be represented as a table',
  );

// Unwrap single-key objects ({"root":{"item":[...]}} → [...]), then take an
// array of objects as rows or a single object as one row.
const toRows = (value: JsonValue): JsonObject[] => {
  while (isObject(value) && Object.keys(value).length === 1) {
    const inner = Object.values(value)[0];
    if (typeof inner !== 'object' || inner === null) break;
    value = inner;
  }

  if (isObject(value)) return [value];
  if (Array.isArray(value) && value.every(isObject)) return value;
  throw notTabular();
};

// {"a":{"b":1},"tags":["x"]} → {"a.b":1,"tags.0":"x"}
const flatten = (
  value: JsonValue,
  prefix: string,
  out: Record<string, Primitive>,
) => {
  if (typeof value === 'object' && value !== null) {
    for (const [key, inner] of Object.entries(value)) {
      flatten(inner, prefix ? `${prefix}.${key}` : key, out);
    }
  } else {
    out[prefix] = value;
  }
  return out;
};

// OWASP CSV injection: a cell starting with = + - @ \t \r is run as a formula
// by spreadsheets — prefix it with ' unless it is just a number like -5.
const toCell = (value: Primitive | undefined): string => {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return String(value);
  return FORMULA_START.test(value) && !NUMBER.test(value) ? `'${value}` : value;
};

export class CsvSerializer extends FormatSerializer {
  readonly format: TextFormat = 'csv';
  readonly extension = 'csv';
  readonly mimeType = 'text/csv; charset=utf-8';

  serialize(value: JsonValue): string {
    const rows = toRows(value).map((row) => flatten(row, '', {}));
    const allColumns = [...new Set(rows.flatMap((row) => Object.keys(row)))];

    // `{"address":null}` next to `{"address":{"city":…}}` would add an
    // always-empty `address` column beside `address.city` — drop it. A column
    // holding a real value in any row is kept.
    const columns = allColumns.filter(
      (column) =>
        !allColumns.some((other) => other.startsWith(`${column}.`)) ||
        rows.some((row) => row[column] !== null && row[column] !== undefined),
    );

    if (columns.length === 0) return '';

    return stringify([
      columns,
      ...rows.map((row) => columns.map((column) => toCell(row[column]))),
    ]);
  }
}
