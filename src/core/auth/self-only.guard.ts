import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { RequestWithUser } from './auth.types';

export const SELF_ONLY_PARAM_KEY = 'selfOnlyParam';
export const SelfOnly = (paramName = 'id') =>
  SetMetadata(SELF_ONLY_PARAM_KEY, paramName);

@Injectable()
export class SelfOnlyGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const paramName = this.reflector.getAllAndOverride<string>(
      SELF_ONLY_PARAM_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!paramName) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;
    if (!user) {
      throw new UnauthorizedException();
    }
    if (user.userId !== request.params[paramName]) {
      throw new ForbiddenException();
    }

    return true;
  }
}
