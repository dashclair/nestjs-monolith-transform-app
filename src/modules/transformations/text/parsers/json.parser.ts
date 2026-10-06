import { HttpStatus } from '@nestjs/common';
import { TransformationError } from '../../core/transformation-error';
import { FormatParser } from './format-parser';
import { JsonValue } from '../text.types';

export class JsonParser extends FormatParser {
  readonly format = 'json';

  parse(text: string): JsonValue {
    try {
      return JSON.parse(text) as JsonValue;
    } catch (error) {
      // V8's message may quote a fragment of the file — keep only the position.
      const position = /\(line \d+ column \d+\)/.exec((error as Error).message);
      const message = position ? `Invalid JSON ${position[0]}` : 'Invalid JSON';
      throw new TransformationError(
        'PARSE_ERROR',
        HttpStatus.BAD_REQUEST,
        message,
      );
    }
  }
}
