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
import { ImageTransformationService } from './image-transformation.service';
import {
  ApiConvertImage,
  ApiImageFormats,
} from './image-transformation.swagger';

type AuthenticatedRequest = FastifyRequest & {
  user: RequestUser;
};

// The `api/` prefix is part of the path, not a global prefix, so existing
// /auth, /users and /admin routes keep their URLs.
@ApiTags('Transformations')
@ApiBearerAuth()
@Controller('api/images')
export class ImageTransformationController {
  constructor(
    private readonly pipeline: TransformationPipelineService,
    private readonly engine: ImageTransformationService,
  ) {}

  @ApiImageFormats()
  @Get('convert/formats')
  getFormats() {
    return this.engine.getFormats();
  }

  // Same THROTTLE_TRANSFORM_* limit as text conversion, on top of the global
  // one. The throttler counts per route, so image and text each get their
  // own counter rather than one shared budget.
  @Throttle(
    throttleFromConfig('THROTTLE_TRANSFORM_LIMIT', 'THROTTLE_TRANSFORM_TTL'),
  )
  @ApiConvertImage()
  @Post('convert')
  convert(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StreamableFile> {
    return this.pipeline.run(this.engine, request, reply);
  }
}
