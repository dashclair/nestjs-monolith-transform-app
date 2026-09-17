import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { RbacConfigService } from '@/modules/rbac/services/rbac-config.service';
import { SELF_OR_PERMISSION_KEY, SelfOrPermissionMeta } from './self-or-permission.decorator';

import { RequestUser } from '@/core/auth/auth.types';


@Injectable()
export class SelfOrPermissionGuard implements CanActivate {
  private readonly logger = new Logger(SelfOrPermissionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly rbacConfigService: RbacConfigService,
  ) { }

  canActivate(context: ExecutionContext): boolean {
    const meta = this.reflector.getAllAndOverride<SelfOrPermissionMeta>(
      SELF_OR_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!meta) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as RequestUser | undefined;
    if (!user) {
      throw new UnauthorizedException();
    }

    const targetId = request.params[meta.paramName];

    if (user.userId === targetId) {
      request.selfOrPermissionAccess = {
        type: 'self',
        resource: meta.resource,
        actorUserId: user.userId,
        action: meta.action,
      };

      return true
    };
    if (
      this.rbacConfigService.hasPermission(
        user.roles,
        meta.resource,
        meta.action,
      )
    ) {

      request.selfOrPermissionAccess = {
        type: 'permission',
        actorUserId: user.userId,
        resource: meta.resource,
        action: meta.action,
      };

      return true;
    }

    this.logger.warn({
      event: 'rbac.access.denied',
      actorUserId: user.userId,
      resource: meta.resource,
      action: meta.action,
    });
    throw new ForbiddenException();
  }
}
