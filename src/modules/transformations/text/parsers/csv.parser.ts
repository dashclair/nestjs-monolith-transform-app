import { HttpStatus } from '@nestjs/common';
import { CsvError, parse } from 'csv-parse/sync';
import { TransformationError } from '../../core/transformation-error';
import { FormatParser } from './format-parser';
import { JsonValue } from '../text.types';

const parseError = (message: string) =>
  new TransformationError('PARSE_ERROR', HttpStatus.BAD_REQUEST, message);

export class CsvParser extends FormatParser {
  readonly format = 'csv';

  parse(text: string): JsonValue {
    try {
      return parse<Record<string, string>>(text, {
        columns: (header: string[]) => {
          if (header.some((name) => name.trim() === '')) {
            throw parseError('Invalid CSV: empty column name in header');
          }
          if (new Set(header).size !== header.length) {
            throw parseError('Invalid CSV: duplicate column name in header');
          }
          return header;
        },
        skip_empty_lines: true,
      });
    } catch (error) {
      if (error instanceof TransformationError) throw error;
      // csv-parse messages may quote field contents — keep only the line number.
      if (error instanceof CsvError)
        throw parseError(`Invalid CSV at line ${Number(error.lines)}`);
      throw error;
    }
  }
}
