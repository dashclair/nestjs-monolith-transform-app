import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';

import type { RequestUser } from '@/core/auth/auth.types';
import { throttleFromConfig } from '@/core/throttler/throttle-from-config';

import {
  TransformationHistoryQueryDto,
  TransformationHistoryResponseDto,
} from './transformations-history.dto';
import { TransformationsHistoryService } from './transformations-history.service';
import { ApiTransformationHistory } from './transformations-history.swagger';

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
}
