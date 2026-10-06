import { HttpStatus } from '@nestjs/common';
import { parseAllDocuments, YAMLError } from 'yaml';
import { TransformationError } from '../../core/transformation-error';
import { FormatParser } from './format-parser';
import { JsonValue } from '../text.types';

const MAX_ALIAS_COUNT = 100;

const parseError = (message: string) =>
  new TransformationError('PARSE_ERROR', HttpStatus.BAD_REQUEST, message);

// yaml's messages quote the offending source — keep only the position.
const position = (error: YAMLError) => {
  const pos = error.linePos?.[0];
  return pos ? ` (line ${pos.line} column ${pos.col})` : '';
};

export class YamlParser extends FormatParser {
  readonly format = 'yaml';

  parse(text: string): JsonValue {
    const docs = parseAllDocuments(text, { schema: 'core' });

    if (!Array.isArray(docs) || docs.length === 0) {
      return null;
    }
    if (docs.length > 1) {
      throw parseError('Invalid YAML: multi-document YAML is not supported');
    }

    const [doc] = docs;
    if (doc.errors.length > 0) {
      throw parseError(`Invalid YAML${position(doc.errors[0])}`);
    }

    // An unknown tag (e.g. !!js/function) is only a warning in yaml and silently
    // becomes a string — reject it instead of losing it.
    const unresolvedTag = doc.warnings.find(
      (w) => w.code === 'TAG_RESOLVE_FAILED',
    );
    if (unresolvedTag) {
      throw parseError(
        `Invalid YAML: unsupported tag${position(unresolvedTag)}`,
      );
    }

    try {
      return doc.toJS({ maxAliasCount: MAX_ALIAS_COUNT }) as JsonValue;
    } catch (error) {
      // yaml throws a ReferenceError when the alias limit is exceeded.
      if (error instanceof ReferenceError) {
        throw new TransformationError(
          'UNSAFE_CONTENT',
          HttpStatus.BAD_REQUEST,
          'Too many YAML aliases',
        );
      }
      throw error;
    }
  }
}
