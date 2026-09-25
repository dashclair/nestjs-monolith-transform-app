import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { RequestUser } from '@/core/auth/auth.types';

import { RequirePermission } from './access/require-permission.decorator';
import { CreateGrantDto } from './dto/create-grant.dto';
import { UpdateGrantDto } from './dto/update-grant.dto';
import { PermissionsGuard } from './access/permissions.guard';
import { GrantsService } from './services/grants.service';

type AuthenticatedRequest = FastifyRequest & { user: RequestUser };

@ApiTags('RBAC')
@UseGuards(PermissionsGuard)
@Controller('admin/rbac/grants')
export class GrantsController {
  constructor(private readonly grantsService: GrantsService) {}

  @RequirePermission('rbac', 'read')
  @Get()
  findAll() {
    return this.grantsService.findAll();
  }

  @RequirePermission('rbac', 'create')
  @Post()
  create(@Body() dto: CreateGrantDto, @Req() req: AuthenticatedRequest) {
    return this.grantsService.create(dto, req.user.userId);
  }

  @RequirePermission('rbac', 'update')
  @Put(':grantId')
  update(
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @Body() dto: UpdateGrantDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.grantsService.update(grantId, dto, req.user.userId);
  }

  @RequirePermission('rbac', 'delete')
  @Delete(':grantId')
  remove(
    @Param('grantId', ParseUUIDPipe) grantId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.grantsService.remove(grantId, req.user.userId);
  }
}
