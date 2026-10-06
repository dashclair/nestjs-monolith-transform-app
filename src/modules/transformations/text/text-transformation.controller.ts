import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { RequestUser } from '@/core/auth/auth.types';
import { throttleFromConfig } from '@/core/throttler/throttle-from-config';
import { TransformationPipelineService } from '../core/conversion-pipeline.service';
import { TextTransformationService } from './text-transformation.service';
import { ApiConvertText, ApiTextFormats } from './text-transformation.swagger';

type AuthenticatedRequest = FastifyRequest & {
  user: RequestUser;
};

// The `api/` prefix is part of the path, not a global prefix, so existing
// /auth, /users and /admin routes keep their URLs.
@ApiTags('Transformations')
@ApiBearerAuth()
@Controller('api/convert')
export class TextTransformationController {
  constructor(
    private readonly pipeline: TransformationPipelineService,
    private readonly engine: TextTransformationService,
  ) {}

  @ApiTextFormats()
  @Get('formats')
  getFormats() {
    return this.engine.getFormats();
  }

  // Conversion is the most expensive route — its own limit on top of the
  // global one.
  @Throttle(
    throttleFromConfig('THROTTLE_TRANSFORM_LIMIT', 'THROTTLE_TRANSFORM_TTL'),
  )
  @ApiConvertText()
  @Post()
  convert(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StreamableFile> {
    return this.pipeline.run(this.engine, request, reply);
  }
}
