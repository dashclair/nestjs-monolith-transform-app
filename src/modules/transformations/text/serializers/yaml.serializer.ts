import { stringify } from 'yaml';
import { TextFormat } from '../../core/types';
import { FormatSerializer } from './format-serializer';
import { JsonValue } from '../text.types';

export class YamlSerializer extends FormatSerializer {
  readonly format: TextFormat = 'yaml';
  readonly extension = 'yaml';
  readonly mimeType = 'application/yaml; charset=utf-8';

  serialize(value: JsonValue): string {
    return stringify(value);
  }
}
