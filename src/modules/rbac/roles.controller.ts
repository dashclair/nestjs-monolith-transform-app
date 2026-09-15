import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { RequestUser } from '@/core/auth/auth.types';

import { RequirePermission } from './decorators/require-permission.decorator';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { PermissionsGuard } from './guards/permissions.guard';
import { RolesService } from './services/roles.service';

type AuthenticatedRequest = FastifyRequest & { user: RequestUser };

@ApiTags('RBAC')
@UseGuards(PermissionsGuard)
@Controller('admin/rbac/roles')
export class RolesController {
  constructor(private readonly rolesService: RolesService) {}

  @RequirePermission('rbac', 'read')
  @Get()
  findAll() {
    return this.rolesService.findAll();
  }

  @RequirePermission('rbac', 'create')
  @Post()
  create(@Body() dto: CreateRoleDto, @Req() req: AuthenticatedRequest) {
    return this.rolesService.create(dto, req.user.userId);
  }

  @RequirePermission('rbac', 'update')
  @Put(':roleId')
  update(
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Body() dto: UpdateRoleDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.rolesService.update(roleId, dto, req.user.userId);
  }

  @RequirePermission('rbac', 'delete')
  @Delete(':roleId')
  remove(
    @Param('roleId', ParseUUIDPipe) roleId: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.rolesService.remove(roleId, req.user.userId);
  }
}
