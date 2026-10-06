import { applyDecorators, HttpStatus } from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiResponse,
} from '@nestjs/swagger';

import { TEXT_FORMATS } from '../core/types';
import { TEXT_SERIALIZERS } from './serializers';

const CONVERSION_RULES = `
UTF-8 only (a UTF-8 BOM is stripped). The source format comes from the file
extension, then the content (\`{\`/\`[\` → JSON, \`<\` → XML), then the client MIME type.

- **CSV in**: \`,\` delimiter, RFC 4180 quoting, a required header without
  empty or duplicate names; rows become objects, all values stay strings.
- **CSV out**: single-key wrappers are unwrapped, nested keys flattened
  (\`a.b\`, \`tags.0\`), \`null\` → empty cell; cells starting with \`= + - @\`
  that are not numbers get a \`'\` prefix. Non-tabular data → \`NOT_TABULAR\`.
- **XML in**: \`<!DOCTYPE\` rejected; the root is kept as a key, attributes are
  \`@_name\`, text next to attributes is \`#text\`, values are strings; a
  repeated element becomes an array, a single one an object.
- **XML out**: a single-key object is the root, anything else is wrapped in
  \`<root>\`; invalid names are fixed (\`First Name\` → \`First_Name\`).
- **YAML in**: one document, core schema (\`yes\` and dates stay strings), at
  most 100 aliases, custom tags rejected; comments are lost.

Precision losses: duplicate JSON keys keep the last value, integers above 2^53
lose precision, CSV/XML values are always strings.
`.trim();

export const ApiTextFormats = () =>
  applyDecorators(
    ApiOperation({ summary: 'List supported text conversion directions' }),
    ApiOkResponse({
      description: 'Target formats grouped by source format.',
      schema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            source: { type: 'string', enum: [...TEXT_FORMATS] },
            target: {
              type: 'array',
              items: { type: 'string', enum: [...TEXT_FORMATS] },
            },
          },
        },
        example: [{ source: 'csv', target: ['json', 'xml', 'yaml'] }],
      },
    }),
  );

export const ApiConvertText = () =>
  applyDecorators(
    ApiOperation({
      summary: 'Convert a CSV / JSON / XML / YAML file',
      description: CONVERSION_RULES,
    }),
    ApiConsumes('multipart/form-data'),
    ApiBody({
      description: 'Fields may come before or after the file.',
      schema: {
        type: 'object',
        required: ['file', 'targetFormat'],
        properties: {
          file: { type: 'string', format: 'binary' },
          targetFormat: { type: 'string', enum: [...TEXT_FORMATS] },
          save: { type: 'string', enum: ['true', 'false'] },
        },
      },
    }),
    ApiProduces(...[...TEXT_SERIALIZERS.values()].map((s) => s.mimeType)),
    ApiOkResponse({
      description: 'The converted file.',
      schema: { type: 'string', format: 'binary' },
      headers: {
        'Content-Disposition': {
          description: 'attachment; filename="converted.<ext>"',
          schema: { type: 'string' },
        },
        'X-Transformation-Id': {
          description: 'History entry id; absent if the history write failed.',
          schema: { type: 'string', format: 'uuid' },
        },
      },
    }),
    ApiResponse({
      status: HttpStatus.BAD_REQUEST,
      description:
        'FILE_REQUIRED, EMPTY_FILE, TOO_MANY_FILES, INVALID_FIELDS, INVALID_OPTIONS, UNSUPPORTED_DIRECTION, INVALID_ENCODING, PARSE_ERROR, UNSAFE_CONTENT, STRUCTURE_TOO_LARGE, NOT_TABULAR',
    }),
    ApiResponse({
      status: HttpStatus.UNAUTHORIZED,
      description: 'No valid JWT.',
    }),
    ApiResponse({
      status: HttpStatus.REQUEST_TIMEOUT,
      description: 'CONVERSION_TIMEOUT',
    }),
    ApiResponse({
      status: HttpStatus.PAYLOAD_TOO_LARGE,
      description: 'PAYLOAD_TOO_LARGE — over the source format size limit.',
    }),
    ApiResponse({
      status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      description: 'UNSUPPORTED_FORMAT — binary or unrecognised file.',
    }),
    ApiResponse({
      status: HttpStatus.TOO_MANY_REQUESTS,
      description: 'THROTTLE_TRANSFORM_LIMIT exceeded.',
    }),
    ApiResponse({
      status: HttpStatus.SERVICE_UNAVAILABLE,
      description: 'BUSY — conversion queue is full.',
    }),
  );
