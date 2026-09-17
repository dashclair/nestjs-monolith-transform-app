import { SetMetadata } from '@nestjs/common';

export const SELF_OR_PERMISSION_KEY = 'selfOrPermission';

export interface SelfOrPermissionMeta {
  paramName: string;
  resource: string;
  action: string;
}

export const SelfOrPermission = (
  paramName: string,
  resource: string,
  action: string,
) => SetMetadata(SELF_OR_PERMISSION_KEY, { paramName, resource, action });
