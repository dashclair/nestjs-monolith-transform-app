import { TextFormat } from '../../core/types';
import { JsonValue, StructureLimits } from '../text.types';

export abstract class FormatParser {
  abstract readonly format: TextFormat;
  // `limits` is for parsers that must enforce them while parsing (their own
  // limit fires first); the full tree check runs after parsing for every format.
  abstract parse(text: string, limits: StructureLimits): JsonValue;
}
