import { HttpStatus } from '@nestjs/common';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { TransformationError } from '../../core/transformation-error';
import { FormatParser } from './format-parser';
import { JsonValue, StructureLimits } from '../text.types';

const PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  ignoreDeclaration: true,
  ignorePiTags: true,
} as const;

// fast-xml-parser's own nesting guard (maxNestedTags, default 100) throws a
// plain Error with this message before our tree check ever runs.
const NESTED_TAGS_EXCEEDED = /Maximum nested tags exceeded/;

export class XmlParser extends FormatParser {
  readonly format = 'xml';

  parse(text: string, { maxDepth }: StructureLimits): JsonValue {
    // Rejecting DOCTYPE outright rules out XXE and entity-expansion bombs.
    if (/<!DOCTYPE/i.test(text)) {
      throw new TransformationError(
        'UNSAFE_CONTENT',
        HttpStatus.BAD_REQUEST,
        'DOCTYPE is not allowed in XML',
      );
    }

    const validation = XMLValidator.validate(text);
    if (validation !== true) {
      // The validator's message may quote tag names from the file — keep only the position.
      const { line, col } = validation.err;
      throw new TransformationError(
        'PARSE_ERROR',
        HttpStatus.BAD_REQUEST,
        `Invalid XML (line ${line} column ${col})`,
      );
    }

    // Tag depth never exceeds the IR depth, so maxDepth as the tag limit
    // rejects nothing the tree check would accept.
    const xmlParser = new XMLParser({
      ...PARSER_OPTIONS,
      maxNestedTags: maxDepth,
    });

    try {
      return xmlParser.parse(text) as JsonValue;
    } catch (error) {
      if (error instanceof Error && NESTED_TAGS_EXCEEDED.test(error.message)) {
        throw new TransformationError(
          'STRUCTURE_TOO_LARGE',
          HttpStatus.BAD_REQUEST,
          'Structure is too large',
        );
      }
      throw error;
    }
  }
}
