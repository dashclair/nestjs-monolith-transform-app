import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';

import type { RequestUser } from '@/core/auth/auth.types';
import { throttleFromConfig } from '@/core/throttler/throttle-from-config';

import {
  TransformationHistoryQueryDto,
  TransformationHistoryResponseDto,
} from './dto/transformations-history.dto';
import { TransformationsHistoryService } from './services/history-transformations.service';
import {
  ApiTransformationDownload,
  ApiTransformationHistory,
} from './transformations-history.swagger';

type AuthenticatedRequest = FastifyRequest & { user: RequestUser };

@ApiTags('Transformations')
@ApiBearerAuth()
@Controller('api/transformations')
export class TransformationHistoryController {
  constructor(
    private readonly transformationsHistory: TransformationsHistoryService,
  ) {}

  @Throttle(
    throttleFromConfig(
      'THROTTLE_TRANSFORMATIONS_HISTORY_LIMIT',
      'THROTTLE_TRANSFORMATIONS_HISTORY_TTL',
    ),
  )
  @ApiTransformationHistory()
  @Get('history')
  getUserTransformationHistory(
    @Query() query: TransformationHistoryQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<TransformationHistoryResponseDto> {
    return this.transformationsHistory.getTransformationHistory(
      query,
      request.user.userId,
    );
  }

  @Throttle(
    throttleFromConfig(
      'THROTTLE_TRANSFORMATIONS_DOWNLOAD_LIMIT',
      'THROTTLE_TRANSFORMATIONS_DOWNLOAD_TTL',
    ),
  )
  @ApiTransformationDownload()
  @Get('history/:itemId/download')
  downloadUserTransformation(
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<StreamableFile> {
    return this.transformationsHistory.downloadFile(
      itemId,
      request.user.userId,
      request.user.userId,
    );
  }
}
