import { applyDecorators, HttpStatus } from '@nestjs/common';
import {
  ApiBody,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiResponse,
} from '@nestjs/swagger';

import { IMAGE_FORMATS } from '../core/types';

const CONVERSION_RULES = `
Directions: \`png → jpeg\`, \`jpeg → png\`, \`svg → png\`, \`svg → jpeg\`.
\`→ svg\` (vectorization) and same-format pairs → \`UNSUPPORTED_DIRECTION\`.

The source format comes from the content only (PNG/JPEG signature, SVG root
element); the file name and MIME type are ignored.

- **PNG → JPEG**: transparency is flattened onto white.
- **JPEG → PNG**: EXIF orientation is applied.
- **SVG → PNG/JPEG**: rendered at the target size. Without \`width\`/\`height\`
  the SVG's own size is used; with one of them the other keeps the aspect
  ratio; with both the image is letterboxed into exactly \`width × height\`.
  Transparent areas get \`background\` (default \`#ffffff\`).
- Metadata (EXIF, GPS) is never copied to the output.
- SVG with scripts, event handlers, external references, \`<!DOCTYPE>\`,
  \`@import\` or \`<foreignObject>\` → \`UNSAFE_CONTENT\`.

\`options\` is a JSON string. An option that does not apply to the direction
is an error, not ignored:

| option | type | applies to |
|---|---|---|
| \`quality\` | integer 1–100, default 80 | \`targetFormat: jpeg\` |
| \`width\`, \`height\` | integer ≥ 1, at most the configured max | SVG input |
| \`background\` | \`#rgb\` or \`#rrggbb\` | SVG input |
`.trim();

export const ApiImageFormats = () =>
  applyDecorators(
    ApiOperation({ summary: 'List supported image conversion directions' }),
    ApiOkResponse({
      description: 'Target formats grouped by source format.',
      schema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            source: { type: 'string', enum: [...IMAGE_FORMATS] },
            target: {
              type: 'array',
              items: { type: 'string', enum: [...IMAGE_FORMATS] },
            },
          },
        },
        example: [
          { source: 'png', target: ['jpeg'] },
          { source: 'jpeg', target: ['png'] },
          { source: 'svg', target: ['png', 'jpeg'] },
        ],
      },
    }),
  );

export const ApiConvertImage = () =>
  applyDecorators(
    ApiOperation({
      summary: 'Convert a PNG / JPEG / SVG image',
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
          targetFormat: { type: 'string', enum: [...IMAGE_FORMATS] },
          options: {
            type: 'string',
            description: 'JSON object, see the table above.',
            example: '{"width":512,"background":"#000000"}',
          },
          save: { type: 'string', enum: ['true', 'false'] },
        },
      },
    }),
    ApiProduces('image/png', 'image/jpeg'),
    ApiOkResponse({
      description: 'The converted image.',
      schema: { type: 'string', format: 'binary' },
      headers: {
        'Content-Disposition': {
          description: 'attachment; filename="converted.png|jpg"',
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
        'FILE_REQUIRED, EMPTY_FILE, TOO_MANY_FILES, INVALID_FIELDS, INVALID_OPTIONS, UNSUPPORTED_DIRECTION, PARSE_ERROR, UNSAFE_CONTENT, DIMENSIONS_EXCEEDED',
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
      description: 'UNSUPPORTED_FORMAT — not a PNG, JPEG or SVG by content.',
    }),
    ApiResponse({
      status: HttpStatus.TOO_MANY_REQUESTS,
      description: 'THROTTLE_TRANSFORM_LIMIT exceeded.',
    }),
  );
