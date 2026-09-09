import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { Public } from '@/core/auth/public.decorator';

/**
 * Diagnostic routes for exercising AllExceptionsFilter manually (see .http).
 * Both intentionally throw so the filter's non-HttpException branch runs.
 */
@ApiTags('Diagnostics')
@Public()
@Controller('test-errors')
export class TestErrorsController {
  @Get('unknown')
  throwUnknownError(): never {
    throw new Error('Unexpected failure for testing purposes');
  }

  @Get('type-error')
  throwTypeError(): never {
    const value: unknown = undefined;
    return (value as { someProperty: never }).someProperty;
  }
}
