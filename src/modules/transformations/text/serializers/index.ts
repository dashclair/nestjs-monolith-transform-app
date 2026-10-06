import { TextFormat } from '../../core/types';
import { CsvSerializer } from './csv.serializer';
import { FormatSerializer } from './format-serializer';
import { JsonSerializer } from './json.serializer';
import { XmlSerializer } from './xml.serializer';
import { YamlSerializer } from './yaml.serializer';

// Plain registry instead of Nest multi-providers — see ../parsers/index.ts.
export const TEXT_SERIALIZERS: ReadonlyMap<TextFormat, FormatSerializer> =
  new Map(
    [
      new CsvSerializer(),
      new JsonSerializer(),
      new XmlSerializer(),
      new YamlSerializer(),
    ].map((serializer) => [serializer.format, serializer] as const),
  );
