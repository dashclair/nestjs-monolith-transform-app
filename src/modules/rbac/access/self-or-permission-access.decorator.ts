import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { SelfOrPermissionRequest } from './self-or-permission.types';

export const SelfOrPermissionAccessContext = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<SelfOrPermissionRequest>();

    return request.selfOrPermissionAccess;
  },
);
