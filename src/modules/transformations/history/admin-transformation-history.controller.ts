import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { FastifyRequest } from 'fastify';

import type { RequestUser } from '@/core/auth/auth.types';
import { throttleFromConfig } from '@/core/throttler/throttle-from-config';
import { PermissionsGuard, RequirePermission } from '@/modules/rbac';

import {
  TransformationHistoryQueryDto,
  TransformationHistoryResponseDto,
} from './transformations-history.dto';
import { TransformationsHistoryService } from './transformations-history.service';
import { ApiAdminTransformationHistory } from './transformations-history.swagger';

type AuthenticatedRequest = FastifyRequest & { user: RequestUser };

@ApiTags('Transformations')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('admin/users')
export class AdminTransformationHistoryController {
  constructor(
    private readonly transformationsHistory: TransformationsHistoryService,
  ) {}

  @Throttle(
    throttleFromConfig(
      'THROTTLE_ADMIN_TRANSFORMATIONS_HISTORY_LIMIT',
      'THROTTLE_ADMIN_TRANSFORMATIONS_HISTORY_TTL',
    ),
  )
  @RequirePermission('transformations', 'read')
  @ApiAdminTransformationHistory()
  @Get(':userId/transformations/history')
  getUserTransformationHistory(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Query() query: TransformationHistoryQueryDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<TransformationHistoryResponseDto> {
    return this.transformationsHistory.getTransformationHistoryByAdmin(
      query,
      userId,
      request.user.userId,
    );
  }
}
