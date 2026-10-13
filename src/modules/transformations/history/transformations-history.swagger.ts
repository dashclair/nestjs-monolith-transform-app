import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse } from '@nestjs/swagger';

import { TransformationHistoryResponseDto } from './transformations-history.dto';

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
