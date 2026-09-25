import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { RequestUser } from '@/core/auth/auth.types';
import { PermissionsGuard, RequirePermission } from '@/modules/rbac';
import { AuthSettingsService } from './auth-settings.service';
import { UpdateAuthSettingsDto } from './dto/auth-settings.dto';

@ApiTags('Settings')
@UseGuards(PermissionsGuard)
@Controller('admin/settings/auth')
export class AuthSettingsController {
  constructor(private readonly settings: AuthSettingsService) {}

  @Get()
  @RequirePermission('settings', 'read')
  getAuthSettings() {
    return this.settings.getEffectiveSettings();
  }

  @Patch()
  @RequirePermission('settings', 'update')
  updateAuthSettings(
    @Body() body: UpdateAuthSettingsDto,
    @Req() request: FastifyRequest & { user: RequestUser },
  ) {
    return this.settings.updateSettings(body, request.user.userId);
  }
}
