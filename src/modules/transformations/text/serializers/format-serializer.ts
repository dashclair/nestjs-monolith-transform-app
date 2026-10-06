import { TextFormat } from '../../core/types';
import { JsonValue } from '../text.types';

export abstract class FormatSerializer {
  abstract readonly format: TextFormat;
  abstract readonly extension: string;
  abstract readonly mimeType: string;
  abstract serialize(value: JsonValue): string;
}
