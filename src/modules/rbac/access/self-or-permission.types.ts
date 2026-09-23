import type { RequestWithUser } from '@/core/auth/auth.types';

export type SelfOrPermissionAccessType = 'self' | 'permission';

export type SelfOrPermissionAccess = {
  type: SelfOrPermissionAccessType;
  actorUserId: string;
  resource: string;
  action: string;
};

/** Request after `SelfOrPermissionGuard` has recorded how access was granted. */
export type SelfOrPermissionRequest = RequestWithUser & {
  selfOrPermissionAccess?: SelfOrPermissionAccess;
};
