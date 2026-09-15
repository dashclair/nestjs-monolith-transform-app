import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { RequestUser } from '@/core/auth/auth.types';

import { RequirePermission } from './decorators/require-permission.decorator';
import { PermissionsGuard } from './guards/permissions.guard';
import { PermissionsService } from './services/permissions.service';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { UpdatePermissionDto } from './dto/update-permission.dto';

type AuthenticatedRequest = FastifyRequest & { user: RequestUser };

@ApiTags('RBAC')
@UseGuards(PermissionsGuard)
@Controller('admin/rbac/permissions')
export class PermissionsController {
  constructor(private readonly permissionsService:  PermissionsService) {}

  @RequirePermission('rbac', 'read')
  @Get()
  findAll() {
    return this.permissionsService.findAll();
  }

  @RequirePermission('rbac', 'create')
  @Post()
  create(@Body() dto: CreatePermissionDto, @Req() req: AuthenticatedRequest) {
    return this.permissionsService.create(dto, req.user.userId);
  }

  @RequirePermission('rbac', 'update')
  @Put(':permissionId')
  update(
    @Param('permissionId', ParseUUIDPipe) permissionId: string,
    @Body() dto: UpdatePermissionDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.permissionsService.update(permissionId, dto, req.user.userId);
  }

  @RequirePermission('rbac', 'delete')
  @Delete(':permissionId')
  remove(
    @Param('permissionId', ParseUUIDPipe) permissionId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.permissionsService.remove(permissionId, req.user.userId);
  }
}
