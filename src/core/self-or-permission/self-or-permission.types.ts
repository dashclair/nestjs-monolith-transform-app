export type SelfOrPermissionAccessType = 'self' | 'permission'

export type SelfOrPermissionAccess = {
  type: SelfOrPermissionAccessType;
  actorUserId: string;
  resource: string;
  action: string;
};