import {
  Controller,
  Get,
  Post,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { RequestUser } from '@/core/auth/auth.types';
import { TransformationPipelineService } from '../core/conversion-pipeline.service';
import { TextTransformationService } from './text-transformation.service';

type AuthenticatedRequest = FastifyRequest & {
  user: RequestUser;
};

@ApiTags('Text transformations')
@Controller('convert')
export class TextTransformationController {
  constructor(
    private readonly pipeline: TransformationPipelineService,
    private readonly engine: TextTransformationService,
  ) {}

  @Get('formats')
  getFormats() {
    return this.engine.getFormats();
  }

  @Post()
  convert(
    @Req() request: AuthenticatedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StreamableFile> {
    return this.pipeline.run(this.engine, request, reply);
  }
}
