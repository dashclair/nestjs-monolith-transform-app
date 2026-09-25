import { Injectable } from '@nestjs/common';
import { UserProfileField } from '../types/user-profile-policy.types';
import { SelfOrPermissionAccess } from '@/modules/rbac';

const SELF_PROFILE_FIELDS: UserProfileField[] = [
  UserProfileField.Id,
  UserProfileField.Email,
  UserProfileField.Photo,
  UserProfileField.IsEmailVerified,
  UserProfileField.CreatedAt,
];

const USERS_READ_PROFILE_FIELDS: UserProfileField[] = [
  UserProfileField.Id,
  UserProfileField.Email,
  UserProfileField.Photo,
  UserProfileField.CreatedAt,
];

@Injectable()
export class UserProfileFieldsPolicy {
  getAllowedFields(access: SelfOrPermissionAccess) {
    if (access.type === 'self') {
      return SELF_PROFILE_FIELDS;
    }

    if (
      access.type === 'permission' &&
      access.resource === 'users' &&
      access.action === 'read'
    ) {
      return USERS_READ_PROFILE_FIELDS;
    }

    // default deny
    return [];
  }
}
