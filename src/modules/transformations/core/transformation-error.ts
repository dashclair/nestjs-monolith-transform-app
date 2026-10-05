import { HttpException, HttpStatus } from '@nestjs/common';

export type TransformationErrorCode =
  | 'FILE_REQUIRED'
  | 'EMPTY_FILE'
  | 'TOO_MANY_FILES'
  | 'INVALID_FIELDS'
  | 'UNSUPPORTED_FORMAT'
  | 'UNSUPPORTED_DIRECTION'
  | 'INVALID_OPTIONS'
  | 'PAYLOAD_TOO_LARGE'
  | 'PARSE_ERROR'
  | 'INVALID_ENCODING'
  | 'UNSAFE_CONTENT'
  | 'STRUCTURE_TOO_LARGE'
  | 'DIMENSIONS_EXCEEDED'
  | 'CONVERSION_TIMEOUT'
  | 'INTERNAL_ERROR'
  | 'NOT_TABULAR'
  | 'BUSY';

export class TransformationError extends HttpException {
  constructor(
    readonly code: TransformationErrorCode,
    status: HttpStatus,
    message: string,
  ) {
    super(message, status);
  }
}
