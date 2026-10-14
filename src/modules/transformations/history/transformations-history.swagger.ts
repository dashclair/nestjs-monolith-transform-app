import { applyDecorators, HttpStatus } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiResponse,
} from '@nestjs/swagger';

import { TransformationHistoryResponseDto } from './dto/transformations-history.dto';

const HISTORY_RULES = `
Sorted by \`createdAt\` descending. Filters are combined with AND.
Entries older than the retention period are never returned.
`.trim();

const historyResponses = (throttleKey: string) => [
  ApiOkResponse({ type: TransformationHistoryResponseDto }),
  ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description:
      'Invalid query parameter, `createdAtFrom` after `createdAtTo`, or invalid cursor.',
  }),
  ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'No valid JWT.',
  }),
  ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description: `${throttleKey} exceeded.`,
  }),
];

export const ApiTransformationHistory = () =>
  applyDecorators(
    ApiOperation({
      summary: "Current user's transformation history",
      description: HISTORY_RULES,
    }),
    ...historyResponses('THROTTLE_TRANSFORMATIONS_HISTORY_LIMIT'),
  );

export const ApiAdminTransformationHistory = () =>
  applyDecorators(
    ApiOperation({
      summary: "A user's transformation history (admin)",
      description: `${HISTORY_RULES}\n\nRequires \`transformations:read\`.`,
    }),
    ...historyResponses('THROTTLE_ADMIN_TRANSFORMATIONS_HISTORY_LIMIT'),
    ApiResponse({
      status: HttpStatus.FORBIDDEN,
      description: 'No `transformations:read` grant.',
    }),
    ApiResponse({
      status: HttpStatus.NOT_FOUND,
      description: 'User not found.',
    }),
  );

const DOWNLOAD_RULES = `
Streams the result file saved with \`save=true\`. 404 when the entry does not
exist, belongs to another user, is older than the retention period, or has no
stored file (\`fileAvailable: false\` in the history).
`.trim();

const downloadResponses = (throttleKey: string) => [
  ApiProduces('application/octet-stream'),
  ApiOkResponse({
    description:
      'The result file, with the `Content-Type` of the conversion result.',
    schema: { type: 'string', format: 'binary' },
    headers: {
      'Content-Disposition': {
        description:
          'attachment; filename="<name>"; filename*=UTF-8\'\'<percent-encoded name>',
        schema: { type: 'string' },
      },
    },
  }),
  ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'A path parameter is not a UUID.',
  }),
  ApiResponse({
    status: HttpStatus.UNAUTHORIZED,
    description: 'No valid JWT.',
  }),
  ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description: `${throttleKey} exceeded.`,
  }),
];

export const ApiTransformationDownload = () =>
  applyDecorators(
    ApiOperation({
      summary: "Download a saved result from the current user's history",
      description: DOWNLOAD_RULES,
    }),
    ...downloadResponses('THROTTLE_TRANSFORMATIONS_DOWNLOAD_LIMIT'),
    ApiResponse({
      status: HttpStatus.NOT_FOUND,
      description: 'Item not found.',
    }),
  );

export const ApiAdminTransformationDownload = () =>
  applyDecorators(
    ApiOperation({
      summary: "Download a saved result from a user's history (admin)",
      description: `${DOWNLOAD_RULES}\n\nRequires \`transformations:download\`.`,
    }),
    ...downloadResponses('THROTTLE_ADMIN_TRANSFORMATIONS_DOWNLOAD_LIMIT'),
    ApiResponse({
      status: HttpStatus.FORBIDDEN,
      description: 'No `transformations:download` grant.',
    }),
    ApiResponse({
      status: HttpStatus.NOT_FOUND,
      description: 'User not found, or item not found.',
    }),
  );
