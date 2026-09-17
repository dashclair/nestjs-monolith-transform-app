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
  SELF_OR_PERMISSION_KEY,
  SelfOrPermissionMeta,
} from '../decorators/self-or-permission.decorator';
import { RbacConfigService } from '../services/rbac-config.service';

@Injectable()
export class SelfOrPermissionGuard implements CanActivate {
  private readonly logger = new Logger(SelfOrPermissionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly rbacConfigService: RbacConfigService,
  ) {}

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

    if (user.userId === targetId) return true;
    if (
      this.rbacConfigService.hasPermission(
        user.roles,
        meta.resource,
        meta.action,
      )
    ) {
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
