export { RbacModule } from './rbac.module';

export { PermissionsGuard } from './access/permissions.guard';
export {
  REQUIRE_PERMISSION_KEY,
  RequirePermission,
  type RequirePermissionMeta,
} from './access/require-permission.decorator';

export { SelfOrPermissionGuard } from './access/self-or-permission.guard';
export {
  SELF_OR_PERMISSION_KEY,
  SelfOrPermission,
  type SelfOrPermissionMeta,
} from './access/self-or-permission.decorator';
export { SelfOrPermissionAccessContext } from './access/self-or-permission-access.decorator';
export type {
  SelfOrPermissionAccess,
  SelfOrPermissionAccessType,
  SelfOrPermissionRequest,
} from './access/self-or-permission.types';
