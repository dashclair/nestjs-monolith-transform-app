import { TextFormat } from '../../core/types';
import { CsvParser } from './csv.parser';
import { FormatParser } from './format-parser';
import { JsonParser } from './json.parser';
import { XmlParser } from './xml.parser';
import { YamlParser } from './yaml.parser';

// Plain registry instead of Nest multi-providers: the worker thread has no DI
// container and needs the same lookup. Keyed by each parser's own `format`.
export const TEXT_PARSERS: ReadonlyMap<TextFormat, FormatParser> = new Map(
  [new CsvParser(), new JsonParser(), new XmlParser(), new YamlParser()].map(
    (parser) => [parser.format, parser] as const,
  ),
);
