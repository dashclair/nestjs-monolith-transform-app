import { TextFormat } from '../../core/types';
import { FormatSerializer } from './format-serializer';
import { JsonValue } from '../text.types';

export class JsonSerializer extends FormatSerializer {
  readonly format: TextFormat = 'json';
  readonly extension = 'json';
  readonly mimeType = 'application/json; charset=utf-8';

  serialize(value: JsonValue): string {
    return JSON.stringify(value, null, 2);
  }
}
