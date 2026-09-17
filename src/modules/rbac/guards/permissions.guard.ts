import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { RequestUser } from '@/core/auth/auth.types';

import {
  REQUIRE_PERMISSION_KEY,
  RequirePermissionMeta,
} from '../decorators/require-permission.decorator';
import { RbacConfigService } from '../services/rbac-config.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  private readonly logger = new Logger(PermissionsGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly rbacConfigService: RbacConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RequirePermissionMeta>(
      REQUIRE_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as RequestUser | undefined;
    if (!user) {
      throw new UnauthorizedException();
    }

    const allowed = this.rbacConfigService.hasPermission(
      user.roles,
      required.resource,
      required.action,
    );

    if (!allowed) {
      this.logger.warn({
        event: 'rbac.access.denied',
        actorUserId: user.userId,
        resource: required.resource,
        action: required.action,
      });
      throw new ForbiddenException('Forbidden');
    }

    return true;
  }
}
